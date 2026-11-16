# Everton v Liverpool 2026 — safe alert engine prototype

**NOT A LIVE TICKET MONITOR.** Do not deploy to Render as a ticket detector.

Event ID: **1480** (seen on the official Everton ticket page screenshot, 16 Nov 2026).
Fixture: Everton v Liverpool, 29 November 2026.

## What is ready
- Telegram test message (credentials from environment variables, checked API response).
- Safe handling of UNKNOWN/ERROR, AVAILABLE, UNAVAILABLE and POSSIBLE signals.
- Duplicate prevention with repeat alerts after 30 minutes.
- Errors produce a warning after 3 consecutive failures, then at most hourly.
- Routine heartbeats suppressed from midnight until 06:00 UK time; opportunity alerts can fire anytime.
- Logs in Europe/London time.
- Automated offline tests for HTTP 403, 404, 540, invalid data, timeouts, false alerts and BST/GMT.
- Hard stop if someone tries to start it as a live worker.

## Not ready (critical)
- The official ticket platform returned HTTP 403 for event pages 1480 and 1481 from the Render worker.
- No permitted, independently validated live resale feed has been identified.
- The `resaleConfirmed` and `selectableResaleSeats` example fields are **fictional mock fields**
  and are used ONLY by the offline tests; they must not be treated as real API fields.
- `totalAvailableSeat` is section-level availability, not proof of resale tickets.
- This package does **not** poll or interact with the Everton/Ticketmaster website.
- No live site detection, Render deployment, or production Telegram test has been performed.

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
