"use strict";
const ui = Object.fromEntries(["start", "finish", "save", "status", "elapsed", "new", "old", "meaning", "rows"].map(id => [id, document.getElementById(id)]));
const devtools = typeof chrome !== "undefined" ? chrome.devtools : null;
let startedAt = null;
let endedAt = null;
let active = false;
let stopped = localStorage.getItem("everton-restriction-observed") === "true";
let pageVerified = false;
let generation = 0;
const observations = [];
const seen = new Set();

// This is the ONLY expression evaluated in the page. It reads a location check
// and returns a boolean restriction flag. No page text or URL is returned.
const PAGE_CHECK = String.raw`(() => ({
  correct: location.origin === "https://www.eticketing.co.uk" && /^\/evertonfc\/EDP\/Event\/Index\/1480\/?$/i.test(location.pathname),
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
  ui.rows.replaceChildren(...observations.map(o => {
    const row = document.createElement("tr");
    for (const value of [new Date(o.request_started_at).toLocaleTimeString("en-GB", { timeZone: "Europe/London" }), o.family, o.status, o.timing === "already-in-log" ? "Earlier log" : "During check", o.association === "request-event-1480" ? "Explicit event 1480" : "Page context only"]) {
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
  const key = [item.family, item.request_started_at, item.status, item.association].join("|");
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
ui.save.addEventListener("click", () => {
  const report = EvertonProbe.makeReport(startedAt, Date.now(), observations, stopped, pageVerified);
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = "Everton_Passive_Report.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
if (devtools) {
  devtools.network.onRequestFinished.addListener(entry => void observe(entry));
  devtools.network.onNavigated.addListener(() => {
    if (active) { pageVerified = false; halt("Navigation observed. Check stopped; start again only after reviewing the page."); }
  });
} else ui.status.textContent = "Open this tool through the browser's Everton Check DevTools panel.";
if (stopped) ui.status.textContent = "A previous check observed an access restriction. Diagnostic stays stopped pending review.";
// Local UI clock only: no browser/website access happens on this timer.
setInterval(render, 1000);
render();
