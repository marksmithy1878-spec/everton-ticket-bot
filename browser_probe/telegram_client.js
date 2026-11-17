/* Telegram-only transport. Credentials stay inside this closure, never in reports. */
"use strict";
(function (root) {
  function createClient(token, chatId, {fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 10000} = {}) {
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
      const controller = new AbortController();
      controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
          method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload),
          signal: controller.signal, credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer"
        });
        let body;
        try { body = await response.json(); } catch { return failure("TELEGRAM_INVALID_REPLY"); }
        if (response.status === 429 || (body && body.error_code === 429)) {
          const seconds = body && body.parameters && body.parameters.retry_after;
          blockedUntil = now() + (Number.isSafeInteger(seconds) && seconds > 0 ? Math.min(seconds, 86400) : 60) * 1000;
          return failure("TELEGRAM_RATE_LIMITED");
        }
        if (closed) return failure("CREDENTIALS_UNAVAILABLE");
        if (!response.ok || !body || body.ok !== true) return failure("TELEGRAM_REJECTED");
        return {ok: true, result: body.result};
      } catch { return failure("TELEGRAM_NETWORK_OR_TIMEOUT"); }
      finally { clearTimeout(timer); controllers.delete(controller); }
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
      close() { closed = true; verified = false; for (const controller of controllers) controller.abort(); token = null; chatId = null; }
    });
  }
  const api = {createClient};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.EvertonTelegram = Object.freeze(api);
})(typeof window !== "undefined" ? window : this);
