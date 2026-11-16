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
