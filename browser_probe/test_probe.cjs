"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const probe = require("./probe.js");
const start = Date.parse("2026-11-16T19:00:00Z");
function entry(overrides = {}) {
  return { request: { url: "https://vv-app.eticketing.co.uk/v810/venueAvailability/buy" },
    response: { status: 200 }, startedDateTime: new Date(start + 1000).toISOString(), ...overrides };
}

test("filters only the captured availability service origin and version", () => {
  for (const url of ["https://other.test/evertonfc/venueAvailability/buy", "https://www.eticketing.co.uk/other/venueAvailability/buy", "http://www.eticketing.co.uk/evertonfc/venueAvailability/buy", "https://www.eticketing.co.uk.evil.test/evertonfc/venueAvailability/buy", "https://www.eticketing.co.uk/evertonfc/pricing/buy", "https://www.eticketing.co.uk/evertonfc/api/venueAvailability/buy", "https://vv-app.eticketing.co.uk.evil.test/v810/venueAvailability/buy", "https://vv-app.eticketing.co.uk/v810/pricing/buy", "https://vv-app.eticketing.co.uk/v811/venueAvailability/buy", "https://vv-app.eticketing.co.uk/v810/venueAvailability/notbuy", "not-a-url"]) {
    assert.equal(probe.summarize(entry({ request: { url } }), start), null);
  }
  assert.equal(probe.summarize(entry(), start).family, "venueAvailability");
  assert.equal(probe.summarize(entry({ request: { url: "https://vv-app.eticketing.co.uk/v810/AreaAvailability/buy?eventId=1480" } }), start).family, "AreaAvailability");
});
test("wrong eventId is excluded and missing eventId is explicitly unconfirmed", () => {
  assert.equal(probe.summarize(entry({ request: { url: "https://vv-app.eticketing.co.uk/v810/venueAvailability/buy?eventId=1481" } }), start), null);
  assert.equal(probe.summarize(entry({ request: { url: "https://vv-app.eticketing.co.uk/v810/venueAvailability/buy" } }), start).association, "page-context-only");
});
test("old requests finishing later do not become new idle updates", () => {
  const item = probe.summarize(entry({ startedDateTime: new Date(start - 1000).toISOString() }), start);
  assert.equal(item.timing, "already-in-log");
  assert.equal(probe.summarize(entry(), start).timing, "started-during-check");
});
test("invalid status, timestamps and unexpected data fail closed", () => {
  for (const data of [null, {}, entry({ startedDateTime: "bad" }), entry({ response: { status: "200" } }), entry({ response: { status: 999 } })]) {
    assert.equal(probe.summarize(data, start), null);
  }
});
test("access restrictions are flagged; 540 is an ordinary unknown error", () => {
  for (const status of [401, 403, 429]) assert.equal(probe.summarize(entry({ response: { status } }), start).restriction, true);
  assert.equal(probe.summarize(entry({ response: { status: 540 } }), start).restriction, false);
});
test("raw query tokens, request/response headers, bodies and personal data never reach reports", () => {
  const raw = entry({ request: { url: "https://vv-app.eticketing.co.uk/v810/venueAvailability/buy?eventId=1480&token=secret-query", headers: [{ value: "secret-header" }], postData: { text: "private-account" } }, response: { status: 200, content: { text: "private-seat-response" } } });
  const item = probe.summarize(raw, start);
  item.raw = raw;
  const output = JSON.stringify(probe.makeReport(start, start + 10000, [item], false, true));
  for (const privateValue of ["secret-query", "secret-header", "private-account", "private-seat-response", "https://"]) assert.equal(output.includes(privateValue), false);
  assert.equal(JSON.parse(output).ticket_detection_validated, false);
});
test("manifest permits Telegram only and no ticket-site network access", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json")));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.permissions, undefined);
  assert.deepEqual(manifest.host_permissions, ["https://api.telegram.org/*"]);
  assert.equal(manifest.content_scripts, undefined);
  assert.match(manifest.content_security_policy.extension_pages, /connect-src https:\/\/api\.telegram\.org$/);
});

// Run the complete panel against simulated DevTools/DOM APIs, without any website.
function harness({ log = [], store = new Map() } = {}) {
  const elements = new Map();
  const timers = [];
  const listeners = {};
  const page = { URLSearchParams, location: { origin: "https://www.eticketing.co.uk", pathname: "/evertonfc/EDP/Event/Index/1480" }, document: { body: { innerText: "Ticket page" } } };
  const counters = { inspections: 0, harReads: 0 };
  function element() {
    return { textContent: "", disabled: false, events: {}, children: [], classList: { toggle() {} },
      replaceChildren(...children) { this.children = children; }, append(child) { this.children.push(child); },
      addEventListener(name, handler) { this.events[name] = handler; }, click() {} };
  }
  const context = vm.createContext({
    window: {}, Date, URL, Blob, String, Set, Map, Object, console,
    EvertonResponseReader: require("./response_reader.js"),
    localStorage: { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) },
    document: { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, createElement: element },
    setInterval: callback => { timers.push(callback); return 1; }, setTimeout: () => 1,
    // Any accidental active networking or reload would fail this harness.
    fetch() { throw new Error("Forbidden network call"); },
    XMLHttpRequest: class { constructor() { throw new Error("Forbidden XHR"); } },
    chrome: { devtools: {
      inspectedWindow: { eval(expression, callback) { counters.inspections++; callback(vm.runInNewContext(expression, page), null); }, reload() { throw new Error("Forbidden reload"); } },
      network: {
        getHAR(callback) { counters.harReads++; callback({ entries: log }); },
        onRequestFinished: { addListener(callback) { listeners.request = callback; } },
        onNavigated: { addListener(callback) { listeners.navigation = callback; } }
      }
    } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "probe.js"), "utf8"), context);
  context.EvertonProbe = context.window.EvertonProbe;
  vm.runInContext(fs.readFileSync(path.join(__dirname, "panel.js"), "utf8"), context);
  return { context, elements, page, counters, timers, listeners, store };
}
const drain = () => new Promise(resolve => setImmediate(resolve));
function currentEntry(delta = 0, status = 200) { return entry({ startedDateTime: new Date(Date.now() + delta).toISOString(), response: { status } }); }

test("panel starts without reloading and imports existing records as old", async () => {
  const h = harness({ log: [entry()] });
  await h.elements.get("start").events.click(); await drain();
  assert.equal(h.elements.get("old").textContent, 1);
  assert.equal(h.elements.get("new").textContent, 0);
  assert.equal(h.counters.harReads, 1);
});
test("a new request is counted once even when log and event callbacks overlap", async () => {
  const h = harness();
  await h.elements.get("start").events.click();
  const item = currentEntry();
  h.listeners.request(item); h.listeners.request(item); await drain();
  assert.equal(h.elements.get("new").textContent, 1);
});
test("UI timer only renders locally and makes no page inspections", () => {
  const h = harness();
  const calls = h.counters.inspections;
  for (const timer of h.timers) timer();
  assert.equal(h.counters.inspections, calls);
  assert.equal(h.counters.harReads, 0);
});
test("wrong inspected page cannot start", async () => {
  const h = harness(); h.page.location.pathname = "/evertonfc/EDP/Event/Index/1481";
  await h.elements.get("start").events.click();
  assert.equal(h.counters.harReads, 0);
  assert.match(h.elements.get("status").textContent, /only runs/);
});
test("navigation stops recording", async () => {
  const h = harness(); await h.elements.get("start").events.click();
  h.listeners.navigation(); h.listeners.request(currentEntry()); await drain();
  assert.equal(h.elements.get("new").textContent, 0);
  assert.equal(h.elements.get("finish").disabled, true);
});
test("403 stops the check and persists the restriction across panel reopen", async () => {
  const h = harness(); await h.elements.get("start").events.click();
  h.listeners.request(currentEntry(0, 403)); await drain();
  assert.match(h.elements.get("status").textContent, /restriction observed/);
  assert.equal(h.elements.get("start").disabled, true);
  const reopened = harness({ store: h.store });
  assert.equal(reopened.elements.get("start").disabled, true);
  await reopened.elements.get("start").events.click();
  assert.equal(reopened.counters.harReads, 0);
});
test("visible suspicious-activity message stops even with HTTP 200", async () => {
  const h = harness(); await h.elements.get("start").events.click();
  h.page.document.body.innerText = "Suspicious activity. Please wait.";
  h.listeners.request(currentEntry()); await drain();
  assert.equal(h.elements.get("start").disabled, true);
  assert.match(h.elements.get("status").textContent, /restriction observed/);
});
test("finishing stops the observer and keeps a report available", async () => {
  const h = harness(); await h.elements.get("start").events.click();
  h.elements.get("finish").events.click(); h.listeners.request(currentEntry()); await drain();
  assert.equal(h.elements.get("new").textContent, 0);
  assert.equal(h.elements.get("save").disabled, false);
});
test("fixture inspection returns booleans rather than page contents or URLs", () => {
  const h = harness();
  const expression = vm.runInContext("PAGE_CHECK", h.context);
  const output = vm.runInNewContext(expression, h.page);
  assert.deepEqual(Object.keys(output).sort(), ["blocked", "comparison", "correct", "unavailableRedirect"]);
  assert.equal(output.correct, true);
  assert.equal(output.blocked, false);
});

// The endpoint below is transcribed from a real screenshot, not a mock route.
test("captured Liverpool 540 request on vv-app is observed rather than silently ignored", () => {
  const data = entry({ request: { url: "https://vv-app.eticketing.co.uk/v810/venueAvailability/buy", method: "POST" }, response: { status: 540 } });
  const item = probe.summarize(data, start);
  assert.equal(item.family, "venueAvailability");
  assert.equal(item.status, 540);
  assert.equal(item.association, "page-context-only");
});
test("captured service request can explicitly identify event 1480 without exporting other query data", () => {
  const data = entry({ request: { url: "https://vv-app.eticketing.co.uk/v810/venueAvailability/buy?eventId=1480&token=private" } });
  const item = probe.summarize(data, start);
  assert.equal(item.association, "request-event-1480");
  assert.equal(JSON.stringify(item).includes("private"), false);
});
test("event-unavailable redirect explains the refusal without reading or replaying requests", async () => {
  const h = harness();
  h.page.location.pathname = "/evertonfc/EDP/Validation/EventNotAllowed";
  h.page.location.search = "?eventId=1480&reason=EventNoAvailableSalesModesOrSoldOut";
  await h.elements.get("start").events.click();
  assert.equal(h.counters.harReads, 0);
  assert.equal(h.elements.get("new").textContent, 0);
  assert.match(h.elements.get("status").textContent, /redirected event 1480/);
  assert.equal(h.elements.get("save").disabled, true);
});
test("another event or duplicate event identifiers do not get the Liverpool redirect label", async () => {
  for (const query of ["?eventId=1481", "?eventId=1480&eventId=1481"]) {
    const h = harness();
    h.page.location.pathname = "/evertonfc/EDP/Validation/EventNotAllowed";
    h.page.location.search = query;
    await h.elements.get("start").events.click();
    assert.equal(h.counters.harReads, 0);
    assert.doesNotMatch(h.elements.get("status").textContent, /redirected event 1480/);
  }
});

test("response review identifies POST errors and OPTIONS successes without reading preflight bodies", async () => {
  const failure = currentEntry(-1000, 540);
  failure.request.method = "POST";
  failure.getContent = callback => callback(JSON.stringify({ errorCode: 5085, private: "fake-private-value" }), "");
  const preflight = currentEntry(-999, 200);
  preflight.request.method = "OPTIONS";
  preflight.getContent = () => { throw new Error("must not be read"); };
  const h = harness({ log: [failure, preflight] });
  await h.elements.get("readResponses").events.click(); await drain();
  const report = vm.runInContext("responseReview", h.context);
  assert.equal(report.capture_completed, true);
  assert.equal(report.records_reviewed, 2);
  assert.equal(report.observations[0].response.api_error_code, 5085);
  assert.equal(report.observations[1].response.reason, "PREFLIGHT_NOT_INVENTORY");
  assert.equal(JSON.stringify(report).includes("fake-private-value"), false);
  assert.equal(h.elements.get("saveResponses").disabled, false);
});
test("response review does not read buffers when the inspected page is wrong", async () => {
  const h = harness(); h.page.location.pathname = "/evertonfc/EDP/Event/Index/9999";
  await h.elements.get("readResponses").events.click();
  assert.equal(h.counters.harReads, 0);
});
test("response review stops an idle observation rather than silently mixing modes", async () => {
  const h = harness(); await h.elements.get("start").events.click();
  await h.elements.get("readResponses").events.click(); await drain();
  assert.equal(h.elements.get("finish").disabled, true);
  assert.match(h.elements.get("status").textContent, /stopped for a review/);
});
test("response review latches a historical access restriction without reading its body", async () => {
  const entry = currentEntry(-1000, 403); entry.request.method = "POST";
  entry.getContent = () => { throw new Error("must not read"); };
  const h = harness({ log: [entry] });
  await h.elements.get("readResponses").events.click(); await drain();
  const report = vm.runInContext("responseReview", h.context);
  assert.equal(report.restriction_observed, true);
  assert.equal(report.capture_completed, false);
  assert.equal(h.elements.get("readResponses").disabled, true);
  assert.equal(h.store.get("everton-restriction-observed"), "true");
});

test("navigation during a body read makes the review incomplete", async () => {
  let finishRead;
  const entry = currentEntry(-1000, 200); entry.request.method = "POST";
  entry.getContent = callback => { finishRead = callback; };
  const h = harness({ log: [entry] });
  await h.elements.get("readResponses").events.click(); await drain();
  h.listeners.navigation();
  finishRead(JSON.stringify({ errorCode: 200 }), ""); await drain();
  const report = vm.runInContext("responseReview", h.context);
  assert.equal(report.capture_completed, false);
  assert.equal(report.records_reviewed, 0);
});
test("preflight and POST records with identical time and status do not collapse together", async () => {
  const h = harness(); await h.elements.get("start").events.click();
  const first = currentEntry(); first.request.method = "OPTIONS";
  const second = { ...first, request: { ...first.request, method: "POST" } };
  h.listeners.request(first); h.listeners.request(second); await drain();
  assert.equal(h.elements.get("new").textContent, 2);
});
test("an unavailable DevTools log is not reported as a completed empty review", async () => {
  const h = harness({ log: null });
  await h.elements.get("readResponses").events.click(); await drain();
  const report = vm.runInContext("responseReview", h.context);
  assert.equal(report.metadata_available, false);
  assert.equal(report.capture_completed, false);
  assert.equal(report.records_reviewed, 0);
});


test("comparison filtering requires an allowlisted fixture and excludes conflicting event IDs", () => {
  const withId = id => entry({request: {url: `https://vv-app.eticketing.co.uk/v810/venueAvailability/buy?eventId=${id}`}});
  assert.equal(probe.summarize(withId(1481), start, 1481).association, "request-event-1481");
  assert.equal(probe.summarize(withId(1480), start, 1481), null);
  assert.equal(probe.summarize(withId(1481), start), null);
  assert.equal(probe.summarize(entry(), start, 9999), null);
});

test("Fulham positive comparison stays unknown and is labelled separately from Liverpool", async () => {
  const item = currentEntry(-1000, 200); item.request.method = "POST";
  item.getContent = callback => callback(JSON.stringify({errorCode: 200, data: {section: {
    header: "sectionName~totalAvailableSeat~priceCode", data: ["205~31~98", "242~4~101", "243~3~101"]
  }}}), "");
  const h = harness({log: [item]}); h.page.location.pathname = "/evertonfc/EDP/Event/Index/1481";
  await h.elements.get("readResponses").events.click(); await drain();
  const report = vm.runInContext("responseReview", h.context);
  assert.equal(report.event_id, 1481);
  assert.equal(report.comparison_only, true);
  assert.equal(report.page_event_1480_verified, false);
  assert.equal(report.page_event_1481_verified, true);
  assert.equal(report.capture_completed, true);
  assert.equal(report.observations[0].response.reported_places, 38);
  assert.equal(report.observations[0].state, "ERROR/UNKNOWN");
  assert.equal(report.ticket_detection_validated, false);
  assert.match(h.elements.get("responseStatus").textContent, /Fulham comparison ONLY/);
  assert.match(h.elements.get("responseFixture").textContent, /checked locally/);
  await h.elements.get("start").events.click();
  assert.equal(h.elements.get("finish").disabled, true);
});

test("switching fixtures during comparison review cannot complete the capture", async () => {
  let finishRead;
  const item = currentEntry(-1000, 200); item.request.method = "POST";
  item.getContent = callback => { finishRead = callback; };
  const h = harness({log: [item]}); h.page.location.pathname = "/evertonfc/EDP/Event/Index/1481";
  await h.elements.get("readResponses").events.click(); await drain();
  h.page.location.pathname = "/evertonfc/EDP/Event/Index/1480";
  finishRead(JSON.stringify({errorCode: 200}), ""); await drain();
  const report = vm.runInContext("responseReview", h.context);
  assert.equal(report.event_id, 1481);
  assert.equal(report.capture_completed, false);
});


test("comparison passes its own expected fixture into the request decoder", async () => {
  const item = currentEntry(-1000, 200); item.request.method = "POST";
  item.request.postData = {mimeType: "application/x-www-form-urlencoded", text: JSON.stringify({command: {eventId: 1481, targetEvent: "1481", token: "fake-sensitive-value"}})};
  item.getContent = callback => callback(JSON.stringify({errorCode: 200, data: {section: {
    header: "sectionName~totalAvailableSeat", data: ["216~2", "227~14"]
  }}}), "");
  const h = harness({log: [item]}); h.page.location.pathname = "/evertonfc/EDP/Event/Index/1481";
  await h.elements.get("readResponses").events.click(); await drain();
  const report = vm.runInContext("responseReview", h.context);
  assert.equal(report.observations[0].request_fixture.event_id, 1481);
  assert.equal(report.observations[0].request_fixture.matches_page_event, true);
  assert.equal(report.observations[0].state, "ERROR/UNKNOWN");
  assert.equal(JSON.stringify(report).includes("fake-sensitive-value"), false);
  assert.equal(h.elements.get("responseRows").children[0].children[2].textContent, "Request event 1481 matches page");
});
