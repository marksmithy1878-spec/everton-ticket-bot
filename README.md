# Everton v Liverpool 2026 — development project

**No dependable unattended ticket monitor has been demonstrated.** Keep Render suspended. The optional daytime candidate starts OFF.

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
- Browser request/response decoding has been demonstrated on Fulham. A positive Liverpool
  opportunity-to-phone alert and any unattended monitor remain unverified. Render is unchanged.
  Telegram phone delivery was verified earlier through a different path; the new browser sender
  has only simulated transport tests and still needs a private real TEST.
- The Python prototype keeps deduplication/restriction state in memory. The separate daytime
  browser candidate persists only delivery fingerprints and a restriction latch. Neither provides
  an approved unattended runner.
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

Review and install the optional local daytime candidate, privately verify a TEST
message, resolve any earlier token exposure, then obtain explicit approval before
arming real ticket alerts. This candidate only reacts to new responses generated
by normal browser use; it never refreshes Everton or supplies overnight coverage.
Keep Render suspended and Auto-Deploy Off. A different cloud provider is not an
established fix for the existing 403 responses.

See [REVIEW.md](REVIEW.md) for the investigation and live evidence.

## Browser reader and optional daytime candidate

[`browser_probe`](browser_probe/README.md) includes the verified section/fixture
reader and the new **0.3.1 daytime candidate**. [Setup and limits](browser_probe/DAYTIME_PILOT.md)
are written for the laptop user. The candidate starts OFF, uses new native
browser callbacks only, and cannot turn saved reports or Fulham counts into
Liverpool alerts. A fresh successful event-1480 command response with positive
section counts can produce POSSIBLE TICKET OPPORTUNITY after explicit local
approval. It never claims confirmed resale, individual-seat identity or purchase.

The reader has been demonstrated in Edge: Liverpool HTTP 540/API 5085 remains
unknown; Fulham event 1481 explicitly matched its request and decoded 400 places
across 14 sections. OPTIONS 200 is correctly excluded. That comparison is distinct
from proving a positive Liverpool alert or unattended source.

There are **119 passing offline JavaScript tests**, including a complete simulated
reader → classifier → Telegram path, credential gate, wrong bot, notification
failures, persisted duplicates/restrictions, navigation races, one active session,
UK quiet hours and a heartbeat overlapping a ticket observation. No real Telegram
messages or ticket-site requests were sent by these tests. The Python code and
its safe startup refusal are unchanged.

```
node --test browser_probe/test_*.cjs
python package_browser.py
```

The extension's only outbound permission is api.telegram.org; it has no ticket-site
host permission, reload/click loop or background worker. Token and chat ID live only
in its panel session and are cleared from inputs on use. Reviewable code is on
`ticket-bot-v2`; no Render deployment or settings change has occurred. The user has since
reported privately rotating the BotFather token; the replacement has not yet
completed the new browser sender's real TEST.

## Current Telegram connection blocker (0.3.1)

The installed 0.3.0 pilot's real TEST failed with its broad
TELEGRAM_NETWORK_OR_TIMEOUT code. No successful phone delivery was reported.
That code does not identify whether verification or message delivery failed,
or distinguish a timeout from another fetch failure. Normal browser navigation
to the public API root redirected to Telegram documentation, and Edge's main
site-access switch is on. Neither establishes working extension transport.

Version 0.3.1 binds the native fetch receiver, reports fixed timeout/fetch/security
error codes and TEST stage, and adds a credential-free permission/public-API check.
This is a diagnostic improvement, not a claim that the real network cause is fixed.
The check performs one token-free request, sends no message and cannot arm alerts.
Current BotFather replacement credentials were entered privately; the agent has
not received them. Render still holds the previous revoked token, remains
suspended, and must not be restarted without an approved credential update.
