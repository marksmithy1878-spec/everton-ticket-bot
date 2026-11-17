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
test("manifest has no host permissions and forbids outbound extension connections", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json")));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.permissions, undefined);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
  assert.match(manifest.content_security_policy.extension_pages, /connect-src 'none'/);
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
  assert.deepEqual(Object.keys(output).sort(), ["blocked", "correct", "unavailableRedirect"]);
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
