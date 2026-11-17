/* A daytime candidate: only fresh, explicitly bound Liverpool section evidence. */
"use strict";
(function (root) {
  const TTL = 30 * 60 * 1000;
  const RETRY = 60 * 1000;
  const HOUR = 60 * 60 * 1000;
  const URL_1480 = "https://www.eticketing.co.uk/evertonfc/EDP/Event/Index/1480";
  const unknown = reason => ({state: "ERROR/UNKNOWN", reason});
  function quietHours(now) {
    const hour = Number(new Intl.DateTimeFormat("en-GB", {timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23"}).format(now));
    return hour < 6;
  }
  function ukTime(now) {
    return new Intl.DateTimeFormat("en-GB", {timeZone: "Europe/London", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short"}).format(now);
  }
  function classify(record, {pageCorrect, restricted = false, armedAt, now, policyAccepted = false}) {
    if (restricted || (record && [401, 403, 429].includes(record.status))) return {state: "ERROR/UNKNOWN", reason: "RESTRICTION_STOP", stop: true};
    if (!policyAccepted) return unknown("PILOT_NOT_APPROVED");
    if (pageCorrect !== true) return unknown("PAGE_NOT_LIVERPOOL");
    if (!record || record.method !== "POST" || record.family !== "venueAvailability" || record.status !== 200) return unknown("NOT_SUCCESSFUL_INVENTORY");
    const binding = record.request_fixture;
    if (!binding || binding.kind !== "explicit-event" || binding.event_id !== 1480 || binding.matches_page_event !== true ||
        !["request-form-json-command", "request-json-command"].includes(binding.source)) return unknown("FIXTURE_NOT_CONFIRMED");
    const started = Date.parse(record.request_started_at);
    if (!Number.isFinite(now) || !Number.isFinite(armedAt) || !Number.isFinite(started) || started < armedAt || started > now || now - started > 120000) return unknown("NOT_FRESH_SESSION_DATA");
    const data = record.response;
    if (!data || data.kind !== "section-counts" || !Array.isArray(data.sections) || !data.sections.length || data.sections.length > 2000) return unknown("INVENTORY_SCHEMA_UNCONFIRMED");
    const names = new Set();
    let total = 0;
    const positive = [];
    for (const section of data.sections) {
      if (!section || typeof section.section !== "string" || !/^[A-Z0-9]{1,6}$/.test(section.section) || names.has(section.section) ||
          !Number.isSafeInteger(section.reported_places) || section.reported_places < 0 || section.reported_places > 100000) return unknown("INVENTORY_SCHEMA_UNCONFIRMED");
      names.add(section.section); total += section.reported_places;
      if (section.reported_places > 0) positive.push({section: section.section, reported_places: section.reported_places});
    }
    if (total !== data.reported_places || total === 0) return unknown("NO_VERIFIED_POSITIVE_INVENTORY");
    positive.sort((a, b) => a.section.localeCompare(b.section));
    return {state: "POSSIBLE", reason: "SECTION_COUNTS_RESALE_UNCONFIRMED", total, sections: positive, observedAt: started};
  }
  async function fingerprint(evidence) {
    const bytes = new TextEncoder().encode(JSON.stringify([1480, evidence.sections]));
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  }
  function message(evidence) {
    const sections = evidence.sections.slice(0, 10).map(s => `${s.section}: ${s.reported_places}`).join(", ");
    return `POSSIBLE TICKET OPPORTUNITY\nEverton v Liverpool · event 1480\n${evidence.total} places reported across ${evidence.sections.length} sections.\nSections: ${sections}${evidence.sections.length > 10 ? " …" : ""}\nObserved: ${ukTime(evidence.observedAt)}\nSection inventory may include ordinary tickets. Resale status and purchase are unconfirmed.\n${URL_1480}`;
  }
  function createEngine({send, storage, now = Date.now, hash = fingerprint}) {
    let ledger;
    let fatal = false;
    let busy = false;
    let lastFailure = -Infinity;
    let nextHeartbeat = now() + HOUR;
    try {
      const saved = storage.getItem("everton-pilot-delivered-v1");
      ledger = saved === null ? [] : JSON.parse(saved);
      if (!Array.isArray(ledger) || ledger.length > 256 || ledger.some(pair => !Array.isArray(pair) || pair.length !== 2 ||
          !/^[a-f0-9]{64}$/.test(pair[0]) || !Number.isFinite(pair[1]) || pair[1] > now())) throw new Error();
    } catch { fatal = true; ledger = []; }
    const valid = () => !fatal;
    return Object.freeze({
      valid,
      async consider(record, context) {
        if (fatal) return {code: "STORAGE_REVIEW_REQUIRED", stop: true};
        if (busy) return {code: "BUSY"};
        const evidence = classify(record, {...context, now: now()});
        if (evidence.state !== "POSSIBLE") return {code: evidence.reason, state: evidence.state, stop: evidence.stop === true};
        busy = true;
        try {
          const identity = await hash(evidence);
          if (!/^[a-f0-9]{64}$/.test(identity)) { fatal = true; return {code: "FINGERPRINT_FAILED", stop: true}; }
          ledger = ledger.filter(([, time]) => now() - time < TTL);
          if (ledger.some(([key]) => key === identity)) return {code: "DUPLICATE_SUPPRESSED", state: "POSSIBLE"};
          if (ledger.length >= 256) { fatal = true; return {code: "STORAGE_REVIEW_REQUIRED", stop: true}; }
          if (now() - lastFailure < RETRY) return {code: "NOTIFICATION_RETRY_COOLDOWN", state: "POSSIBLE"};
          // Check storage before contacting Telegram; no credentials or raw data go into it.
          try { storage.setItem("everton-pilot-delivered-v1", JSON.stringify(ledger)); } catch { fatal = true; return {code: "STORAGE_REVIEW_REQUIRED", stop: true}; }
          // Recheck freshness after asynchronous hashing; never queue a stale seat message.
          if (classify(record, {...context, now: now()}).state !== "POSSIBLE") return {code: "NOT_FRESH_SESSION_DATA"};
          if (typeof context.isCurrent === "function" && context.isCurrent() !== true) return {code: "SESSION_CHANGED"};
          let result;
          try { result = await send(message(evidence)); } catch { result = {ok: false}; }
          if (!result || result.ok !== true) { lastFailure = now(); return {code: "NOTIFICATION_FAILED", state: "POSSIBLE"}; }
          ledger.push([identity, now()]);
          try { storage.setItem("everton-pilot-delivered-v1", JSON.stringify(ledger)); } catch { fatal = true; return {code: "DELIVERED_STORAGE_FAILED", stop: true, delivered: true}; }
          return {code: "ALERT_DELIVERED", state: "POSSIBLE", delivered: true};
        } catch { fatal = true; return {code: "LOCAL_PROCESSING_FAILED", stop: true}; }
        finally { busy = false; }
      },
      async heartbeat(lastResponseAt) {
        if (fatal || busy || now() < nextHeartbeat || quietHours(now())) return {code: "HEARTBEAT_SUPPRESSED"};
        busy = true;
        nextHeartbeat = now() + HOUR;
        try {
          const last = Number.isFinite(lastResponseAt) ? ukTime(lastResponseAt) : "none in this session";
          const result = await send(`DAYTIME HELPER STATUS\nLaptop/DevTools session is open. No automatic ticket checks.\nLatest Liverpool response: ${last}.\nThis confirms helper liveness, not fresh ticket availability.`);
          return {code: result && result.ok === true ? "HEARTBEAT_DELIVERED" : "HEARTBEAT_FAILED"};
        } catch { return {code: "HEARTBEAT_FAILED"}; }
        finally { busy = false; }
      }
    });
  }
  const api = {classify, quietHours, ukTime, message, createEngine};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.EvertonAlerts = Object.freeze(api);
})(typeof window !== "undefined" ? window : this);
