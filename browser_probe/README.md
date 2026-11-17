# Everton Passive Check — diagnostic only

This is a development extension for Chrome or Edge on the Windows laptop.
It is **not** a working ticket monitor. It sends no Telegram messages and has
no access to Telegram credentials. It has no host permissions or background
worker. Its extension-page policy forbids outbound network connections.

The idle-check mode observes existing DevTools metadata for the already-identified
`venueAvailability` and `AreaAvailability` endpoint families on the captured
`https://vv-app.eticketing.co.uk/v810/` availability service. The main ticket
page uses a different host. It never refreshes, clicks Try Again, selects a seat,
changes a filter, calls an inventory endpoint or attempts to bypass a restriction.
The new response-review mode reads existing response buffers locally, using
DevTools' `getContent`. It exports only allowlisted section counts or numeric
API error codes. Version 0.2.2 additionally parses supported request event fields
locally and exports only a matching allowlisted event ID. It never exports raw
request/response bodies, other request values, cookies or headers. The only
page inspection returns four booleans: Liverpool seating page, Fulham comparison
seating page, Liverpool unavailable redirect, and visible restriction. It returns
no page text or URL. The idle check remains Liverpool-only.

Version **0.1.1** corrects the host filter using the 16 November stadium/Network
screenshots. Version 0.1.0 incorrectly looked for inventory requests on the main
ticket-page host and would have missed this service. No completed idle test or
availability inference from that version should be treated as evidence.

Version **0.2.0** adds HTTP-method reporting and a one-shot response review. An
OPTIONS/preflight response is not inventory and its body is not read. A POST
response is decoded only for the captured venueAvailability structure. Missing
buffers, unexpected schemas, timeouts and access restrictions stay UNKNOWN.
Decoded positive section counts still do not validate a live source: they can
include ordinary tickets, may be historical, and lack proven request-level
fixture binding. No diagnostic output enables Telegram alerts.

## What this answers

The idle check asks whether the browser initiates new matching requests while
left untouched. The response review asks what already-received records contain.
Neither mechanism fetches new inventory or establishes unattended viability.

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
5. For the next validation, click **Read existing responses**. There is no need
   to repeat the idle wait, refresh the website or click Try Again. Reading old
   buffers cannot make those responses fresh; the report records their age.
6. Click **Save response report** and share `Everton_Response_Report.json`.
   Never share a raw HAR or full Network export. If buffers are unavailable,
   report that limitation; do not automatically generate new website traffic.

To update an existing installation, replace its files with the new package in
the same folder, use **Reload** on its extension card, then reopen DevTools.
The browser's Developer mode and the extension's own switch must stay enabled.

The assistant should guide these steps individually, not give the user a large
technical setup task. No need to hunt for an individual seat or repeat the idle wait.

Version **0.2.1** permits response review on the Fulham event 1481 page as a
positive decoder comparison. It labels the result and export as comparison-only,
rejects explicitly conflicting request event IDs, and leaves every decision
ERROR/UNKNOWN. Existing unbound log entries have only page-context association;
changing the page does not prove which fixture generated a historical response.
Use a separate normal Fulham tab with DevTools open before one ordinary event
navigation if a comparison is needed. No repeat refreshes or threshold testing.
The extension itself still sends no website requests. The uploaded 0.2.1 comparison report demonstrates positive decoding from a
complete real response: 415 places across 15 sections. The visible section 216
(2) and 227 (14) counts match the map screenshot. This does not prove resale-only
availability or freshness while idle.

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
node --test browser_probe/test_probe.cjs browser_probe/test_response_reader.cjs
python -m unittest -q
```

There are 62 passing offline JavaScript tests. They use reconstructed metadata
and reduced screenshot transcriptions, not original full HAR/body recordings.
The 0.2.3 request event-ID path has now completed a real Edge report for Fulham.
That bounded comparison is distinct from the offline tests and does not
validate fresh Liverpool opportunities or unattended updates.
An attempted local Chromium render was blocked by the environment's socket
permissions; no completed headless render is claimed. The DOM/DevTools harness
covers the panel's response-review and safe-report objects.

Version 0.1.1 has been installed and its metadata reader demonstrated in Edge:
it read two historical venueAvailability records, HTTP 540 and HTTP 200. Their
methods were absent from that report; it cannot establish whether the 200 was
a preflight, setup or actual inventory response. A 6m44s idle observation showed
no new matching records. Do not generalize that to proof the site never updates.
The uploaded 0.2.0 report demonstrates negative response decoding: POST HTTP 540
with API error 5085, and OPTIONS HTTP 200 correctly excluded as preflight.
These records were historical, not a fresh source. No block flag was observed
in this report; that does not establish unrestricted continuous access.
The diagnostic requires no Node installation for normal browser use; Node is
used only for the developer test suite.

## Explicit request fixture check (0.2.2)

Response review now checks eventId/event_id at the JSON request root, in
URL-encoded form fields, or in the request URL. These are candidate formats,
not a claim that the live API uses them: only a real buffer check can establish
that. Unsupported or absent fields remain unknown. Duplicate, unsupported nested, escaped,
invalid and conflicting event fields fail closed. Version 0.2.3 adds the exact
observed command structure described below. Arbitrary event IDs are never
exported. A conflicting ID prevents response decoding for that record.
Only the two allowlisted page fixtures 1480 and 1481 can be exported as matches.
Other request values remain local; no raw request body is copied into reports.
OPTIONS/preflight and restricted responses do not inspect request body fields.
The idle metadata reader is unchanged and still does not read request bodies.

After updating, use Read existing responses on the existing Fulham tab without
a website refresh. Closing/reopening DevTools may discard response buffers in
some browsers; if absent, report that limitation instead of repeated refreshes.
Even a matching ID leaves the decision ERROR/UNKNOWN in this diagnostic. No
Telegram messages, automatic refresh or live availability decision is enabled.

## Captured command structure correction (0.2.3)

The real Payload screenshot shows a JSON object containing command.eventId
and command.targetEvent, both identifying 1481, under DevTools' Form data
heading. The 0.2.2 parser checked ordinary form fields or JSON-root event IDs
and missed this structure; its unknown result did not establish that the
browser omitted request data. The uploaded report therefore remained unknown.

Version 0.2.3 handles the observed JSON command under JSON MIME, raw JSON under
form MIME, or a JSON-only form key with an empty value. Both command fields
must be present and agree with the inspected fixture and any explicit URL
event ID. Duplicate command/event/target keys, mixed binding structures,
unsupported nesting and conflicting values fail closed. No other command
values leave the decoder. Tests use a minimal two-field reconstruction from
the screenshot, not the user's full request payload. All decisions remain
ERROR/UNKNOWN until live extraction and freshness are validated.

Do not repeat website reloads merely to test packaging changes. Try the
existing record first after updating; if DevTools discarded it, validate on
the next ordinary manual ticket check. No automatic requests are enabled.

## Completed comparison validation and remaining limit

The uploaded 0.2.3 report confirms a completed review, explicit request event
1481 matching the inspected Fulham page, and 400 places across 14 sections.
The response was 19 seconds old when reviewed. OPTIONS 200 was excluded, and
no restriction flag was observed in this bounded capture. It does not
establish a safe automatic checking interval or guaranteed continuous access.
The report remains ERROR/UNKNOWN for live ticket decisions by design.

This completes the positive response/request-decoder comparison. Further
repeated Fulham checks or package updates are not required for this milestone.
No fresh positive Liverpool extraction, continuous native availability updates,
resale-only counts, overnight monitoring, or extraction-to-Telegram delivery
is validated. The passive reader cannot discover inventory the page has not
fetched. Keep the live startup refusal and production suspension in place.
