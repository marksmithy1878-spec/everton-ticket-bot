/* Pure, offline-testable metadata filter. No raw URLs, bodies or headers retained. */
"use strict";
(function (root) {
  function summarize(entry, checkStartedAt) {
    if (!entry || !entry.request || !entry.response) return null;
    let url;
    try { url = new URL(entry.request.url); } catch { return null; }
    if (url.origin !== "https://www.eticketing.co.uk" ||
        !url.pathname.toLowerCase().startsWith("/evertonfc/")) return null;
    const path = url.pathname.toLowerCase();
    // These are only endpoint families already identified in the handover.
    const family = path.includes("venueavailability") ? "venueAvailability" :
      path.includes("areaavailability") ? "AreaAvailability" : null;
    if (!family) return null;
    let association = "page-context-only";
    for (const [key, value] of url.searchParams) {
      if (["eventid", "event_id"].includes(key.toLowerCase())) {
        if (value !== "1480") return null;
        association = "request-event-1480";
      }
    }
    const timestamp = Date.parse(entry.startedDateTime);
    if (!Number.isFinite(timestamp)) return null;
    const status = entry.response.status;
    if (!Number.isInteger(status) || status < 0 || status > 599) return null;
    return {
      family,
      request_started_at: new Date(timestamp).toISOString(),
      status,
      association,
      // A request begun before the probe but completed later is not a new idle update.
      timing: timestamp >= checkStartedAt ? "started-during-check" : "already-in-log",
      restriction: [401, 403, 429].includes(status)
    };
  }

  function makeReport(startedAt, endedAt, observations, stopped, currentPageVerified) {
    // Rebuild every entry through an explicit allowlist, even if the caller has extra fields.
    return {
      diagnostic: "everton-passive-freshness-v1",
      event_id: 1480,
      started_at: startedAt === null ? null : new Date(startedAt).toISOString(),
      report_at: new Date(endedAt).toISOString(),
      page_event_1480_verified: currentPageVerified === true,
      restriction_observed: stopped === true,
      ticket_detection_validated: false,
      observations: observations.map(item => ({
        family: item.family,
        request_started_at: item.request_started_at,
        status: item.status,
        association: item.association,
        timing: item.timing
      }))
    };
  }

  const api = { summarize, makeReport };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.EvertonProbe = Object.freeze(api);
})(typeof window !== "undefined" ? window : this);
