# Everton browser reader and daytime candidate

Version 0.3.0 contains the previously demonstrated passive decoder plus an
optional, explicitly armed local Telegram pilot. Start OFF. The pilot has **not**
been demonstrated with a real positive Liverpool opportunity or the new browser
sender's real phone delivery. It does not establish unattended monitoring.

See [DAYTIME_PILOT.md](DAYTIME_PILOT.md) for plain-English setup and limits.

## Demonstrated evidence

| Check | Result |
| --- | --- |
| Liverpool map/no-seats and venue POST HTTP 540/API 5085 | Failed availability request; ERROR/UNKNOWN, not proof of empty resale stock |
| HTTP 200 OPTIONS | Browser preflight; its body is not inventory |
| Fulham POST response | Section decoder read 400 places across 14 sections in a completed real Edge report |
| Fulham request fixture | Explicit event 1481 from the form-labelled JSON command matched the inspected page |
| Response age in that report | 19 seconds at review, not a continuing source of fresh inventory |
| Bounded Liverpool idle observation | No new matching requests over 6m44s; do not generalize to proof the site never updates |
| Render direct access | Previously returned 403; no retries or alternate cloud workaround introduced |

The captured service is https://vv-app.eticketing.co.uk/v810/venueAvailability/buy.
The initial 0.1.0 probe incorrectly filtered the main page origin; 0.1.1 corrected
that. Version 0.2.0 added response decoding; 0.2.1 added labelled Fulham comparison;
0.2.2 missed the actual command structure. Version 0.2.3 corrected and demonstrated
explicit request binding. The detailed investigation is in ../REVIEW.md.

## Candidate data flow

The diagnostic Read existing responses path still exports only safe facts and
keeps its observations ERROR/UNKNOWN. It is separate from the optional pilot.
The pilot never imports getHAR history or reads saved report files for alerting.
Only new native onRequestFinished callbacks after explicit arming can enter it.

Before a ticket message, it requires all of:

- An explicitly approved session, a TEST accepted by the correct bot and user
  confirmation that the TEST arrived on the intended phone.
- The inspected page is the exact official event 1480 seating path, before and
  after reading, with no observed restriction.
- A POST HTTP 200 from the captured venue endpoint, started after arming and no
  more than 120 seconds old. Freshness is checked again before sending.
- Both command.eventId and command.targetEvent agreeing on 1480, with duplicate,
  conflicting, escaped and unsupported binding structures rejected.
- A valid decoded section table with positive counts and a consistent total.

The result is POSSIBLE only. AVAILABLE and confirmed resale are never emitted.
A positive Liverpool decoder-to-phone case is still unverified. Zero counts,
malformed bodies, failed responses, setup/pricing and OPTIONS remain unknown.
The format demonstrated on Fulham is used as an explicitly acknowledged candidate
for Liverpool, not advertised as a verified resale-only live feed.

No user profile, request headers, cookies, other request fields or raw bodies are
exported. The local payload decoder supports the captured JSON command under JSON
MIME, raw JSON under form MIME, and a JSON-only form key with an empty value.
Only event IDs 1480 and 1481 can leave the request-fixture diagnostic as matches.

## Website access and permissions

No host permissions for Everton or the inventory service; no background worker,
proxy, disguised HTTP, CAPTCHA handling, reload, click or availability request loop.
The existing inspected-page expression returns only four booleans (Liverpool,
Fulham comparison, unavailable redirect and visible restriction); it exports no
page contents or URL. Native DevTools buffers are read without replaying requests.

The 0.3.0 manifest newly permits only https://api.telegram.org/*, and connect-src
is restricted to that origin. No credentials are embedded. A verified client
may call getMe and sendMessage after the user's explicit TEST/arming actions.
Calls use POST, no browser credentials, no referrer, no redirect-following and a
10-second timeout. Failures expose only fixed codes, never raw token-bearing URLs
or server descriptions. Wrong bot usernames cannot send even the TEST. Telegram
429 retry_after is respected without an automatic retry loop.

Token and chat ID are cleared from input fields on use and kept only in the local
client closure. Closing/reloading the panel or Stop discards them. They are not
saved in localStorage, reports or logs. Local persistent data consists only of
SHA-256 snapshot fingerprints/delivery timestamps and a restriction latch.
The earlier possible token exposure must be resolved before live arming.

## Session and failure controls

Web Locks admits one pilot per extension origin/browser profile. There is no
cross-profile/device lock. Navigation invalidates pending reads; leaving Liverpool
or sign-in expiry stops and clears the client. A normal manual reload of the same
Liverpool event may continue the session, but old queued reads are discarded.
401/403/429 and observed challenges persist a pause. There is no automatic reset.
Restriction recognition is bounded by visible fixed phrases and watched responses;
it is not a guarantee that every protection page can be recognised.

The delivery ledger persists duplicate suppression for 30 minutes. Section-order
changes do not create new identities. A-B-A is suppressed and a genuinely different
snapshot need not wait. This is coarse section identity, not seat identity; a
replacement seat leaving identical counts may be missed. Corrupted, unreadable or
unwritable persistent state stops the pilot rather than silently losing protection.
Notification failures are not marked delivered; a later fresh observation can
retry after at least one minute. No message is retried from old saved evidence.
A timeout after Telegram accepted a message can still cause uncertain delivery;
exactly-once messaging is not guaranteed.

Hourly routine messages are quiet between 00:00 and 06:00 Europe/London. Opportunity
messages ignore quiet hours. Heartbeat wording distinguishes local liveness from
freshness of browser data. Heartbeats and observations share a queue so an in-flight
heartbeat does not drop a ticket observation. Sleep/DevTools closure is not covered.

## Developer verification

```
node --test browser_probe/test_*.cjs
python package_browser.py
```

110 offline JavaScript tests pass. They cover the pure decoders, full simulated
DOM/DevTools/Telegram path, approval gates, wrong bot, default OFF, false positives,
HTTP failures, timeouts, rate limiting, persisted duplicates/restrictions, UK DST
and quiet hours, storage failures, stale data, navigation races, single-session
locks and heartbeat/ticket overlap. Default SHA-256 hashing is exercised too.
Synthetic positive Liverpool cases are explicitly simulations. The real negative
Liverpool and positive Fulham diagnostic reports establish only their stated
reader paths. No real website requests or Telegram messages were made by the tests.
The Python engine and its startup refusal are unchanged. A previous attempted
headless render was blocked by environment socket permissions; no successful
headless rendering or real Edge pilot demonstration is claimed.

Primary documentation: [Chrome DevTools Network](https://developer.chrome.com/docs/extensions/reference/api/devtools/network),
[Telegram Bot API](https://core.telegram.org/bots/api), and
[Web Locks](https://www.w3.org/TR/web-locks/).
