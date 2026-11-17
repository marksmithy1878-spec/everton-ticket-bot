"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const crypto = require("node:crypto");
const alerts = require("./alert_engine.js");
const telegram = require("./telegram_client.js");
const token = "123456:" + "x".repeat(35);
const chat = "1234567";
function lockManager() {
  let held = false;
  return {async request(name, options, callback) {
    if (held) return callback(null);
    held = true;
    try {return await callback({name});} finally {held = false;}
  }};
}
function harness({map = new Map(), locks = lockManager(), wrongBot = false, holdHeartbeat = null} = {}) {
  const elements = new Map();
  const timers = [];
  const listeners = {};
  const calls = [];
  const page = {correct: true, blocked: false};
  let now = Date.parse("2026-11-17T12:00:00Z");
  let inspections = 0;
  let bodyReads = 0;
  function el() {return {disabled: false, checked: false, value: "", textContent: "", events: {}, addEventListener(name, fn) {this.events[name] = fn;}};}
  class Clock extends Date {static now() {return now;}}
  const storage = {getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value)};
  const context = vm.createContext({
    window: {}, Date: Clock, Object, Promise, navigator: {locks}, localStorage: storage,
    document: {getElementById(id) {if (!elements.has(id)) elements.set(id, el()); return elements.get(id);}},
    chrome: {permissions: {contains(options, callback) {callback(true);}}, devtools: {network: {
      onRequestFinished: {addListener(fn) {listeners.request = fn;}},
      onNavigated: {addListener(fn) {listeners.navigation = fn;}},
      getHAR() {throw new Error("Pilot must not import historical records");}
    }, inspectedWindow: {reload() {throw new Error("Pilot must never reload Everton");}}}},
    setInterval(fn) {timers.push(fn);},
    inspectPage: async () => {inspections++; return {...page};},
    halt(message, restricted) {if (restricted) storage.setItem("everton-restriction-observed", "true");},
    EvertonProbe: require("./probe.js"), EvertonResponseReader: require("./response_reader.js"),
    EvertonAlerts: {...alerts, createEngine: options => alerts.createEngine({...options, now: () => now,
      hash: async evidence => crypto.createHash("sha256").update(JSON.stringify(evidence.sections)).digest("hex")})},
    EvertonTelegram: {probeConnection: options => telegram.probeConnection({...options, now: () => now, fetchImpl: async (url, settings) => {
      calls.push({url, options: settings});
      return {status: 404, ok: false, async json() {return {ok: false, error_code: 404};}};
    }}), createClient: (t, c) => telegram.createClient(t, c, {now: () => now, fetchImpl: async (url, options) => {
      calls.push({url, options});
      const method = url.endsWith("/getMe") ? "getMe" : "sendMessage";
      if (holdHeartbeat && method === "sendMessage" && JSON.parse(options.body).text.startsWith("DAYTIME HELPER STATUS")) await new Promise(resolve => holdHeartbeat(resolve));
      return {status: 200, ok: true, async json() {return method === "getMe" ?
        {ok: true, result: {is_bot: true, username: wrongBot ? "MarksReminderBot" : "EvertonResale_bot"}} :
        {ok: true, result: {message_id: calls.length, chat: {id: Number(c)}}};}};
    }})},
    fetch() {throw new Error("Unexpected fetch outside Telegram transport");}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "pilot_ui.js"), "utf8"), context);
  const click = async id => {const e = elements.get(id); if (!e.disabled) return e.events.click();};
  const set = (id, value) => {elements.get(id).checked = value; elements.get(id).events.change();};
  const input = (id, value) => {elements.get(id).value = value; elements.get(id).events.input();};
  async function connect() {input("pilotToken", token); input("pilotChat", chat); await click("pilotTest"); await drain();}
  async function arm() {await connect(); set("pilotPhone", true); set("pilotPolicy", true); await click("pilotStart"); await drain();}
  function native({eventId = 1480, count = 1, status = 200, at = now, hold = null} = {}) {
    return {request: {method: "POST", url: "https://vv-app.eticketing.co.uk/v810/venueAvailability/buy",
      postData: {mimeType: "application/x-www-form-urlencoded", text: JSON.stringify({command: {eventId, targetEvent: String(eventId)}})}},
      response: {status}, startedDateTime: new Date(at).toISOString(),
      getContent(callback) {bodyReads++; if (hold) {hold(callback); return;}
        callback(JSON.stringify({errorCode: status === 200 ? 200 : 5085, data: {section: {header: "sectionName~totalAvailableSeat", data: [`014~${count}`]}}}), "");}}
  }
  return {elements, calls, page, listeners, map, timers, click, set, input, connect, arm, native,
    advance(ms) {now += ms;}, inspections: () => inspections, bodyReads: () => bodyReads,
    sends: () => calls.filter(call => call.url.endsWith("/sendMessage"))};
}
async function drain() {for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve));}

test("pilot is OFF by default, makes no calls, and ignores native inventory before arming", async () => {
  const h = harness(); h.listeners.request(h.native()); await drain();
  assert.equal(h.calls.length, 0); assert.equal(h.bodyReads(), 0);
  assert.equal(h.elements.get("pilotStart").disabled, true);
});
test("test gate verifies the correct bot, clears fields and does not arm", async () => {
  const h = harness(); await h.connect();
  assert.equal(h.sends().length, 1);
  assert.match(JSON.parse(h.sends()[0].options.body).text, /^TEST/);
  assert.equal(h.elements.get("pilotToken").value, "");
  assert.equal(h.elements.get("pilotChat").value, "");
  assert.equal(h.elements.get("pilotStart").disabled, true);
  h.listeners.request(h.native()); await drain(); assert.equal(h.sends().length, 1);
});
test("wrong bot cannot send even a test or arm the pilot", async () => {
  const h = harness({wrongBot: true}); await h.connect();
  assert.equal(h.sends().length, 0); assert.equal(h.elements.get("pilotStart").disabled, true);
});
test("both phone receipt and local pilot approval are mandatory", async () => {
  const h = harness(); await h.connect(); h.set("pilotPhone", true);
  assert.equal(h.elements.get("pilotStart").disabled, true);
  h.set("pilotPolicy", true); assert.equal(h.elements.get("pilotStart").disabled, false);
});
test("fresh native Liverpool response goes through actual decoder, classifier and transport", async () => {
  const h = harness(); await h.arm(); h.advance(1000);
  h.listeners.request(h.native()); await drain();
  assert.equal(h.sends().length, 2);
  assert.match(JSON.parse(h.sends()[1].options.body).text, /^POSSIBLE TICKET OPPORTUNITY/);
  assert.match(h.elements.get("pilotStatus").textContent, /accepted by Telegram/);
});
test("Fulham, HTTP540 and pre-arm records never generate ticket messages", async () => {
  const h = harness(); await h.arm(); h.advance(1000);
  h.listeners.request(h.native({eventId: 1481}));
  h.listeners.request(h.native({status: 540}));
  h.listeners.request(h.native({at: Date.parse("2026-11-16T12:00:00Z")}));
  await drain(); assert.equal(h.sends().length, 1);
});
test("same native callback is not delivered twice", async () => {
  const h = harness(); await h.arm(); h.advance(1000);
  const entry = h.native(); h.listeners.request(entry); h.listeners.request(entry); await drain();
  assert.equal(h.sends().length, 2);
  assert.match(h.elements.get("pilotStatus").textContent, /already alerted/);
});
test("restriction stops before reading its body and survives another panel", async () => {
  const h = harness(); await h.arm(); h.advance(1000);
  h.listeners.request(h.native({status: 403})); await drain();
  assert.equal(h.bodyReads(), 0); assert.equal(h.map.get("everton-restriction-observed"), "true");
  assert.equal(h.elements.get("pilotStart").disabled, true);
  const reopened = harness({map: h.map}); await reopened.connect(); reopened.set("pilotPhone", true); reopened.set("pilotPolicy", true);
  assert.equal(reopened.elements.get("pilotStart").disabled, true);
});
test("visible challenge at arm time stops the pilot", async () => {
  const h = harness(); h.page.blocked = true; await h.arm();
  assert.equal(h.map.get("everton-restriction-observed"), "true");
  h.listeners.request(h.native()); await drain(); assert.equal(h.bodyReads(), 0);
});
test("sign-in expiry or leaving Liverpool stops and clears credentials", async () => {
  const h = harness(); await h.arm(); h.page.correct = false; h.listeners.navigation(); await drain();
  assert.match(h.elements.get("pilotStatus").textContent, /Pilot OFF/);
  h.page.correct = true; h.listeners.request(h.native()); await drain(); assert.equal(h.sends().length, 1);
  assert.equal(h.elements.get("pilotStart").disabled, true);
});
test("navigation during a read discards old work, then a new normal response can alert", async () => {
  let finish;
  const h = harness(); await h.arm(); h.advance(1000);
  h.listeners.request(h.native({hold: callback => {finish = callback;}})); await drain();
  h.listeners.request(h.native({count: 2}));
  h.listeners.navigation(); await drain();
  finish(JSON.stringify({errorCode: 200, data: {section: {header: "sectionName~totalAvailableSeat", data: ["014~1"]}}}), "");
  await drain(); assert.equal(h.sends().length, 1);
  h.advance(1000); h.listeners.request(h.native({count: 3})); await drain(); assert.equal(h.sends().length, 2);
});
test("stop during a pending read cannot send a later alert", async () => {
  let finish;
  const h = harness(); await h.arm(); h.advance(1000);
  h.listeners.request(h.native({hold: callback => {finish = callback;}})); await drain();
  await h.click("pilotStop");
  finish(JSON.stringify({errorCode: 200, data: {section: {header: "sectionName~totalAvailableSeat", data: ["014~1"]}}}), "");
  await drain(); assert.equal(h.sends().length, 1);
});
test("withdrawing approval immediately stops the active pilot", async () => {
  const h = harness(); await h.arm(); h.set("pilotPolicy", false);
  h.listeners.request(h.native()); await drain(); assert.equal(h.sends().length, 1);
  assert.match(h.elements.get("pilotStatus").textContent, /Approval withdrawn/);
});
test("changing credentials after a test invalidates its approval gate", async () => {
  const h = harness(); await h.connect(); h.set("pilotPhone", true); h.set("pilotPolicy", true);
  h.input("pilotChat", "9999999");
  assert.equal(h.elements.get("pilotStart").disabled, true);
});
test("single-session lock prevents another panel from arming", async () => {
  const locks = lockManager();
  const first = harness({locks}); await first.arm();
  const second = harness({locks}); await second.arm();
  assert.match(second.elements.get("pilotStatus").textContent, /Another daytime pilot/);
  second.listeners.request(second.native()); await drain(); assert.equal(second.sends().length, 1);
  await first.click("pilotStop"); await drain();
  await second.click("pilotStart"); await drain();
  assert.match(second.elements.get("pilotStatus").textContent, /DAYTIME PILOT ON/);
});
test("local timer does not inspect or refresh the ticket page", async () => {
  const h = harness(); await h.arm(); const inspections = h.inspections();
  for (const timer of h.timers) timer(); await drain();
  assert.equal(h.inspections(), inspections); assert.equal(h.sends().length, 1);
});


test("a fresh opportunity waits for an in-flight heartbeat and is still delivered", async () => {
  let finish;
  const h = harness({holdHeartbeat: resolve => {finish = resolve;}}); await h.arm();
  h.advance(3600001); for (const timer of h.timers) timer(); await drain();
  assert.equal(h.sends().length, 2);
  h.listeners.request(h.native()); await drain();
  assert.equal(h.sends().length, 2);
  finish(); await drain();
  assert.equal(h.sends().length, 3);
  assert.match(JSON.parse(h.sends()[2].options.body).text, /^POSSIBLE TICKET OPPORTUNITY/);
});


test("connection check needs no credentials, sends no message and cannot arm alerts", async () => {
  const h = harness();
  h.input("pilotToken", "fake-private-input");
  h.input("pilotChat", "fake-private-chat");
  await h.click("pilotConnection"); await drain();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, "https://api.telegram.org/bot/getMe");
  assert.deepEqual(JSON.parse(h.calls[0].options.body), {});
  assert.equal(h.sends().length, 0);
  assert.equal(h.elements.get("pilotStart").disabled, true);
  assert.match(h.elements.get("pilotConnectionStatus").textContent, /permission: granted/);
  assert.match(h.elements.get("pilotConnectionStatus").textContent, /TELEGRAM_PUBLIC_API_REACHED/);
  assert.equal(h.elements.get("pilotConnectionStatus").textContent.includes("fake-private"), false);
});

test("connection diagnostics are disabled while the pilot is active", async () => {
  const h = harness(); await h.arm();
  const calls = h.calls.length;
  assert.equal(h.elements.get("pilotConnection").disabled, true);
  await h.click("pilotConnection"); assert.equal(h.calls.length, calls);
});
