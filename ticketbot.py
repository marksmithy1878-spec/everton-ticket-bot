"""Safe alerting core. Does not make any ticketing website requests."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
import json
import os
from zoneinfo import ZoneInfo
from urllib.parse import urlencode
from urllib.request import Request, urlopen

LONDON = ZoneInfo("Europe/London")
EVENT_ID = 1480  # Verified from the user's Everton ticketing screenshot, 16 Nov 2026
EVENT_URL = f"https://www.eticketing.co.uk/evertonfc/EDP/Event/Index/{EVENT_ID}"


class State(str, Enum):
    AVAILABLE = "AVAILABLE"        # Requires an independently verified resale signal
    POSSIBLE = "POSSIBLE"          # Seats indicated, resale/purchasability not verified
    UNAVAILABLE = "UNAVAILABLE"    # Requires a trustworthy negative signal
    UNKNOWN = "ERROR/UNKNOWN"


@dataclass(frozen=True)
class Observation:
    state: State
    reason: str
    event_id: int = EVENT_ID
    opportunity_key: str = "event:1480"


class TelegramError(Exception):
    pass


def london_now() -> datetime:
    return datetime.now(LONDON)


def aware_utc(now: datetime) -> datetime:
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("An explicit time zone is required")
    return now.astimezone(timezone.utc)


def is_heartbeat_quiet(now: datetime) -> bool:
    """Routine heartbeat messages are suppressed from 00:00 through 05:59 UK time."""
    return 0 <= aware_utc(now).astimezone(LONDON).hour < 6


def validate_observation(obs: Observation) -> None:
    if obs.event_id != EVENT_ID:
        raise ValueError(f"Wrong event ID: {obs.event_id}; expected {EVENT_ID}")
    if not isinstance(obs.state, State):
        raise ValueError("Unexpected observation state")
    if not isinstance(obs.opportunity_key, str) or not obs.opportunity_key or len(obs.opportunity_key) > 512:
        raise ValueError("Invalid opportunity identity")


def classify_example_response(http_status: int | None, payload: object, *, fixture_id: int) -> Observation:
    """
    Conservative offline response-classification EXAMPLE, not a live ticketing integration.
    'resaleConfirmed' is a hypothetical test field, not a proven Everton API field.
    Never use this function to scrape the ticketing platform or as a production detector.
    """
    if fixture_id != EVENT_ID:
        return Observation(State.UNKNOWN, "Wrong fixture; ignored", fixture_id)
    if http_status is None:
        return Observation(State.UNKNOWN, "Request failed or timed out")
    if http_status != 200:
        return Observation(State.UNKNOWN, f"HTTP {http_status}; availability unknown")
    if not isinstance(payload, dict):
        return Observation(State.UNKNOWN, "Invalid/unexpected response")
    if payload.get("eventId") != EVENT_ID:
        return Observation(State.UNKNOWN, "Response fixture is not validated")
    # A successful page or section-level inventory count is NOT enough to claim
    # that a resale ticket can be selected/purchased.
    if payload.get("resaleConfirmed") is True and payload.get("selectableResaleSeats") is not None:
        count = payload["selectableResaleSeats"]
        if type(count) is not int or count < 0:
            return Observation(State.UNKNOWN, "Invalid selectable resale count")
        if count > 0:
            return Observation(State.AVAILABLE, f"Verified selectable resale signal: {count}")
        return Observation(State.UNAVAILABLE, "Verified resale inventory is empty")
    total = payload.get("totalAvailableSeat")
    if type(total) is int and total > 0:
        return Observation(State.POSSIBLE, f"{total} seats reported; resale status unverified")
    return Observation(State.UNKNOWN, "No verified resale availability signal")


def telegram_send(text: str, *, token: str | None = None, chat_id: str | None = None) -> None:
    token = token or os.getenv("TELEGRAM_TOKEN")
    chat_id = chat_id or os.getenv("CHAT_ID")
    if not token or not chat_id:
        raise TelegramError("TELEGRAM_TOKEN and CHAT_ID must be set in private environment variables")
    body = urlencode({"chat_id": chat_id, "text": text, "disable_web_page_preview": "true"}).encode()
    req = Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=15) as r:
            status = r.status
            result = json.loads(r.read().decode("utf-8"))
        if status != 200 or not isinstance(result, dict) or result.get("ok") is not True:
            raise TelegramError(f"Telegram send failed (HTTP {status})")
    except TelegramError:
        raise
    except Exception as e:
        # Do not print the request URL, which contains the Telegram token.
        raise TelegramError(f"Telegram send failed ({type(e).__name__})") from None


class AlertEngine:
    """Keeps deduplication and operational checks independent from site access."""

    def __init__(self, send, *, repeat_after=timedelta(minutes=30),
                 failure_threshold=3, failure_repeat=timedelta(hours=1),
                 heartbeat_every=timedelta(hours=6)):
        self.send = send
        self.repeat_after = repeat_after
        self.failure_threshold = failure_threshold
        self.failure_repeat = failure_repeat
        self.heartbeat_every = heartbeat_every
        self.last_opportunity_alert = None
        self.last_opportunity_state = None
        self.last_failure_alert = None
        self.last_heartbeat = None
        self.errors_in_row = 0
        self.opportunities = {}
        self.notification_retry_at = None

    def _deliver(self, text: str, now: datetime) -> bool:
        if self.notification_retry_at is not None and now < self.notification_retry_at:
            return False
        try:
            self.send(text)
        except TelegramError:
            # Keep the opportunity eligible. Re-evaluate fresh evidence on the next
            # call rather than queueing a seat which may no longer be available.
            self.notification_retry_at = now + timedelta(minutes=1)
            print("Telegram notification failed; delivery not confirmed", flush=True)
            return False
        self.notification_retry_at = None
        return True

    def process(self, obs: Observation, now: datetime | None = None) -> str:
        now = aware_utc(now or london_now())
        validate_observation(obs)
        # Do not log arbitrary reason strings, raw page data or request URLs.
        print(f"{now.astimezone(LONDON).isoformat()} event={obs.event_id} state={obs.state.value}", flush=True)
        if obs.state == State.UNKNOWN:
            self.errors_in_row += 1
            if (self.errors_in_row >= self.failure_threshold and
                (self.last_failure_alert is None or now - self.last_failure_alert >= self.failure_repeat)):
                delivered = self._deliver(f"⚠️ Everton ticket monitor ERROR/UNKNOWN ({self.errors_in_row} consecutive checks). "
                          f"Detection may be blocked. This is NOT sold out.\n{EVENT_URL}", now)
                if not delivered:
                    return "notification-failed"
                self.last_failure_alert = now
                return "failure-warning-sent"
            return "unknown"
        self.errors_in_row = 0
        if obs.state in (State.AVAILABLE, State.POSSIBLE):
            previous = self.opportunities.get(obs.opportunity_key)
            due = (previous is None or
                   (obs.state == State.AVAILABLE and previous[1] != State.AVAILABLE) or
                   now - previous[0] >= self.repeat_after)
            if due:
                label = "RESALE SEAT DETECTED" if obs.state == State.AVAILABLE else "POSSIBLE TICKET OPPORTUNITY"
                delivered = self._deliver(f"🚨 {label}\nEverton v Liverpool — 29 Nov 2026\n"
                          f"{obs.reason}\nCheck immediately; no purchase is guaranteed.\n{EVENT_URL}", now)
                if not delivered:
                    return "notification-failed"
                self.last_opportunity_alert = now
                self.last_opportunity_state = obs.state
                self.opportunities[obs.opportunity_key] = (now, obs.state)
                return "opportunity-alert-sent"
            return "duplicate-suppressed"
        # UNAVAILABLE resets the edge so a fresh opportunity can re-alert immediately.
        self.last_opportunity_state = None
        self.opportunities.clear()
        return "unavailable"

    def maybe_heartbeat(self, now: datetime | None = None) -> bool:
        now = aware_utc(now or london_now())
        if is_heartbeat_quiet(now):
            return False
        if self.last_heartbeat is not None and now - self.last_heartbeat < self.heartbeat_every:
            return False
        if not self._deliver(f"ℹ️ Everton monitor heartbeat: alert engine running. "
                  f"This does NOT confirm live ticket detection.\n{EVENT_URL}", now):
            return False
        self.last_heartbeat = now
        return True
