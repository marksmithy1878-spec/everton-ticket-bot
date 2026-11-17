# Everton v Liverpool 2026 — safe alert engine prototype

**NOT A LIVE TICKET MONITOR.** Do not deploy to Render as a ticket detector.

Event ID: **1480** (seen on the official Everton ticket page screenshot, 16 Nov 2026).
Fixture: Everton v Liverpool, 29 November 2026.

## What is ready
- Telegram test message (credentials from environment variables, checked API response).
- Safe handling of UNKNOWN/ERROR, AVAILABLE, UNAVAILABLE and POSSIBLE signals.
- Duplicate prevention with repeat alerts after 30 minutes.
- Different identified seats can alert immediately; returning to an already alerted seat is suppressed.
- Telegram failures are caught without marking an alert delivered. Another attempt is allowed
  after at least one minute, only when a caller supplies current evidence again.
- Errors produce a warning after 3 consecutive failures, then at most hourly.
- Routine heartbeats suppressed from midnight until 06:00 UK time; opportunity alerts can fire anytime.
- Logs in Europe/London time.
- Automated offline tests for HTTP 403, 404, 540, invalid data, timeouts, false alerts and BST/GMT.
- `evidence.py` classifies normalized evidence with freshness, fixture and parser-validation checks.
  Its Python fields are internal types, not claims about Everton's actual response format.
- `AccessGuard` is a tested circuit-breaker component for a future reader: restrictions latch
  it closed; transient failures back off. It is not wired to a live source or request loop.
- Hard stop if someone tries to start it as a live worker.

## Not ready (critical)
- The official ticket platform returned HTTP 403 for event pages 1480 and 1481 from the Render worker.
- No permitted, independently validated live resale feed has been identified.
- The `resaleConfirmed` and `selectableResaleSeats` example fields are **fictional mock fields**
  and are used ONLY by the offline tests; they must not be treated as real API fields.
- `totalAvailableSeat` is section-level availability, not proof of resale tickets.
- This package does **not** poll or interact with the Everton/Ticketmaster website.
- No live site detection or Render deployment has been performed. Telegram authentication and a
  real phone delivery were verified by the user before this review; tests in this checkout are mocked.
- Deduplication and restriction state are currently in memory. Durable state and restart protection
  must be integrated with a real runner before unattended operation is approved.
- No polling interval has been demonstrated safe. Moving providers or using an ordinary browser
  is not proof of permission, reliable access, or protection from restrictions.

## Test locally
Python 3.10+:
```
python -m unittest -v
```

## Telegram test (after rotating exposed token)
Set `TELEGRAM_TOKEN` and `CHAT_ID` in your **private** environment, then:
```
python main.py --telegram-test
```
Never share or commit token values.

## Next development step
Integrate a legitimate, validated read-only resale availability signal if one becomes
available, with tests against known AVAILABLE and UNAVAILABLE live examples. Until then
keep Render suspended and Auto-Deploy Off. A different hosting provider alone does not
prove website access is permitted or that data is correct.

See [REVIEW.md](REVIEW.md) for the code review, classification rules and proposed browser validation.

## Passive browser diagnostic (development only)

[`browser_probe`](browser_probe/README.md) contains a small Chrome/Edge DevTools
extension that observes existing availability-request metadata. Version 0.2.3
also reads response buffers already held by DevTools, exporting only allowlisted
section counts, numeric error codes or matching fixture IDs. It never refreshes, clicks, calls inventory
endpoints or sends Telegram messages. It is not a ticket detector.

The diagnostic has 62 passing offline JavaScript tests, including a panel run
against simulated DevTools APIs. The 0.2.0 body reader has decoded a real Liverpool HTTP 540/API 5085 error
and excluded the OPTIONS 200 preflight in Edge. These historical records are
not fresh ticket evidence. The 0.2.1 Fulham comparison report also demonstrates positive decoding in
Edge: 415 places across 15 sections, with the visible section 216 and 227 counts
matching the map. Resale-only inventory and unattended freshness remain unverified.
Version 0.2.3 supports the observed JSON command inside form-labelled request
data, checking both command.eventId and command.targetEvent. The request format
has been identified in the real Payload view and the corrected reader has
completed a real Edge report: explicit request event 1481, 400 places across
14 sections, response age 19 seconds at review, preflight excluded. This verifies
comparison-fixture decoding; it does not validate Liverpool positive detection
or an unattended source. No automatic requests are added. No repeated idle wait or Network-panel investigation is needed.
Version 0.1.1 corrected the initial host filter to the captured
`vv-app.eticketing.co.uk/v810/` service. No fresh unattended feed, live seat
classifier or overnight operation is validated.

```
node --test browser_probe/test_probe.cjs browser_probe/test_response_reader.cjs
```

The comparison diagnostic is complete. No additional installation or repeated
Fulham page loads are needed for this milestone. There is no dependable
unattended live source under the currently demonstrated access conditions.
The existing Render worker stays suspended; the Python startup gate and
extension's disabled ticket-alert state remain in place. A passive reader
can only see data the normal browser obtains. Automatic polling/refresh and
a complete Liverpool extraction-to-Telegram alert have not been demonstrated.
