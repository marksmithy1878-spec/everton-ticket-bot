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

  // Diagnostic extraction only: an explicit root eventId is a candidate binding,
  // not proof of a fresh, resale-specific source. Never export other body fields.
  function requestFixture(request, expectedEventId) {
    const fail = reason => ({ kind: "unknown", reason });
    if (![1480, 1481].includes(expectedEventId)) return fail("UNSUPPORTED_PAGE_EVENT");
    if (!request || request.method !== "POST") return fail("NON_INVENTORY_METHOD");
    const isEventKey = key => ["eventid", "event_id"].includes(String(key).toLowerCase());
    const values = [];
    let hasQuery = false;
    let bodySource = null;
    let url;
    try { url = new URL(request.url); } catch { return fail("REQUEST_URL_UNAVAILABLE"); }
    for (const [key, value] of url.searchParams) {
      if (isEventKey(key)) { hasQuery = true; values.push(value); }
    }
    if (values.length > 1) return fail("AMBIGUOUS_EVENT_FIELDS");
    const post = request.postData;
    if (post) {
      const mime = typeof post.mimeType === "string" ? post.mimeType.split(";", 1)[0].trim().toLowerCase() : "";
      if (typeof post.text === "string" && post.text.length > 65536) return fail("REQUEST_BODY_TOO_LARGE");
      if (mime === "application/json" || /^application\/[a-z0-9.+-]+\+json$/.test(mime)) {
        if (typeof post.text !== "string" || !post.text.length) return fail("REQUEST_BODY_UNAVAILABLE");
        let body;
        try { body = JSON.parse(post.text); } catch { return fail("REQUEST_JSON_INVALID"); }
        if (!body || typeof body !== "object" || Array.isArray(body)) return fail("REQUEST_JSON_INVALID");
        const keys = Object.keys(body).filter(isEventKey);
        // Duplicates, escaped keys or nested event fields are not silently resolved.
        // False negatives here are acceptable: this gate cannot enable live alerts.
        const tokens = post.text.match(/"(?:eventId|event_id)"\s*:/gi) || [];
        if (keys.length > 1 || tokens.length !== keys.length) return fail("AMBIGUOUS_EVENT_FIELDS");
        if (keys.length === 1) { values.push(body[keys[0]]); bodySource = "request-json-root"; }
      } else if (mime === "application/x-www-form-urlencoded") {
        let params;
        if (typeof post.text === "string" && post.text.length) {
          params = [...new URLSearchParams(post.text)].filter(([key]) => isEventKey(key));
        } else if (Array.isArray(post.params) && post.params.length <= 2000) {
          params = post.params.filter(item => item && isEventKey(item.name)).map(item => [item.name, item.value]);
        } else return fail("REQUEST_BODY_UNAVAILABLE");
        if (params.length > 1) return fail("AMBIGUOUS_EVENT_FIELDS");
        if (params.length === 1) { values.push(params[0][1]); bodySource = "request-form"; }
      } else return fail("REQUEST_BODY_FORMAT_UNSUPPORTED");
    }
    if (!values.length) return fail("EXPLICIT_EVENT_FIELD_NOT_OBSERVED");
    const ids = values.map(value => typeof value === "number" && Number.isSafeInteger(value) && value > 0
      ? value : typeof value === "string" && /^[1-9][0-9]{0,6}$/.test(value) ? Number(value) : null);
    if (ids.includes(null)) return fail("EVENT_FIELD_INVALID");
    if (ids.some(id => id !== expectedEventId)) return { kind: "conflict", reason: "REQUEST_FIXTURE_CONFLICT" };
    return { kind: "explicit-event", event_id: expectedEventId, matches_page_event: true,
      source: hasQuery && bodySource ? "request-query-and-body" : bodySource || "request-query" };
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

  async function readEntry(entry, summarize, now, { timeoutMs = 5000, expectedEventId = 1480 } = {}) {
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
      decision_reason: "LIVE_SOURCE_NOT_VALIDATED",
      request_fixture: unknown("NOT_READ"), response: null
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
    output.request_fixture = requestFixture(entry.request, expectedEventId);
    if (output.request_fixture.kind === "conflict") {
      output.decision_reason = "REQUEST_FIXTURE_CONFLICT";
      output.response = unknown("BODY_NOT_READ_ON_FIXTURE_CONFLICT");
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

  const api = { decodeBody, requestFixture, readEntry };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.EvertonResponseReader = Object.freeze(api);
})(typeof window !== "undefined" ? window : this);
