"use strict";
const ui = Object.fromEntries(["start", "finish", "save", "status", "elapsed", "new", "old", "meaning", "rows", "readResponses", "saveResponses", "responseStatus", "responseRows", "responseFixture"].map(id => [id, document.getElementById(id)]));
const devtools = typeof chrome !== "undefined" ? chrome.devtools : null;
let startedAt = null;
let endedAt = null;
let active = false;
let stopped = localStorage.getItem("everton-restriction-observed") === "true";
let pageVerified = false;
let generation = 0;
let responseReview = null;
let readingResponses = false;
const observations = [];
const seen = new Set();

// This is the ONLY expression evaluated in the page. It reads a location check
// and returns a boolean restriction flag. No page text or URL is returned.
const PAGE_CHECK = String.raw`(() => ({
  correct: location.origin === "https://www.eticketing.co.uk" && /^\/evertonfc\/EDP\/Event\/Index\/1480\/?$/i.test(location.pathname),
  comparison: location.origin === "https://www.eticketing.co.uk" && /^\/evertonfc\/EDP\/Event\/Index\/1481\/?$/i.test(location.pathname),
  unavailableRedirect: location.origin === "https://www.eticketing.co.uk" && /^\/evertonfc\/EDP\/Validation\/EventNotAllowed\/?$/i.test(location.pathname) && new URLSearchParams(location.search || "").getAll("eventId").length === 1 && new URLSearchParams(location.search || "").get("eventId") === "1480",
  blocked: /suspicious activity|unusual traffic|access denied|verify (?:you are|you're) human|checking your browser|temporarily (?:blocked|restricted)/i.test(document.body ? document.body.innerText : "")
}))()`;

function inspectPage() {
  return new Promise(resolve => {
    devtools.inspectedWindow.eval(PAGE_CHECK, (result, error) => {
      resolve(error || !result ? { correct: false, blocked: false } : result);
    });
  });
}

function render() {
  const elapsed = startedAt === null ? 0 : Math.max(0, Math.floor(((endedAt || Date.now()) - startedAt) / 1000));
  ui.elapsed.textContent = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  ui.new.textContent = observations.filter(o => o.timing === "started-during-check").length;
  ui.old.textContent = observations.filter(o => o.timing === "already-in-log").length;
  ui.start.disabled = active || stopped || !devtools;
  ui.finish.disabled = !active;
  ui.save.disabled = startedAt === null;
  ui.readResponses.disabled = readingResponses || stopped || !devtools;
  ui.rows.replaceChildren(...observations.map(o => {
    const row = document.createElement("tr");
    for (const value of [new Date(o.request_started_at).toLocaleTimeString("en-GB", { timeZone: "Europe/London" }), `${o.method} ${o.family}`, o.status, o.timing === "already-in-log" ? "Earlier log" : "During check", o.association === "request-event-1480" ? "Explicit event 1480" : "Page context only"]) {
      const cell = document.createElement("td"); cell.textContent = value; row.append(cell);
    }
    return row;
  }));
}

function halt(message, restriction = false) {
  active = false;
  generation += 1;
  endedAt = Date.now();
  if (restriction) {
    stopped = true;
    localStorage.setItem("everton-restriction-observed", "true");
  }
  ui.status.textContent = message;
  ui.status.classList.toggle("blocked", restriction);
  render();
}

async function observe(entry, run = generation) {
  if (!active || run !== generation) return;
  const item = EvertonProbe.summarize(entry, startedAt);
  if (!item) return;
  const key = [item.family, item.method, item.request_started_at, item.status, item.association].join("|");
  if (seen.has(key)) return;
  const context = await inspectPage();
  if (!active || run !== generation || seen.has(key)) return;
  pageVerified = context.correct === true;
  if (!pageVerified) { halt("Check stopped: the inspected tab is no longer the Liverpool event page."); return; }
  seen.add(key);
  observations.push(item);
  if (context.blocked || item.restriction) {
    halt("Access restriction observed. Diagnostic stopped. Leave website checks paused and review before continuing.", true);
    return;
  }
  if (observations.length >= 200) { halt("Check finished: the report reached its 200-entry limit."); return; }
  render();
}

ui.start.addEventListener("click", async () => {
  if (active || stopped || !devtools) return;
  ui.start.disabled = true;
  const context = await inspectPage();
  pageVerified = context.correct === true;
  if (!pageVerified) {
    ui.status.textContent = context.unavailableRedirect
      ? "Everton has redirected event 1480 to its unavailable page. The stadium-page idle check has not started."
      : "This check only runs on the official Liverpool event 1480 seating page.";
    render(); return;
  }
  if (context.blocked) { halt("A restriction message is visible. Diagnostic stopped; leave website activity paused.", true); return; }
  startedAt = Date.now();
  endedAt = null;
  observations.length = 0;
  seen.clear();
  active = true;
  generation += 1;
  const run = generation;
  ui.status.textContent = "Observing only. Leave the ticket page untouched; finish after five minutes.";
  // Read DevTools' existing log. This does not replay any network requests.
  devtools.network.getHAR(har => {
    for (const entry of (har && Array.isArray(har.entries) ? har.entries : [])) void observe(entry, run);
  });
  render();
});

ui.finish.addEventListener("click", () => {
  halt("Check finished. Save the safe report for review; no ticket detection has been validated.");
});

function saveJson(report, filename) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

ui.save.addEventListener("click", () => {
  const report = EvertonProbe.makeReport(startedAt, Date.now(), observations, stopped, pageVerified);
  saveJson(report, "Everton_Passive_Report.json");
});

ui.readResponses.addEventListener("click", async () => {
  if (!devtools || stopped || readingResponses) return;
  if (active) halt("Idle check stopped for a review of existing response buffers.");
  readingResponses = true;
  responseReview = null;
  ui.responseRows.replaceChildren();
  ui.saveResponses.disabled = true;
  const run = ++generation;
  render();
  const context = await inspectPage();
  if (run !== generation) {
    readingResponses = false;
    ui.responseStatus.textContent = "Navigation interrupted the response review. No website requests were made.";
    render(); return;
  }
  if ((!context.correct && !context.comparison) || context.blocked) {
    readingResponses = false;
    ui.responseStatus.textContent = "Response review needs the Liverpool 1480 or Fulham 1481 seating page without a restriction message. No requests were made.";
    if (context.blocked) halt("Restriction observed; diagnostic stopped.", true);
    render(); return;
  }
  const fixtureId = context.correct ? 1480 : 1481;
  const fixtureLabel = fixtureId === 1480 ? "Liverpool · event 1480" : "Fulham comparison ONLY · event 1481";
  ui.responseFixture.textContent = `${fixtureLabel}. Request event IDs and response counts are checked locally. No ticket alerts.`;
  const summarizeForFixture = (entry, now) => EvertonProbe.summarize(entry, now, fixtureId);
  ui.responseStatus.textContent = "Reading existing DevTools buffers; no website requests are being sent.";
  devtools.network.getHAR(async har => {
    const collected = [];
    const now = Date.now();
    const logAvailable = har && Array.isArray(har.entries);
    const matching = (logAvailable ? har.entries : [])
      .filter(entry => summarizeForFixture(entry, now));
    // The most recent matching records are useful; do not reread the entire history.
    const selected = matching.sort((a, b) => Date.parse(a.startedDateTime) - Date.parse(b.startedDateTime)).slice(-20);
    for (const entry of selected) {
      if (run !== generation) break;
      const record = await EvertonResponseReader.readEntry(entry, summarizeForFixture, now, { expectedEventId: fixtureId });
      if (run !== generation) break;
      if (record) collected.push(record);
      if (record && record.decision_reason === "ACCESS_RESTRICTED_STOP") {
        halt("Access restriction found in the existing log; diagnostic stopped.", true);
        break;
      }
    }
    const finalContext = await inspectPage();
    const sameFixture = fixtureId === 1480 ? finalContext.correct === true : finalContext.comparison === true;
    responseReview = {
      diagnostic: "everton-response-review-v1", extension_version: "0.3.1",
      event_id: fixtureId, comparison_only: fixtureId === 1481, report_at: new Date().toISOString(),
      page_event_1480_verified: finalContext.correct === true,
      page_event_1481_verified: finalContext.comparison === true,
      restriction_observed: stopped || finalContext.blocked === true,
      capture_completed: logAvailable === true && run === generation && sameFixture && !finalContext.blocked,
      metadata_available: logAvailable === true,
      matching_records: matching.length, records_reviewed: collected.length,
      ticket_detection_validated: false, observations: collected
    };
    if (finalContext.blocked) halt("Restriction observed; diagnostic stopped.", true);
    readingResponses = false;
    ui.responseRows.replaceChildren(...collected.map(record => {
      const row = document.createElement("tr");
      const decoded = record.response;
      const descriptions = {
        PREFLIGHT_NOT_INVENTORY: "Browser preflight; no ticket inventory",
        POST_METHOD_NOT_OBSERVED: "Inventory request method not confirmed",
        BODY_NOT_AVAILABLE: "Response body unavailable in DevTools",
        BODY_READER_NOT_AVAILABLE: "DevTools did not provide a body reader",
        BODY_READER_TIMEOUT: "Local response read timed out",
        BODY_READER_FAILED: "Local response read failed",
        BODY_NOT_READ_ON_RESTRICTION: "Access restricted; body was not read",
        BODY_NOT_READ_ON_FIXTURE_CONFLICT: "Conflicting fixture; response excluded",
        SECTION_SCHEMA_UNEXPECTED: "No recognised section inventory in this response"
      };
      const binding = record.request_fixture;
      const fixtureText = binding.kind === "explicit-event" ? `Request event ${binding.event_id} matches page` : binding.kind === "conflict" ? "Conflicting event: excluded" : "Request event unconfirmed";
      const description = decoded.kind === "section-counts"
        ? `${decoded.reported_places} section places reported; resale and purchase unconfirmed`
        : decoded.kind === "api-error" ? `Availability request failed (API ${decoded.api_error_code})`
        : descriptions[decoded.reason] || "No usable inventory data; review required";
      for (const value of [record.method, record.status, fixtureText, description, record.state]) {
        const cell = document.createElement("td"); cell.textContent = value; row.append(cell);
      }
      return row;
    }));
    ui.responseStatus.textContent = responseReview.capture_completed
      ? `Read ${collected.length} existing records — ${fixtureLabel}. This response review sends no ticket alerts; save the report for review.`
      : "Response review was interrupted or restricted. Its records are not a completed live-source validation.";
    ui.saveResponses.disabled = false;
    render();
  });
});
ui.saveResponses.addEventListener("click", () => {
  if (responseReview) saveJson(responseReview, responseReview.comparison_only ? "Everton_Fulham_Comparison_Report.json" : "Everton_Response_Report.json");
});
if (devtools) {
  devtools.network.onRequestFinished.addListener(entry => void observe(entry));
  devtools.network.onNavigated.addListener(() => {
    if (readingResponses) generation += 1;
    if (active) { pageVerified = false; halt("Navigation observed. Check stopped; start again only after reviewing the page."); }
  });
} else ui.status.textContent = "Open this tool through the browser's Everton Check DevTools panel.";
if (stopped) ui.status.textContent = "A previous check observed an access restriction. Diagnostic stays stopped pending review.";
// Local UI clock only: no browser/website access happens on this timer.
setInterval(render, 1000);
render();
