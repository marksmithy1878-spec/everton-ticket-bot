/* Telegram-only transport. Credentials stay inside this closure, never in reports. */
"use strict";
(function (root) {
  const nativeFetch = () => typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null;
  // Never return exception messages or token-bearing request URLs.
  function errorCode(error, timedOut) {
    if (timedOut) return "TELEGRAM_TIMEOUT";
    if (error && error.name === "AbortError") return "TELEGRAM_REQUEST_CANCELLED";
    if (error && error.name === "TypeError") return "TELEGRAM_FETCH_FAILED";
    if (error && error.name === "SecurityError") return "TELEGRAM_SECURITY_RESTRICTION";
    return "TELEGRAM_NETWORK_FAILED";
  }
  async function requestJson(url, payload, {fetchImpl, now, timeoutMs, controllers = new Set()}) {
    const started = now();
    const controller = new AbortController();
    controllers.add(controller);
    let timedOut = false;
    const elapsed = () => Math.max(0, Math.min(60000, now() - started));
    const failure = (code, status = null) => ({ok: false, code, status, elapsed_ms: elapsed()});
    const timer = setTimeout(() => {timedOut = true; controller.abort();}, timeoutMs);
    try {
      if (typeof fetchImpl !== "function") return failure("TELEGRAM_FETCH_UNAVAILABLE");
      const response = await fetchImpl(url, {
        method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload),
        signal: controller.signal, credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer"
      });
      const status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : null;
      if (status === null) return failure("TELEGRAM_INVALID_HTTP_REPLY");
      let body;
      try { body = await response.json(); }
      catch { return failure(timedOut ? "TELEGRAM_TIMEOUT" : "TELEGRAM_INVALID_REPLY", status); }
      if (timedOut) return failure("TELEGRAM_TIMEOUT", status);
      return {ok: true, status, http_ok: response.ok === true, body, elapsed_ms: elapsed()};
    } catch (error) {return failure(errorCode(error, timedOut));}
    finally {clearTimeout(timer); controllers.delete(controller);}
  }
  // Uses a deliberately token-free invalid API path. A recognised 401/404 JSON
  // reply establishes connection only, never authentication or message delivery.
  async function probeConnection({fetchImpl = nativeFetch(), checkPermission = async () => null,
      now = Date.now, timeoutMs = 10000, permissionTimeoutMs = 1000} = {}) {
    const permission = await new Promise(resolve => {
      const timer = setTimeout(() => resolve(null), permissionTimeoutMs);
      Promise.resolve().then(checkPermission).then(value => {
        clearTimeout(timer); resolve(typeof value === "boolean" ? value : null);
      }, () => {clearTimeout(timer); resolve(null);});
    });
    if (permission === false) return {permission_granted: false, http_response_received: false,
      api_reply_recognised: false, http_status: null, code: "TELEGRAM_PERMISSION_NOT_GRANTED", elapsed_ms: 0};
    const result = await requestJson("https://api.telegram.org/bot/getMe", {}, {fetchImpl, now, timeoutMs});
    const recognised = result.ok && result.body && result.body.ok === false &&
      [401, 404].includes(result.body.error_code) && [401, 404].includes(result.status);
    return {permission_granted: permission, http_response_received: result.status !== null,
      api_reply_recognised: recognised === true, http_status: result.status,
      code: result.ok ? recognised ? "TELEGRAM_PUBLIC_API_REACHED" : "TELEGRAM_UNEXPECTED_PUBLIC_REPLY" : result.code,
      elapsed_ms: result.elapsed_ms};
  }
  function createClient(token, chatId, {fetchImpl = nativeFetch(), now = Date.now, timeoutMs = 10000} = {}) {
    const valid = typeof token === "string" && /^\d{5,16}:[A-Za-z0-9_-]{20,150}$/.test(token) &&
      typeof chatId === "string" && /^-?[1-9]\d{0,18}$/.test(chatId) && typeof fetchImpl === "function";
    let verified = false;
    let closed = false;
    let blockedUntil = 0;
    const controllers = new Set();
    const failure = code => ({ok: false, code});
    async function call(method, payload) {
      if (!valid || closed) return failure("CREDENTIALS_UNAVAILABLE");
      if (now() < blockedUntil) return failure("TELEGRAM_COOLDOWN");
      const response = await requestJson(`https://api.telegram.org/bot${token}/${method}`, payload, {fetchImpl, now, timeoutMs, controllers});
      if (closed) return failure("CREDENTIALS_UNAVAILABLE");
      if (!response.ok) return failure(response.code);
      const body = response.body;
      if (response.status === 429 || (body && body.error_code === 429)) {
        const seconds = body && body.parameters && body.parameters.retry_after;
        blockedUntil = now() + (Number.isSafeInteger(seconds) && seconds > 0 ? Math.min(seconds, 86400) : 60) * 1000;
        return failure("TELEGRAM_RATE_LIMITED");
      }
      if (!response.http_ok) return failure(`TELEGRAM_HTTP_${response.status}`);
      if (!body || body.ok !== true) return failure("TELEGRAM_REJECTED");
      return {ok: true, result: body.result};
    }
    return Object.freeze({
      async verify() {
        const response = await call("getMe", {});
        verified = response.ok && response.result && response.result.is_bot === true &&
          typeof response.result.username === "string" && response.result.username.toLowerCase() === "evertonresale_bot";
        return verified ? {ok: true} : failure(response.ok ? "WRONG_BOT" : response.code);
      },
      async send(text) {
        if (!verified) return failure("BOT_NOT_VERIFIED");
        if (typeof text !== "string" || !text.length || text.length > 4096) return failure("MESSAGE_INVALID");
        const response = await call("sendMessage", {chat_id: chatId, text, link_preview_options: {is_disabled: true}});
        if (!response.ok) return failure(response.code);
        const message = response.result;
        return message && Number.isSafeInteger(message.message_id) && message.message_id > 0 &&
          message.chat && String(message.chat.id) === chatId ? {ok: true} : failure("DELIVERY_NOT_CONFIRMED");
      },
      close() {closed = true; verified = false; for (const controller of controllers) controller.abort(); token = null; chatId = null;}
    });
  }
  const api = {createClient, probeConnection};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.EvertonTelegram = Object.freeze(api);
})(typeof window !== "undefined" ? window : this);
