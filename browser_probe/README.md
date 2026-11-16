# Everton Passive Check — diagnostic only

This is a development extension for Chrome or Edge on the Windows laptop.
It is **not** a working ticket monitor. It sends no Telegram messages and has
no access to Telegram credentials. It has no host permissions or background
worker. Its extension-page policy forbids outbound network connections.

It observes only existing DevTools metadata for the already-identified
`venueAvailability` and `AreaAvailability` endpoint families on the official
Everton ticketing origin. It never refreshes, clicks Try Again, selects a seat,
changes a filter, calls an inventory endpoint or attempts to bypass a restriction.
It does not read response bodies, request bodies, cookies or headers. The only
page inspection reads whether the current location is event 1480 and whether
a known restriction phrase is visible; it returns two booleans, not page text.

## What this answers

Does the browser initiate new availability requests while you leave the page
untouched? That has not been established in the handover and matters before
claiming any passive unattended monitoring could work.

The check distinguishes requests that started before the check from requests
started during it. Old DevTools records cannot masquerade as new updates.
It does not claim that a response is fresh, resale-only, or for a particular seat.
If an inventory URL lacks an explicit eventId, its association is labelled only
"Page context". Event linkage must still be verified before ticket alerts.

## Installation (walk through one action at a time)

1. Download and extract the diagnostic ZIP to an ordinary folder.
2. Open `edge://extensions` or `chrome://extensions`, matching the browser you
   normally use for tickets. Turn on Developer mode to load this local diagnostic.
3. Choose **Load unpacked**, then the extracted folder containing `manifest.json`.
4. On the existing Liverpool ticket tab, open Developer Tools (F12). Select the
   **Everton Check** tab, which may be under its overflow menu. If DevTools was
   already open when you installed the extension, close and reopen DevTools only.
   Do not reload the website merely to populate the old network log.
5. Click **Start idle check**. Leave the ticket page untouched for five minutes.
   Do not refresh, click Try Again, change filters or open sections during this check.
6. Click **Finish check**, then **Save safe report**. Share only the generated
   `Everton_Passive_Report.json`, never a raw HAR or full Network export.

The assistant should guide these steps individually, not give the user a large
technical setup task. No need to hunt for a new seat or revisit Fulham.

## Restrictions and limitations

401/403/429 on a relevant observed response, or a recognised visible restriction
phrase during a context inspection, stops this diagnostic. A restriction flag is
saved locally so reopening the panel does not silently clear it. A bare 403 is
an access failure; this tool does not determine its cause.

It does not continuously inspect the DOM. A restriction phrase that appears
without any relevant network completion may go unobserved; if you see one,
stop using the website and tell the assistant. The probe never makes any website
request regardless of whether it detects a restriction.

Missing records do not prove the site cannot update: a changed endpoint, browser
visibility limits or opening DevTools late can also explain them. Successful
requests alone do not prove new seats, fresh inventory, permission to automate,
or safe continuous operation. Five minutes is a bounded diagnostic, not a test
of blocking thresholds. No automatic polling interval is selected.

Keep the diagnostic running on only one ticket tab. It is paused on navigation.
Its state belongs to this DevTools panel, not a server, and the idle test requires
the laptop/browser to stay awake. Remove the extension when the diagnostic is done.

## Developer checks

From the repository root, run:

```
node --test browser_probe/test_probe.cjs
python -m unittest -q
```

The extension still requires a real Chrome/Edge trial on the user's machine.
Simulated browser APIs do not validate live page access or detection.
