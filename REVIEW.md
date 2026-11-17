# Development review — 16 November 2026

## Result

Reviewed remote branch `ticket-bot-v2` at `d57620880eb2290642074266fa45a27765155e15`.
The original 25 offline tests passed on Python 3.12.14. The revised checkout has
62 passing offline tests. These are simulations derived from the handover, not
recorded real-site fixtures. The safe startup refusal remains enabled.

**There is no established dependable live source and no working overnight monitor.**
No requests were made to the protected ticketing pages or availability endpoints
during this review. No real Telegram messages were sent. No Render changes were made.

## Findings and changes

- Original deduplication tracked only confidence/state, so a different seat could be
  suppressed for 30 minutes. It now tracks opportunity identity, including A → B → A.
- Notification failures previously propagated out of the engine. Telegram errors now
  leave delivery unconfirmed and permit a bounded retry when fresh evidence is supplied.
  There is no queued stale-seat message or automatic resend loop.
- Arbitrary observation reasons are no longer written to console logs.
- Time-based cooldowns use UTC elapsed time; heartbeat quiet hours still use London
  local time, including the autumn clock change.
- Evidence classification now checks age, fixture, response status and whether the
  extraction adapter has been validated. No actual adapter exists yet.
- A standalone access guard latches closed on 401/403/429 or a detected restriction,
  even if a later response succeeds. Waiting cannot reopen it. This does not diagnose
  the cause of a bare HTTP 403. Other failures back off for at least five minutes,
  increasing up to an hour. Those durations are conservative policy choices, not
  measured blocking thresholds or a claim about a permitted polling frequency.
- Default startup still sends nothing, starts no monitoring and exits with code 2.
  Explicit Telegram-test failures exit cleanly without printing raw exceptions.

## Evidence rules

These are internal normalized evidence rules, not an invented external API schema.
Any future extractor must demonstrate that it obtains fresh data for event 1480
from the relevant availability view, rather than a pricing/account response.

| Evidence | Classification | Interpretation |
| --- | --- | --- |
| Loaded page, stadium map, pricing/account HTTP 200 | ERROR/UNKNOWN | No ticket opportunity established |
| ItemsCount = 0 | ERROR/UNKNOWN | The handover disproves its use as a negative signal |
| Fresh validated section availability > 0 | POSSIBLE | May include ordinary tickets; no individual resale seat confirmed |
| Pink marker alone | ERROR/UNKNOWN | Incomplete seat evidence |
| Fresh section/row/seat/price panel with enabled Add to Basket | POSSIBLE | Enough for an early opportunity alert; resale and purchase unconfirmed |
| The reported 014 / 02 / 080 / £75 panel followed by selection rejection | POSSIBLE | Earlier opportunity existed; selection failed for an unknown reason |
| Fresh explicit no-seats view tied to a successful availability response, with no conflicting positive evidence | UNAVAILABLE | This snapshot only; not permanently sold out |
| HTTP 540 / internal error 5085, even with a no-seats popup | ERROR/UNKNOWN | Failure is not verified empty resale inventory |
| 401/403/429, challenge or suspicious-activity restriction | ERROR/UNKNOWN + stop | No more website interactions until manual review |
| Timeout, malformed data, wrong fixture, stale or future evidence | ERROR/UNKNOWN | Do not issue a ticket alert |
| Independently validated resale-specific seat signal | AVAILABLE reserved | No such live signal has been established; new classifier never emits AVAILABLE |

The historical mock classifier is retained only for the original regression tests.
Its `resaleConfirmed` and `selectableResaleSeats` fields remain explicitly fictional.
Never connect it to a live reader.

## Feasible monitoring routes

| Route | Evidence and decision |
| --- | --- |
| Render direct HTTP reader | Already returned 403 for both fixtures; no reason to restart or repeat it |
| Different cloud provider, headers, copied browser cookies or proxies | No evidence of a dependable legitimate solution; do not use as a workaround |
| Official feed or notification service | None identified in this review; official resale guidance documents first-come-first-served ticket release, not an available inventory feed |
| Local ordinary Windows browser with a passive reader | Best candidate for a limited diagnostic because the user already sees useful inventory in that browser; access and permission are not established by this fact |
| Unattended browser with timed reloads | Not justified yet: normal rapid Try Again already triggers restrictions, and there is no demonstrated safe automatic refresh method |

Chrome's documented DevTools Network API can read responses already obtained by
the browser, without replaying requests. An isolated content script can read the
displayed DOM. Neither mechanism by itself discovers inventory that the page has
not fetched. A passive reader is therefore a daytime/manual-use candidate, not
an overnight solution unless genuine native page updates are demonstrated.

The next technical milestone is a **passive diagnostic**, not more website probing:

1. Inspect already-loaded page structure/availability data from normal use, with
   credentials, headers, account information and session values excluded.
2. Validate the extractor against the already-known positive and negative cases;
   do not make the user hunt for a new seat or repeat Fulham investigations.
3. Determine whether the page itself supplies fresh availability while idle.
   If it does not, report the passive fallback's limitation instead of adding
   automatic refreshes or claiming overnight coverage.
4. Only then wire classified observations to Telegram and demonstrate actual
   extraction → classification → delivery. Stop at the first access restriction.

Before any unattended runner: persist restriction and deduplication state across
restarts, identify stale/absent browser updates, handle session expiry, and make
health messages describe actual reader freshness rather than engine liveness.
Request separate production deployment approval only after the complete candidate
is reviewable. Keep changes on `ticket-bot-v2`; do not merge to `main`.

## Credentials

A token-pattern scan of 42 historical text blobs reachable from the reviewed
branch found no Telegram-token-shaped matches. This is a limited repository scan,
not proof that the current token has never appeared elsewhere. No secret values
were printed or recorded by the scan.

The handover does not establish whether the token visible in PowerShell was the
revoked token or its replacement. If the replacement was exposed, or that cannot
be established, rotate it before production via private entry. Do not rotate or
change Render settings during this development review.

## Sources checked

- [Everton resale process](https://www.evertonfc.com/news/2025/july/25/everton-introduce-new-ticketing-process-/)
- [Everton ticket information](https://www.evertonfc.com/tickets/ticket-information)
- [Everton website terms](https://www.evertonfc.com/content/terms-and-conditions)
- [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome DevTools Network API](https://developer.chrome.com/docs/extensions/reference/api/devtools/network)

These documents do not establish specific permission for an Everton ticketing
monitor. No contact with Everton is proposed or required by this review.

## Passive diagnostic implementation

The core fixes above were saved on the remote development branch in commit
`c12b86db56f9f7e66e704a787fa6d40148e97593` through the connected GitHub tool.

`browser_probe/` now implements the bounded passive freshness diagnostic. Its
16 offline JavaScript tests cover endpoint/fixture filtering, old-versus-new
request timing, duplicate callbacks, report privacy, correct-page checks,
navigation, restriction detection and a restriction flag surviving panel reopen.
The panel is exercised with simulated browser APIs. No live browser/website
trial has been performed. The original 62 Python tests were already passing;
the diagnostic does not change the Python alert engine or its startup gate.

The next user action is to download the diagnostic package. Guide installation
and the five-minute idle observation one action at a time. The resulting safe
metadata report will help decide whether the browser supplies idle updates;
it will not itself validate seat extraction or prove unattended viability.

## Correction after reviewing original screenshots — 17 November

The original stadium/Network screenshots were located and reviewed directly.
The 13:15 screenshot shows `POST https://vv-app.eticketing.co.uk/v810/venueAvailability/buy`
returning HTTP 540 with `errorCode: 5085` and `apiErrorMessage: "Event is not on sale"`
while the Liverpool event 1480 map is visible behind the no-seats dialog.
The 13:50 Fulham screenshot shows the response structure `data.section.header`
and `data.section.data`: a tilde-delimited header beginning
`sectionName~totalAvailableSeat~priceCode`, with rows matching the displayed
section figures, including section 205 = 31, 242 = 4 and 243 = 3. Other fields
are cropped/only partly visible, so no complete external schema is asserted.

These screenshots expose a bug in the first passive diagnostic: its filter
assumed availability traffic used the main `www.eticketing.co.uk/evertonfc/`
origin/path. That assumption was wrong. Version 0.1.1 now matches only the
captured HTTPS availability host, version and endpoint families. No requests
have been sent to that service as part of this correction. Tests reconstruct
minimal HAR metadata from the screenshot; they are not a captured live HAR.

20 offline diagnostic tests now pass. The redirect refusal message also explains
that event 1480 has redirected away from the stadium page rather than suggesting
the fixture is wrong. In the user's Edge browser, installation/panel display and
refusal on `EventNotAllowed` have been observed. The attempted direct event
navigation returned the same unavailable page; no further retries are proposed.

The current diagnostic has not completed an idle test. The old static images
support reuse of known UI/API evidence and avoid repeating the Fulham exercise,
but do not demonstrate native updates while idle, a resale-only signal, or a
dependable overnight source. HTTP 200 setup/pricing responses remain insufficient.
No raw screenshots, account identifiers, headers, cookies or response bodies
have been added to this repository.

## Browser observations and response reader — 17 November

After normal sign-in, the user reached the actual Liverpool stadium page with
the no-seats popup. The 0.1.1 panel recorded no new matching requests during a
6m44s idle observation. One normal manual Try Again caused navigation, so the
idle observer paused as designed. Restarting only the diagnostic then read two
historical venueAvailability records: one HTTP 540 and one HTTP 200. No further
website request was needed to read those records. No restriction flag was recorded.

The uploaded metadata report lacks request methods and body contents. It cannot
establish whether the HTTP 200 was a CORS preflight, setup or actual inventory
response. Page-context association also falls short of independent request-level
fixture binding. Its report-generation time is not a recorded observation-stop
time, so it must not be used as a precise duration for that final run. These
limitations prevent a claim of working live ticket detection or overnight coverage.

Version 0.2.0 adds a one-shot response-buffer reader. It never replays website
requests. It reports HTTP methods, does not read OPTIONS bodies, and locally
decodes only the photographed section header/row structure or numeric API error
codes. Root account fields, arbitrary server messages, raw bodies and request
bodies are not exported. Parser tests use a reduced transcription of visible
Fulham columns/rows, explicitly not an original full body. Counts may include
ordinary tickets and zero counts are not a verified negative resale signal.

All body-review observations deliberately remain ERROR/UNKNOWN for live decisions
until fixture binding, freshness and the live reader are validated. Section counts
are decoded facts for review, not confirmed tickets. The Python alert engine and
startup refusal remain unchanged; Telegram and automatic refresh are not enabled.

47 offline JavaScript tests pass, including schema drift, setup/preflight false
positives, HTTP 540/5085, old/future data, privacy, response-buffer timeouts,
navigation during reads, restrictions and interrupted metadata retrieval. A local
headless rendering attempt was prevented by socket permissions. The panel was
exercised through the simulated DOM/DevTools harness; no successful headless
render or live response-buffer validation is claimed. The next bounded user check
is to read the existing buffers after updating the extension, with no new idle
wait or website refresh. Production remains suspended and unchanged.
