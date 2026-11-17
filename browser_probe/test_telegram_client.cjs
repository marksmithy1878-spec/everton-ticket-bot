"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {createClient} = require("./telegram_client.js");
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
  assert.equal(result.code, "TELEGRAM_NETWORK_OR_TIMEOUT");
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
  assert.equal((await c.verify()).code, "TELEGRAM_NETWORK_OR_TIMEOUT");
  assert.equal(calls, 1);
});


test("closing while authentication is pending cannot revive the client", async () => {
  let finish;
  const c = createClient(token, chat, {fetchImpl: () => new Promise(resolve => {finish = resolve;})});
  const pending = c.verify(); c.close(); finish(bot());
  assert.equal((await pending).ok, false);
  assert.equal((await c.send("TEST")).ok, false);
});
