"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {createClient, probeConnection} = require("./telegram_client.js");
const token = "123456:" + "x".repeat(35);
const chat = "1234567";
const reply = (body, status = 200) => ({status, ok: status >= 200 && status < 300, async json() {return body;}});
const bot = () => reply({ok: true, result: {is_bot: true, username: "EvertonResale_bot"}});
const delivered = () => reply({ok: true, result: {message_id: 1, chat: {id: Number(chat)}}});
test("client uses only Telegram POSTs and exposes no credentials in results", async () => {
  const calls = [];
  const c = createClient(token, chat, {fetchImpl: async (url, options) => {calls.push({url, options}); return calls.length === 1 ? bot() : delivered();}});
  assert.equal((await c.verify()).ok, true);
  assert.equal((await c.send("TEST")).ok, true);
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[0].url).origin, "https://api.telegram.org");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[1].options.method, "POST");
  assert.equal(JSON.parse(calls[1].options.body).chat_id, chat);
  assert.equal(JSON.stringify(c).includes(token), false);
});
test("unverified or wrong bots cannot send", async () => {
  let calls = 0;
  const c = createClient(token, chat, {fetchImpl: async () => {calls++; return reply({ok: true, result: {is_bot: true, username: "MarksReminderBot"}});}});
  assert.equal((await c.send("TEST")).code, "BOT_NOT_VERIFIED");
  assert.equal((await c.verify()).code, "WRONG_BOT");
  assert.equal((await c.send("TEST")).ok, false);
  assert.equal(calls, 1);
});
test("malformed credentials never cause a request", async () => {
  const c = createClient("not a token", chat, {fetchImpl: async () => {throw new Error("must not call");}});
  assert.equal((await c.verify()).code, "CREDENTIALS_UNAVAILABLE");
});
test("HTTP errors, API errors and malformed JSON stay sanitized", async () => {
  for (const response of [reply({ok: false, description: token}, 403), reply({ok: false, description: token}), {status: 200, ok: true, async json() {throw new Error(token);}}]) {
    const c = createClient(token, chat, {fetchImpl: async () => response});
    const result = await c.verify();
    assert.equal(result.ok, false); assert.equal(JSON.stringify(result).includes(token), false);
  }
});
test("network errors do not leak token-bearing URLs", async () => {
  const c = createClient(token, chat, {fetchImpl: async url => {throw new Error(url);}});
  const result = await c.verify();
  assert.equal(result.code, "TELEGRAM_NETWORK_FAILED");
  assert.equal(JSON.stringify(result).includes(token), false);
});
test("429 retry_after is honored without automatic retries", async () => {
  let now = 1000, calls = 0;
  const c = createClient(token, chat, {now: () => now, fetchImpl: async () => {calls++; return reply({ok: false, parameters: {retry_after: 120}}, 429);}});
  assert.equal((await c.verify()).code, "TELEGRAM_RATE_LIMITED");
  now += 60000;
  assert.equal((await c.verify()).code, "TELEGRAM_COOLDOWN");
  assert.equal(calls, 1);
  now += 60000; await c.verify(); assert.equal(calls, 2);
});
test("success needs a returned message ID and the intended recipient", async () => {
  let calls = 0;
  const c = createClient(token, chat, {fetchImpl: async () => ++calls === 1 ? bot() : reply({ok: true, result: {message_id: 1, chat: {id: 999}}})});
  await c.verify(); assert.equal((await c.send("TEST")).code, "DELIVERY_NOT_CONFIRMED");
});
test("closing a session makes its credentials unusable", async () => {
  let calls = 0;
  const c = createClient(token, chat, {fetchImpl: async () => {calls++; return bot();}});
  await c.verify(); c.close();
  assert.equal((await c.send("TEST")).ok, false);
  assert.equal((await c.verify()).ok, false);
  assert.equal(calls, 1);
});
test("timeouts abort once and never retry", async () => {
  let calls = 0;
  const c = createClient(token, chat, {timeoutMs: 1, fetchImpl: (url, options) => new Promise((resolve, reject) => {
    calls++; options.signal.addEventListener("abort", () => reject(new Error(url)));
  })});
  assert.equal((await c.verify()).code, "TELEGRAM_TIMEOUT");
  assert.equal(calls, 1);
});


test("closing while authentication is pending cannot revive the client", async () => {
  let finish;
  const c = createClient(token, chat, {fetchImpl: () => new Promise(resolve => {finish = resolve;})});
  const pending = c.verify(); c.close(); finish(bot());
  assert.equal((await pending).ok, false);
  assert.equal((await c.send("TEST")).ok, false);
});

test("denied Telegram permission stops the credential-free probe before networking", async () => {
  let calls = 0;
  const output = await probeConnection({checkPermission: async () => false, fetchImpl: async () => {calls++; throw new Error();}});
  assert.equal(output.code, "TELEGRAM_PERMISSION_NOT_GRANTED");
  assert.equal(output.http_response_received, false);
  assert.equal(calls, 0);
});
test("token-free probe recognises an expected API error without sending credentials or messages", async () => {
  const calls = [];
  const output = await probeConnection({token: "fake-private-input", chatId: "fake-private-chat", checkPermission: async () => true,
    fetchImpl: async (url, options) => {calls.push({url, options}); return reply({ok: false, error_code: 404, description: "fake-private-response"}, 404);}});
  assert.equal(calls.length, 1); assert.equal(calls[0].url, "https://api.telegram.org/bot/getMe");
  assert.deepEqual(JSON.parse(calls[0].options.body), {});
  assert.equal(output.code, "TELEGRAM_PUBLIC_API_REACHED");
  assert.equal(output.http_response_received, true);
  assert.equal(output.api_reply_recognised, true);
  assert.equal(output.http_status, 404);
  assert.equal(JSON.stringify(output).includes("fake-private"), false);
  assert.equal(JSON.stringify(output).includes("https://"), false);
});
test("a completed unexpected HTTP response does not validate Telegram API or authentication", async () => {
  const output = await probeConnection({fetchImpl: async () => reply({ok: false, error_code: 403}, 403)});
  assert.equal(output.http_response_received, true);
  assert.equal(output.api_reply_recognised, false);
  assert.equal(output.code, "TELEGRAM_UNEXPECTED_PUBLIC_REPLY");
});
test("fetch failure and an actual deadline timeout are distinct sanitized results", async () => {
  const failed = await probeConnection({fetchImpl: async url => {throw new TypeError(url);}});
  assert.equal(failed.code, "TELEGRAM_FETCH_FAILED");
  assert.equal(failed.http_response_received, false);
  const timedOut = await probeConnection({timeoutMs: 1, fetchImpl: (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new TypeError(url)));
  })});
  assert.equal(timedOut.code, "TELEGRAM_TIMEOUT");
  assert.equal(JSON.stringify([failed, timedOut]).includes("https://"), false);
});
test("permission lookup failure or timeout remains unknown without preventing a public probe", async () => {
  for (const checkPermission of [async () => {throw new Error("fake-private-policy");}, () => new Promise(() => {})]) {
    const output = await probeConnection({checkPermission, permissionTimeoutMs: 1, fetchImpl: async () => reply({ok: false, error_code: 404}, 404)});
    assert.equal(output.permission_granted, null);
    assert.equal(output.code, "TELEGRAM_PUBLIC_API_REACHED");
    assert.equal(JSON.stringify(output).includes("fake-private-policy"), false);
  }
});
test("default browser fetch is bound to its native global receiver", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = function(url, options) {
    assert.equal(this, globalThis); calls++;
    return Promise.resolve(url === "https://api.telegram.org/bot/getMe" ? reply({ok: false, error_code: 404}, 404) : bot());
  };
  try {
    const client = createClient(token, chat);
    assert.equal((await client.verify()).ok, true);
    assert.equal((await probeConnection()).code, "TELEGRAM_PUBLIC_API_REACHED");
    assert.equal(calls, 2);
  } finally {globalThis.fetch = original;}
});
test("public probe cannot leak invalid JSON errors or response text", async () => {
  const output = await probeConnection({fetchImpl: async () => ({status: 502, ok: false, async json() {throw new Error("fake-private-proxy-message");}})});
  assert.equal(output.code, "TELEGRAM_INVALID_REPLY");
  assert.equal(output.http_response_received, true);
  assert.equal(output.http_status, 502);
  assert.equal(JSON.stringify(output).includes("fake-private"), false);
});
