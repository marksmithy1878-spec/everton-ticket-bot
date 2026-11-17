/* Optional daytime pilot. No getHAR, page reload, click, or Everton HTTP call. */
"use strict";
(function () {
  const ids = ["pilotToken", "pilotChat", "pilotTest", "pilotPhone", "pilotPolicy", "pilotStart", "pilotStop", "pilotStatus", "pilotLast", "pilotConnection", "pilotConnectionStatus"];
  const controls = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  const native = typeof chrome !== "undefined" ? chrome.devtools : null;
  let client = null;
  let engine = null;
  let testDelivered = false;
  let connecting = false;
  let diagnosing = false;
  let starting = false;
  let running = false;
  let armedAt = null;
  let lastResponseAt = null;
  let epoch = 0;
  let releaseLock = null;
  let queued = 0;
  let heartbeating = false;
  let queue = Promise.resolve();
  const latched = () => { try { return localStorage.getItem("everton-restriction-observed") === "true"; } catch { return true; } };
  function renderPilot() {
    controls.pilotConnection.disabled = diagnosing || connecting || running || starting;
    controls.pilotTest.disabled = diagnosing || connecting || running || starting;
    controls.pilotStart.disabled = diagnosing || connecting || running || starting || !native || !navigator.locks || latched() ||
      !testDelivered || controls.pilotPhone.checked !== true || controls.pilotPolicy.checked !== true;
    controls.pilotStop.disabled = !running && !starting && !client;
    controls.pilotToken.disabled = diagnosing || running || starting || connecting;
    controls.pilotChat.disabled = diagnosing || running || starting || connecting;
    controls.pilotLast.textContent = lastResponseAt === null ? "No fresh Liverpool response read in this session." :
      `Latest Liverpool response: ${EvertonAlerts.ukTime(lastResponseAt)}. This is not a continuous fresh-data feed.`;
  }
  function endPilot(message, restriction = false) {
    running = false; starting = false; connecting = false; epoch += 1;
    if (releaseLock) { releaseLock(); releaseLock = null; }
    if (client) client.close();
    client = null; engine = null; testDelivered = false;
    controls.pilotPhone.checked = false;
    controls.pilotToken.value = ""; controls.pilotChat.value = "";
    if (restriction) halt("Restriction observed. All website checks should stay paused pending review.", true);
    controls.pilotStatus.textContent = message;
    renderPilot();
  }
  controls.pilotConnection.addEventListener("click", async () => {
    if (diagnosing || connecting || running || starting) return;
    diagnosing = true;
    controls.pilotConnectionStatus.textContent = "Checking Telegram permission and a token-free public API path. No message will be sent.";
    renderPilot();
    const result = await EvertonTelegram.probeConnection({checkPermission: () => new Promise(resolve => {
      if (typeof chrome === "undefined" || !chrome.permissions || typeof chrome.permissions.contains !== "function") { resolve(null); return; }
      try {
        chrome.permissions.contains({origins: ["https://api.telegram.org/*"]}, granted => {
          const failed = chrome.runtime && chrome.runtime.lastError;
          resolve(failed ? null : granted === true);
        });
      } catch { resolve(null); }
    })});
    diagnosing = false;
    const permission = result.permission_granted === true ? "granted" : result.permission_granted === false ? "not granted" : "unknown";
    controls.pilotConnectionStatus.textContent = `Telegram permission: ${permission}. Public API: ${result.code}${result.http_status === null ? "" : ` (HTTP ${result.http_status})`}. Duration: ${result.elapsed_ms} ms. No credentials used; no message sent.`;
    renderPilot();
  });
  controls.pilotTest.addEventListener("click", async () => {
    if (diagnosing || running || starting || connecting) return;
    if (client) client.close();
    const mine = ++epoch;
    connecting = true; testDelivered = false; controls.pilotPhone.checked = false;
    client = EvertonTelegram.createClient(controls.pilotToken.value.trim(), controls.pilotChat.value.trim());
    controls.pilotToken.value = ""; controls.pilotChat.value = "";
    const candidate = client;
    controls.pilotStatus.textContent = "Checking @EvertonResale_bot; ticket alerts remain OFF.";
    renderPilot();
    const verified = await candidate.verify();
    if (mine !== epoch) return;
    const result = verified.ok ? await candidate.send("TEST — Everton daytime helper\nTelegram delivery test only. No ticket opportunity has been detected. Ticket alerts remain OFF.") : verified;
    if (mine !== epoch) return;
    connecting = false;
    testDelivered = result.ok === true;
    if (!testDelivered) { candidate.close(); client = null; }
    controls.pilotStatus.textContent = testDelivered
      ? "Telegram accepted the TEST message. Confirm its arrival on your phone. Ticket alerts remain OFF."
      : `Telegram test failed during ${verified.ok ? "message delivery" : "bot verification"} (${result.code}). Credentials were cleared; ticket alerts remain OFF.`;
    renderPilot();
  });
  controls.pilotStart.addEventListener("click", () => {
    if (controls.pilotStart.disabled || !client) return;
    const mine = ++epoch;
    starting = true; renderPilot();
    void navigator.locks.request("everton-daytime-pilot-v1", {ifAvailable: true}, async lock => {
      if (!lock) { starting = false; controls.pilotStatus.textContent = "Another daytime pilot is open. Stop it before starting this one."; renderPilot(); return; }
      const context = await inspectPage();
      if (mine !== epoch) return;
      if (latched() || context.blocked) { endPilot("Restriction observed. Pilot stays paused pending review.", true); return; }
      if (context.correct !== true) { starting = false; controls.pilotStatus.textContent = "Start only on the official Liverpool event 1480 seating page. Ticket alerts remain OFF."; renderPilot(); return; }
      if (!testDelivered || !client || controls.pilotPhone.checked !== true || controls.pilotPolicy.checked !== true) { starting = false; renderPilot(); return; }
      const selectedClient = client;
      engine = EvertonAlerts.createEngine({storage: localStorage, send: text =>
        running && client === selectedClient ? selectedClient.send(text) : Promise.resolve({ok: false})});
      if (!engine.valid()) { endPilot("Stored delivery state needs review. Pilot stays OFF."); return; }
      starting = false; running = true; armedAt = Date.now(); lastResponseAt = null;
      controls.pilotStatus.textContent = "DAYTIME PILOT ON — waiting for new Liverpool responses from your normal browser use. No automatic website checks. Keep this panel and laptop awake.";
      renderPilot();
      return new Promise(resolve => { releaseLock = resolve; });
    }).catch(() => endPilot("The browser could not reserve a single pilot session. Pilot stays OFF."));
  });
  controls.pilotStop.addEventListener("click", () => endPilot("Daytime pilot OFF. Session credentials cleared. No automatic website checks."));
  function approvalChanged() {
    if ((running || starting) && (!controls.pilotPhone.checked || !controls.pilotPolicy.checked)) endPilot("Approval withdrawn. Pilot OFF; session credentials cleared.");
    renderPilot();
  }
  controls.pilotPhone.addEventListener("change", approvalChanged);
  controls.pilotPolicy.addEventListener("change", approvalChanged);
  for (const field of [controls.pilotToken, controls.pilotChat]) field.addEventListener("input", () => {
    if (running || starting) { endPilot("Credentials changed. Pilot OFF; session credentials cleared."); return; }
    epoch += 1; connecting = false;
    if (client) client.close(); client = null; testDelivered = false; controls.pilotPhone.checked = false;
    controls.pilotStatus.textContent = "Credentials changed. Verify a new TEST before arming; ticket alerts remain OFF.";
    renderPilot();
  });

  async function processNative(entry, mine) {
    if (!running || mine !== epoch || latched()) return;
    const context = await inspectPage();
    if (!running || mine !== epoch) return;
    if (context.blocked) { endPilot("Restriction observed. Pilot paused pending review.", true); return; }
    if (context.correct !== true) { endPilot("Liverpool page or sign-in session changed. Pilot OFF; credentials cleared."); return; }
    const record = await EvertonResponseReader.readEntry(entry, EvertonProbe.summarize, Date.now(), {expectedEventId: 1480});
    const finalContext = await inspectPage();
    if (!running || mine !== epoch) return;
    if (finalContext.blocked) { endPilot("Restriction observed. Pilot paused pending review.", true); return; }
    if (finalContext.correct !== true) { endPilot("Liverpool page or sign-in session changed. Pilot OFF; credentials cleared."); return; }
    if (!record || record.method !== "POST") return;
    if (record.request_fixture.kind === "explicit-event" && record.request_fixture.event_id === 1480) lastResponseAt = Date.parse(record.request_started_at);
    const result = await engine.consider(record, {pageCorrect: true, restricted: false, armedAt,
      policyAccepted: controls.pilotPolicy.checked === true,
      isCurrent: () => running && mine === epoch && !latched()});
    if (!running || mine !== epoch) return;
    const messages = {
      ALERT_DELIVERED: "POSSIBLE TICKET OPPORTUNITY alert accepted by Telegram. Resale status and purchase remain unconfirmed.",
      DUPLICATE_SUPPRESSED: "Same section snapshot already alerted within 30 minutes. Waiting for new browser responses.",
      NOTIFICATION_FAILED: "Possible opportunity read, but Telegram delivery was not confirmed. No automatic resend; only a fresh later response can retry.",
      NOTIFICATION_RETRY_COOLDOWN: "Telegram retry is paused for at least one minute. No website requests are made."
    };
    controls.pilotStatus.textContent = messages[result.code] || "New Liverpool response read; no alertable opportunity confirmed. No automatic website checks.";
    if (result.stop) endPilot("Pilot paused: local state or access needs review. Session credentials cleared.", result.code === "RESTRICTION_STOP");
    renderPilot();
  }
  if (native) {
    native.network.onRequestFinished.addListener(entry => {
      if (!running) return;
      const meta = EvertonProbe.summarize(entry, armedAt);
      if (!meta) return;
      if (meta.restriction) { endPilot("Access restriction observed. Pilot paused pending review.", true); return; }
      if (Date.parse(meta.request_started_at) < armedAt || meta.method !== "POST") return;
      if (queued >= 20) { endPilot("Too many pending records. Pilot paused for review."); return; }
      queued += 1;
      const eventEpoch = epoch;
      queue = queue.then(() => processNative(entry, eventEpoch)).catch(() => endPilot("Local processing failed. Pilot OFF; credentials cleared.")).finally(() => { queued -= 1; });
    });
    native.network.onNavigated.addListener(() => {
      if (!running) return;
      const mine = ++epoch;
      void inspectPage().then(context => {
        if (!running || mine !== epoch) return;
        if (context.blocked) endPilot("Restriction observed. Pilot paused pending review.", true);
        else if (context.correct !== true) endPilot("Left the Liverpool page or sign-in expired. Pilot OFF; credentials cleared.");
      });
    });
  }
  setInterval(() => {
    if (running && latched()) endPilot("Restriction flag found. Pilot paused pending review.");
    if (running && engine && queued === 0 && !heartbeating) {
      const mine = epoch;
      const selectedEngine = engine;
      heartbeating = true;
      // Share the native-record queue. An in-flight heartbeat must never cause
      // a fresh ticket observation to be discarded as BUSY.
      queue = queue.then(async () => {
        if (!running || mine !== epoch || engine !== selectedEngine) return;
        const result = await selectedEngine.heartbeat(lastResponseAt);
        if (running && mine === epoch && result.code === "HEARTBEAT_FAILED") controls.pilotStatus.textContent = "Routine status message failed. Ticket delivery needs checking; no website requests were made.";
      }).catch(() => endPilot("Local processing failed. Pilot OFF; credentials cleared.")).finally(() => { heartbeating = false; });
    }
    renderPilot();
  }, 1000);
  renderPilot();
})();
