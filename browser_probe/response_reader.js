/* Reads DevTools' existing response buffers. Never sends a website request.
 * Output is an allowlisted diagnostic, not an alert or a validated live feed.
 */
"use strict";
(function (root) {
  const LIMIT = 2 * 1024 * 1024;
  const unknown = reason => ({ kind: "unknown", reason });

  function decodeBody(content, encoding = "") {
    if (typeof content !== "string" || !content.length) return unknown("BODY_NOT_AVAILABLE");
    if (content.length > LIMIT) return unknown("BODY_TOO_LARGE");
    if (encoding === "base64") {
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(content), c => c.charCodeAt(0)));
      } catch { return unknown("BODY_ENCODING_INVALID"); }
    } else if (encoding) return unknown("BODY_ENCODING_UNSUPPORTED");
    let body;
    try { body = JSON.parse(content); } catch { return unknown("BODY_NOT_JSON"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return unknown("BODY_SCHEMA_UNEXPECTED");
    // This numeric success/error field and section structure are visible in
    // the original Network screenshots. Ignore arbitrary server text/PII.
    if (!Number.isSafeInteger(body.errorCode) || body.errorCode < 0 || body.errorCode > 1000000) {
      return unknown("API_CODE_UNEXPECTED");
    }
    if (body.errorCode !== 200) return { kind: "api-error", api_error_code: body.errorCode };
    const section = body.data && body.data.section;
    if (!section || typeof section !== "object" || typeof section.header !== "string" ||
        !Array.isArray(section.data) || section.data.length > 2000 || section.header.length > 20000) {
      return unknown("SECTION_SCHEMA_UNEXPECTED");
    }
    const header = section.header.split("~");
    for (const required of ["sectionName", "totalAvailableSeat"]) {
      if (header.filter(name => name === required).length !== 1) return unknown("SECTION_HEADER_UNEXPECTED");
    }
    const nameIndex = header.indexOf("sectionName");
    const countIndex = header.indexOf("totalAvailableSeat");
    const sections = [];
    const seen = new Set();
    let total = 0;
    for (const row of section.data) {
      if (typeof row !== "string" || row.length > 20000) return unknown("SECTION_ROW_UNEXPECTED");
      const cells = row.split("~");
      if (cells.length !== header.length) return unknown("SECTION_ROW_LENGTH_UNEXPECTED");
      const name = cells[nameIndex];
      const rawCount = cells[countIndex];
      if (!/^[A-Za-z0-9]{1,6}$/.test(name) || !/^\d+$/.test(rawCount) || seen.has(name.toUpperCase())) {
        return unknown("SECTION_VALUE_UNEXPECTED");
      }
      const count = Number(rawCount);
      if (!Number.isSafeInteger(count) || count > 100000) return unknown("SECTION_VALUE_UNEXPECTED");
      total += count;
      seen.add(name.toUpperCase());
      sections.push({ section: name.toUpperCase(), reported_places: count });
    }
    return { kind: "section-counts", reported_places: total, sections,
      resale_verified: false, individual_seat_verified: false };
  }

  function bufferedContent(entry, timeoutMs) {
    return new Promise(resolve => {
      if (typeof entry.getContent !== "function") { resolve(unknown("BODY_READER_NOT_AVAILABLE")); return; }
      let finished = false;
      let timer;
      const done = value => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(value);
      };
      timer = setTimeout(() => done(unknown("BODY_READER_TIMEOUT")), timeoutMs);
      try { entry.getContent((content, encoding) => done(decodeBody(content, encoding || ""))); }
      catch { done(unknown("BODY_READER_FAILED")); }
    });
  }

  async function readEntry(entry, summarize, now, { timeoutMs = 5000 } = {}) {
    const meta = summarize(entry, now);
    if (!meta) return null;
    const method = ["GET", "POST", "OPTIONS", "HEAD"].includes(entry.request.method)
      ? entry.request.method : "UNREPORTED";
    const age = Math.floor((now - Date.parse(meta.request_started_at)) / 1000);
    const output = {
      family: meta.family, method, status: meta.status,
      request_started_at: meta.request_started_at,
      association: meta.association, age_seconds: age,
      state: "ERROR/UNKNOWN", ticket_detection_validated: false,
      // A page-context association and an unvalidated parser must never produce
      // a ticket alert. Keep decoded facts separate from a live availability decision.
      decision_reason: "LIVE_SOURCE_NOT_VALIDATED", response: null
    };
    if (meta.restriction) {
      output.decision_reason = "ACCESS_RESTRICTED_STOP";
      output.response = unknown("BODY_NOT_READ_ON_RESTRICTION");
      return output;
    }
    if (method !== "POST") {
      output.decision_reason = "NON_INVENTORY_METHOD";
      output.response = unknown(method === "OPTIONS" ? "PREFLIGHT_NOT_INVENTORY" : "POST_METHOD_NOT_OBSERVED");
      return output;
    }
    if (meta.family !== "venueAvailability") {
      output.response = unknown("AREA_SCHEMA_NOT_VALIDATED");
      return output;
    }
    output.response = await bufferedContent(entry, timeoutMs);
    if (meta.status !== 200) output.decision_reason = "HTTP_FAILURE_NOT_EMPTY_INVENTORY";
    else if (age < 0 || age > 120) output.decision_reason = "HISTORICAL_OR_FUTURE_RESPONSE";
    return output;
  }

  const api = { decodeBody, readEntry };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.EvertonResponseReader = Object.freeze(api);
})(typeof window !== "undefined" ? window : this);
