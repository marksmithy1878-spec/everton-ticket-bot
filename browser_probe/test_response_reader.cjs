"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { decodeBody, readEntry } = require("./response_reader.js");
const { summarize } = require("./probe.js");
const NOW = Date.parse("2026-11-16T14:00:00Z");

// A reduced transcription of visible columns/rows, NOT an original HAR/body.
// The screenshots show these names and values; cropped extra columns are not invented.
function inventory() {
  return { errorCode: 200, data: { section: {
    header: "sectionName~totalAvailableSeat~priceCode",
    data: ["205~31~98", "242~4~101", "243~3~101"]
  } } };
}
function captured(body = inventory(), { method = "POST", status = 200, timestamp = NOW - 1000 } = {}) {
  return {
    request: { method, url: "https://vv-app.eticketing.co.uk/v810/venueAvailability/buy" },
    response: { status }, startedDateTime: new Date(timestamp).toISOString(),
    getContent(callback) { callback(JSON.stringify(body), ""); }
  };
}

test("decodes the visible Fulham header/rows without claiming resale or individual seats", () => {
  const decoded = decodeBody(JSON.stringify(inventory()));
  assert.equal(decoded.kind, "section-counts");
  assert.equal(decoded.reported_places, 38);
  assert.deepEqual(decoded.sections, [{ section: "205", reported_places: 31 }, { section: "242", reported_places: 4 }, { section: "243", reported_places: 3 }]);
  assert.equal(decoded.resale_verified, false);
  assert.equal(decoded.individual_seat_verified, false);
});
test("maps columns by header names rather than guessing positions", () => {
  const data = inventory();
  data.data.section = { header: "priceCode~totalAvailableSeat~sectionName", data: ["98~31~205"] };
  assert.equal(decodeBody(JSON.stringify(data)).reported_places, 31);
});
test("zero section counts are decoded facts, not proof of no resale inventory", async () => {
  const data = inventory(); data.data.section.data = ["014~0~98"];
  const result = await readEntry(captured(data), summarize, NOW);
  assert.equal(result.response.reported_places, 0);
  assert.equal(result.state, "ERROR/UNKNOWN");
});
test("Liverpool API error 5085 remains an error and does not copy server messages", async () => {
  const record = await readEntry(captured({ errorCode: 5085, apiErrorMessage: "Event is not on sale", private: "fake-sensitive-data" }, { status: 540 }), summarize, NOW);
  assert.equal(record.response.api_error_code, 5085);
  assert.equal(record.state, "ERROR/UNKNOWN");
  assert.equal(record.decision_reason, "HTTP_FAILURE_NOT_EMPTY_INVENTORY");
  assert.equal(JSON.stringify(record).includes("fake-sensitive-data"), false);
  assert.equal(JSON.stringify(record).includes("not on sale"), false);
});
test("HTTP 200 setup/pricing body cannot be mistaken for inventory", async () => {
  const record = await readEntry(captured({ errorCode: 200, data: { targetEvent: { eventId: 1480 }, memberInfo: { memberId: "private-member" } } }), summarize, NOW);
  assert.equal(record.response.kind, "unknown");
  assert.equal(record.state, "ERROR/UNKNOWN");
  assert.equal(JSON.stringify(record).includes("private-member"), false);
});
test("OPTIONS HTTP 200 is identified without reading its body", async () => {
  const entry = captured(inventory(), { method: "OPTIONS" });
  entry.getContent = () => { throw new Error("must not be called"); };
  const record = await readEntry(entry, summarize, NOW);
  assert.equal(record.response.reason, "PREFLIGHT_NOT_INVENTORY");
  assert.equal(record.state, "ERROR/UNKNOWN");
});
test("missing or other HTTP methods never borrow POST semantics", async () => {
  for (const method of [undefined, "GET", "HEAD", "post", "private-method-text"]) {
    const entry = captured(); entry.request.method = method;
    entry.getContent = () => { throw new Error("must not be called"); };
    const record = await readEntry(entry, summarize, NOW);
    assert.equal(record.decision_reason, "NON_INVENTORY_METHOD");
    assert.equal(JSON.stringify(record).includes("private-method-text"), false);
  }
});
test("restrictions stop body reading and are not called sold out", async () => {
  for (const status of [401, 403, 429]) {
    const entry = captured(null, { status });
    entry.getContent = () => { throw new Error("must not be called"); };
    const record = await readEntry(entry, summarize, NOW);
    assert.equal(record.decision_reason, "ACCESS_RESTRICTED_STOP");
    assert.equal(record.state, "ERROR/UNKNOWN");
  }
});
test("a wrong explicit event, endpoint, or origin is ignored", async () => {
  for (const url of ["https://vv-app.eticketing.co.uk/v810/venueAvailability/buy?eventId=1481", "https://vv-app.eticketing.co.uk/v810/pricing/buy", "https://unrelated.test/v810/venueAvailability/buy"]) {
    const entry = captured(); entry.request.url = url;
    assert.equal(await readEntry(entry, summarize, NOW), null);
  }
});
test("fresh positive section counts still cannot validate a live source or emit AVAILABLE", async () => {
  const record = await readEntry(captured(), summarize, NOW);
  assert.equal(record.response.kind, "section-counts");
  assert.equal(record.state, "ERROR/UNKNOWN");
  assert.equal(record.association, "page-context-only");
  assert.equal(record.ticket_detection_validated, false);
});
test("historical and future response facts are explicitly dated and stay unknown", async () => {
  for (const timestamp of [NOW - 180000, NOW + 5000]) {
    const record = await readEntry(captured(inventory(), { timestamp }), summarize, NOW);
    assert.equal(record.decision_reason, "HISTORICAL_OR_FUTURE_RESPONSE");
    assert.equal(record.state, "ERROR/UNKNOWN");
  }
});
test("malformed bodies, unexpected API codes and invented resale fields fail closed", () => {
  for (const body of ["", "<html>not JSON</html>", "null", "[]", '{"errorCode":"200"}', '{"errorCode":200,"resaleConfirmed":true,"selectableResaleSeats":1}', JSON.stringify({ errorCode: 200, data: { section: { header: "wrong", data: [] } } })]) {
    assert.equal(decodeBody(body).kind, "unknown");
  }
});
test("schema drift and malformed section rows fail closed", () => {
  const rows = [["014~1"], ["014~yes~98"], ["014~-1~98"], ["014~1.5~98"], ["too long section~1~98"], ["014~1~98", "014~2~98"], [null], ["014~999999999999999999999999999~98"]];
  for (const dataRows of rows) {
    const body = inventory(); body.data.section.data = dataRows;
    assert.equal(decodeBody(JSON.stringify(body)).kind, "unknown");
  }
});
test("missing or duplicate required header fields fail closed", () => {
  for (const header of ["sectionName~totalavailableSeat~priceCode", "sectionName~totalAvailableSeat~sectionName", "totalAvailableSeat~priceCode"]) {
    const body = inventory(); body.data.section.header = header;
    assert.equal(decodeBody(JSON.stringify(body)).kind, "unknown");
  }
});
test("raw fields outside the allowlist never leave the decoder", () => {
  const body = inventory(); body.token = "fake-token-secret"; body.account = "fake-account-secret";
  body.errorMessage = "fake-private-message";
  const output = JSON.stringify(decodeBody(JSON.stringify(body)));
  for (const secret of ["fake-token-secret", "fake-account-secret", "fake-private-message"]) assert.equal(output.includes(secret), false);
});
test("oversized response bodies and large row collections are bounded", () => {
  assert.equal(decodeBody("x".repeat(2 * 1024 * 1024 + 1)).reason, "BODY_TOO_LARGE");
  const body = inventory(); body.data.section.data = new Array(2001).fill("014~1~98");
  assert.equal(decodeBody(JSON.stringify(body)).kind, "unknown");
});
test("base64 responses are decoded locally and invalid encodings fail closed", () => {
  const encoded = Buffer.from(JSON.stringify(inventory())).toString("base64");
  assert.equal(decodeBody(encoded, "base64").reported_places, 38);
  assert.equal(decodeBody("??bad", "base64").kind, "unknown");
  assert.equal(decodeBody("{}", "unsupported").kind, "unknown");
});
test("missing response buffers produce a clean diagnostic", async () => {
  const entry = captured(); delete entry.getContent;
  const record = await readEntry(entry, summarize, NOW);
  assert.equal(record.response.reason, "BODY_READER_NOT_AVAILABLE");
});
test("response-buffer failure does not leak exception text", async () => {
  const entry = captured(); entry.getContent = () => { throw new Error("fake-secret-url"); };
  const record = await readEntry(entry, summarize, NOW);
  assert.equal(record.response.reason, "BODY_READER_FAILED");
  assert.equal(JSON.stringify(record).includes("fake-secret-url"), false);
});
test("response-buffer timeout does not issue retries", async () => {
  let calls = 0;
  const entry = captured(); entry.getContent = () => { calls++; };
  const record = await readEntry(entry, summarize, NOW, { timeoutMs: 1 });
  assert.equal(record.response.reason, "BODY_READER_TIMEOUT");
  assert.equal(calls, 1);
});

const { requestFixture } = require("./response_reader.js");
function requestWith(body, overrides = {}) {
  return {method: "POST", url: "https://vv-app.eticketing.co.uk/v810/venueAvailability/buy",
    postData: {mimeType: "application/json", text: JSON.stringify(body)}, ...overrides};
}
test("only a matching allowlisted root event ID leaves the request decoder", () => {
  for (const eventId of [1480, 1481]) {
    const output = requestFixture(requestWith({eventId, token: "fake-private-token", account: "fake-account"}), eventId);
    assert.equal(output.kind, "explicit-event");
    assert.equal(output.event_id, eventId);
    assert.equal(output.source, "request-json-root");
    assert.equal(JSON.stringify(output).includes("fake-"), false);
  }
  assert.equal(requestFixture(requestWith({eventId: "1480"}), 1480).kind, "explicit-event");
  assert.equal(requestFixture(requestWith({eventId: 1480}), 9999).kind, "unknown");
});
test("conflicting request event IDs never expose arbitrary IDs or decode response counts", async () => {
  for (const eventId of [1481, 987654]) {
    const item = captured(); item.request = requestWith({eventId});
    item.getContent = () => { throw new Error("response must not be read"); };
    const result = await readEntry(item, summarize, NOW);
    assert.equal(result.request_fixture.kind, "conflict");
    assert.equal(result.decision_reason, "REQUEST_FIXTURE_CONFLICT");
    assert.equal(result.response.reason, "BODY_NOT_READ_ON_FIXTURE_CONFLICT");
    assert.equal(result.state, "ERROR/UNKNOWN");
    assert.equal(JSON.stringify(result).includes(String(eventId)), false);
  }
});
test("duplicate, nested and escaped JSON event keys fail closed", () => {
  for (const text of ['{"eventId":1480,"eventId":1481}', '{"eventId":1480,"EVENTID":1480}',
      '{"targetEvent":{"eventId":1480}}', '{"eventId":1480,"nested":{"eventId":1481}}',
      '{"ev\\u0065ntId":1480}']) {
    const request = requestWith({}); request.postData.text = text;
    assert.equal(requestFixture(request, 1480).kind, "unknown");
  }
});
test("invalid, oversized, unsupported and missing request bodies produce safe unknowns", () => {
  for (const value of [true, null, [], {}, " 1480", "01480", "1480private", 1.5, -1480]) {
    assert.equal(requestFixture(requestWith({eventId: value}), 1480).kind, "unknown");
  }
  for (const postData of [
    {mimeType: "application/json", text: "{"},
    {mimeType: "application/json", text: "[]"},
    {mimeType: "application/json", text: "x".repeat(65537)},
    {mimeType: "application/json"}, {mimeType: "text/plain", text: "fake-secret"}
  ]) {
    const request = requestWith({}, {postData});
    const output = requestFixture(request, 1480);
    assert.equal(output.kind, "unknown");
    assert.equal(JSON.stringify(output).includes("fake-secret"), false);
  }
  assert.equal(requestFixture(requestWith({}), 1480).reason, "EXPLICIT_EVENT_FIELD_NOT_OBSERVED");
});
test("query and form event fields are conservative and conflicts are excluded", () => {
  const query = "https://vv-app.eticketing.co.uk/v810/venueAvailability/buy?eventId=1480&token=fake-private";
  assert.equal(requestFixture({method: "POST", url: query}, 1480).source, "request-query");
  assert.equal(requestFixture(requestWith({eventId: 1481}, {url: query}), 1480).kind, "conflict");
  assert.equal(requestFixture(requestWith({eventId: 1480}, {url: query}), 1480).source, "request-query-and-body");
  assert.equal(requestFixture({method: "POST", url: query + "&event_id=1480"}, 1480).kind, "unknown");
  for (const postData of [
    {mimeType: "application/x-www-form-urlencoded; charset=UTF-8", text: "eventId=1480&token=fake-private"},
    {mimeType: "application/x-www-form-urlencoded", params: [{name: "eventId", value: "1480"}, {name: "token", value: "fake-private"}]}
  ]) {
    const output = requestFixture(requestWith({}, {postData}), 1480);
    assert.equal(output.source, "request-form");
    assert.equal(JSON.stringify(output).includes("fake-private"), false);
  }
  const repeated = requestWith({}, {postData: {mimeType: "application/x-www-form-urlencoded", text: "eventId=1480&eventId=1480"}});
  assert.equal(requestFixture(repeated, 1480).kind, "unknown");
});
test("preflight and restrictions never inspect request body fields", async () => {
  for (const options of [{method: "OPTIONS"}, {status: 403}]) {
    const item = captured(inventory(), options);
    Object.defineProperty(item.request, "postData", {get() {throw new Error("private request must not be read");}});
    const output = await readEntry(item, summarize, NOW);
    assert.equal(output.request_fixture.reason, "NOT_READ");
  }
});

// Minimal transcription of the 17 Nov real Form data screenshot. Unrelated
// fields are deliberately omitted: no full raw user payload is stored here.
function observedCommand(eventId = 1481, targetEvent = "1481") {
  return {command: {eventId, targetEvent}};
}
test("captured command structure binds both agreeing event fields under form MIME", async () => {
  const item = captured();
  item.request = requestWith(observedCommand(), {postData: {
    mimeType: "application/x-www-form-urlencoded", text: JSON.stringify(observedCommand())
  }});
  const output = await readEntry(item, (entry, now) => summarize(entry, now, 1481), NOW, {expectedEventId: 1481});
  assert.equal(output.request_fixture.kind, "explicit-event");
  assert.equal(output.request_fixture.event_id, 1481);
  assert.equal(output.request_fixture.source, "request-form-json-command");
  assert.equal(output.response.reported_places, 38);
  assert.equal(output.state, "ERROR/UNKNOWN");
  assert.equal(output.ticket_detection_validated, false);
});
test("captured command also supports JSON MIME and a JSON-only form key", () => {
  const text = JSON.stringify(observedCommand());
  const alternatives = [
    {mimeType: "application/json; charset=UTF-8", text},
    {mimeType: "application/x-www-form-urlencoded", text: encodeURIComponent(text) + "="},
    {mimeType: "application/x-www-form-urlencoded", params: [{name: text, value: ""}]}
  ];
  for (const postData of alternatives) {
    const output = requestFixture(requestWith({}, {postData}), 1481);
    assert.equal(output.kind, "explicit-event");
    assert.equal(output.event_id, 1481);
  }
});
test("command IDs must agree with each other, the inspected page, and query IDs", () => {
  for (const body of [observedCommand(1480, "1481"), observedCommand(1481, "1480"), observedCommand(1480, "1480")]) {
    assert.equal(requestFixture(requestWith(body), 1481).kind, "conflict");
  }
  const query = "https://vv-app.eticketing.co.uk/v810/venueAvailability/buy?eventId=1480";
  assert.equal(requestFixture(requestWith(observedCommand(), {url: query}), 1480).kind, "conflict");
});
test("malformed, duplicate, escaped and competing command event fields fail closed", () => {
  const texts = [
    '{"command":{"eventId":1481}}',
    '{"command":{"targetEvent":"1481"}}',
    '{"command":null}', '{"command":[]}',
    '{"command":{"eventId":1481,"eventId":1480,"targetEvent":"1481"}}',
    '{"command":{"eventId":1481,"targetEvent":"1481","targetEvent":"1480"}}',
    '{"command":{"eventId":1481,"targetEvent":"1481"},"command":{"eventId":1481,"targetEvent":"1481"}}',
    '{"eventId":1481,"command":{"eventId":1481,"targetEvent":"1481"}}',
    '{"command":{"eventId":1481,"targetEvent":"1481"},"other":{"eventId":1481}}',
    '{"comm\\u0061nd":{"eventId":1481,"targetEvent":"1481"}}',
    '{"command":{"eventId":1481,"targ\\u0065tEvent":"1481"}}'
  ];
  for (const text of texts) {
    assert.equal(requestFixture(requestWith({}, {postData: {mimeType: "application/x-www-form-urlencoded", text}}), 1481).kind, "unknown", text);
  }
});
test("command extraction retains no unrelated payload fields", () => {
  const body = observedCommand();
  body.command.account = "fake-private-account";
  body.command.token = "fake-private-token";
  body.unrelated = {privateField: "fake-private-field"};
  const output = JSON.stringify(requestFixture(requestWith(body), 1481));
  for (const value of ["fake-private-account", "fake-private-token", "fake-private-field", "privateField", "account", "token"]) {
    assert.equal(output.includes(value), false);
  }
});
