"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {classify, quietHours, message, createEngine} = require("./alert_engine.js");
const START = Date.parse("2026-11-17T12:00:00Z");
function record(at = START + 1000, count = 1) {
  return {method: "POST", family: "venueAvailability", status: 200, request_started_at: new Date(at).toISOString(),
    request_fixture: {kind: "explicit-event", event_id: 1480, matches_page_event: true, source: "request-form-json-command"},
    response: {kind: "section-counts", reported_places: count, sections: [{section: "014", reported_places: count}]}};
}
const context = {pageCorrect: true, restricted: false, armedAt: START, policyAccepted: true, now: START + 2000};
function storage() {
  const map = new Map();
  return {getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), map};
}
function setup(send = async () => ({ok: true}), store = storage()) {
  let now = START + 2000;
  const sent = [];
  const engine = createEngine({storage: store, now: () => now, hash: async evidence =>
    require("node:crypto").createHash("sha256").update(JSON.stringify(evidence.sections)).digest("hex"),
    send: async text => { sent.push(text); return send(text); }});
  return {engine, store, sent, time: value => {now = value;}, now: () => now};
}
test("fresh explicit Liverpool command counts are only POSSIBLE, never AVAILABLE", () => {
  const output = classify(record(), context);
  assert.equal(output.state, "POSSIBLE");
  assert.equal(output.total, 1);
  assert.match(message(output), /^POSSIBLE TICKET OPPORTUNITY/);
  assert.match(message(output), /purchase are unconfirmed/);
});
test("approval and correct page are mandatory; Fulham can never alert", () => {
  assert.equal(classify(record(), {...context, policyAccepted: false}).state, "ERROR/UNKNOWN");
  assert.equal(classify(record(), {...context, pageCorrect: false}).state, "ERROR/UNKNOWN");
  const r = record(); r.request_fixture.event_id = 1481;
  assert.equal(classify(r, context).state, "ERROR/UNKNOWN");
  r.request_fixture.event_id = 1480; r.request_fixture.source = "request-query-and-body";
  assert.equal(classify(r, context).state, "ERROR/UNKNOWN");
  r.request_fixture.source = "request-json-root";
  assert.equal(classify(r, context).state, "ERROR/UNKNOWN");
});
test("page/map/pricing/preflight and HTTP errors are not opportunities", () => {
  for (const patch of [{method: "OPTIONS"}, {method: "GET"}, {status: 540}, {status: 500}, {response: {kind: "api-error", api_error_code: 5085}}, {response: {kind: "unknown"}}, {family: "pricing"}]) {
    assert.equal(classify({...record(), ...patch}, context).state, "ERROR/UNKNOWN");
  }
});
test("restrictions are stop conditions even with successful inventory or absent records", () => {
  for (const status of [401, 403, 429]) assert.equal(classify({...record(), status}, context).stop, true);
  assert.equal(classify(null, {...context, restricted: true}).stop, true);
});
test("old, pre-arm, future and malformed timestamps are rejected", () => {
  for (const at of [START - 1, START + 3000, START - 200000]) assert.equal(classify(record(at), context).state, "ERROR/UNKNOWN");
  assert.equal(classify({...record(), request_started_at: "bad"}, context).state, "ERROR/UNKNOWN");
  assert.equal(classify(record(), {...context, now: START + 121001}).state, "ERROR/UNKNOWN");
});
test("zero, mismatched, malformed and duplicate section counts fail closed", () => {
  assert.equal(classify(record(START + 1000, 0), context).state, "ERROR/UNKNOWN");
  const r = record(); r.response.reported_places = 2;
  assert.equal(classify(r, context).state, "ERROR/UNKNOWN");
  for (const section of [{section: "014", reported_places: -1}, {section: "private value", reported_places: 1}, {section: "014", reported_places: "1"}]) {
    const r = record(); r.response.sections = [section];
    assert.equal(classify(r, context).state, "ERROR/UNKNOWN");
  }
  const dup = record(); dup.response.sections.push({...dup.response.sections[0]}); dup.response.reported_places = 2;
  assert.equal(classify(dup, context).state, "ERROR/UNKNOWN");
});
test("repeated callbacks and equivalent section order suppress duplicates", async () => {
  const h = setup();
  await h.engine.consider(record(), context);
  assert.equal((await h.engine.consider(record(), context)).code, "DUPLICATE_SUPPRESSED");
  assert.equal(h.sent.length, 1);
});
test("a different opportunity can alert immediately; A-B-A is suppressed", async () => {
  const h = setup();
  assert.equal((await h.engine.consider(record(), context)).delivered, true);
  assert.equal((await h.engine.consider(record(START + 1000, 2), context)).delivered, true);
  assert.equal((await h.engine.consider(record(), context)).code, "DUPLICATE_SUPPRESSED");
  assert.equal(h.sent.length, 2);
});
test("delivered fingerprints survive a new engine and contain no raw observations", async () => {
  const h = setup(); const r = record(); r.secret = "fake-private-data";
  await h.engine.consider(r, context);
  const reopened = setup(undefined, h.store);
  assert.equal((await reopened.engine.consider(record(), context)).code, "DUPLICATE_SUPPRESSED");
  assert.equal(JSON.stringify([...h.store.map]).includes("fake-private-data"), false);
  assert.equal(JSON.stringify([...h.store.map]).includes("014"), false);
});
test("failed notifications remain unconfirmed and retry only with fresh data after a minute", async () => {
  let succeeds = false;
  const h = setup(async () => ({ok: succeeds}));
  assert.equal((await h.engine.consider(record(), context)).code, "NOTIFICATION_FAILED");
  assert.equal((await h.engine.consider(record(), context)).code, "NOTIFICATION_RETRY_COOLDOWN");
  succeeds = true; h.time(START + 62000);
  assert.equal((await h.engine.consider(record(START + 61000), context)).delivered, true);
  assert.equal(h.sent.length, 2);
});
test("thrown notification errors never escape or enter storage", async () => {
  const h = setup(async () => {throw new Error("fake-secret-url");});
  const result = await h.engine.consider(record(), context);
  assert.equal(result.code, "NOTIFICATION_FAILED");
  assert.equal(JSON.stringify(result).includes("fake-secret-url"), false);
});
test("unreadable, corrupted or unwritable delivery state prevents alerting", async () => {
  for (const store of [{getItem() {throw new Error();}}, {getItem() {return "private-invalid";}}, {getItem() {return "[]";}, setItem() {throw new Error();}}]) {
    const h = setup(undefined, store);
    const result = await h.engine.consider(record(), context);
    assert.equal(result.stop, true); assert.equal(h.sent.length, 0);
  }
});
test("failed persistence after delivery stops the session rather than silently forgetting", async () => {
  let writes = 0;
  const h = setup(undefined, {getItem() {return null;}, setItem() {if (++writes === 2) throw new Error();}});
  const result = await h.engine.consider(record(), context);
  assert.equal(result.delivered, true); assert.equal(result.stop, true);
  assert.equal(h.engine.valid(), false);
});
test("freshness and navigation are rechecked after asynchronous fingerprinting", async () => {
  let finish, current = true;
  const h = setup();
  const engine = createEngine({storage: h.store, now: h.now, send: async () => {throw new Error("should not send");}, hash: () => new Promise(r => {finish = r;})});
  const pending = engine.consider(record(), {...context, isCurrent: () => current});
  current = false; finish("a".repeat(64));
  assert.equal((await pending).code, "SESSION_CHANGED");
});
test("hashing failure stops the pilot without a message", async () => {
  const engine = createEngine({storage: storage(), now: () => START + 2000, send: async () => {throw new Error();}, hash: async () => {throw new Error("private-error");}});
  const result = await engine.consider(record(), context);
  assert.equal(result.stop, true); assert.equal(JSON.stringify(result).includes("private-error"), false);
});
test("ticket alerts are delivered during UK quiet hours", async () => {
  const time = Date.parse("2026-11-18T02:00:00Z");
  const h = setup(); h.time(time);
  assert.equal((await h.engine.consider(record(time - 1000), {...context, armedAt: time - 2000})).delivered, true);
});
test("quiet hours follow UK time across GMT, BST and the autumn clock change", () => {
  for (const iso of ["2026-11-18T00:00:00Z", "2026-11-18T05:59:00Z", "2026-07-18T23:30:00Z", "2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z"]) assert.equal(quietHours(Date.parse(iso)), true, iso);
  for (const iso of ["2026-11-18T06:00:00Z", "2026-07-18T05:00:00Z", "2026-11-17T23:59:00Z"]) assert.equal(quietHours(Date.parse(iso)), false, iso);
});
test("routine heartbeat is quiet overnight and resumes after 6am with honest freshness", async () => {
  const h = setup(); h.time(Date.parse("2026-11-18T01:00:00Z"));
  assert.equal((await h.engine.heartbeat(null)).code, "HEARTBEAT_SUPPRESSED");
  h.time(Date.parse("2026-11-18T06:00:00Z"));
  assert.equal((await h.engine.heartbeat(null)).code, "HEARTBEAT_DELIVERED");
  assert.match(h.sent[0], /none in this session/);
  assert.match(h.sent[0], /not fresh ticket availability/);
  assert.equal((await h.engine.heartbeat(null)).code, "HEARTBEAT_SUPPRESSED");
});


test("different row ordering for the same inventory is not a new opportunity", async () => {
  const h = setup();
  const r = record(); r.response.reported_places = 3;
  r.response.sections.push({section: "015", reported_places: 2});
  await h.engine.consider(r, context);
  r.response.sections.reverse();
  assert.equal((await h.engine.consider(r, context)).code, "DUPLICATE_SUPPRESSED");
  assert.equal(h.sent.length, 1);
});

test("default SHA-256 hashing produces only an opaque persistent fingerprint", async () => {
  const store = storage();
  const engine = createEngine({storage: store, now: () => START + 2000, send: async () => ({ok: true})});
  const result = await engine.consider(record(), context);
  assert.equal(result.delivered, true);
  const saved = JSON.parse(store.getItem("everton-pilot-delivered-v1"));
  assert.match(saved[0][0], /^[a-f0-9]{64}$/);
});
