"""Classify normalized, fresh evidence. No network access or live site adapter.

These are internal Python types, NOT an alleged Everton response schema.
An adapter must first be demonstrated against genuine page/response examples.
AVAILABLE remains deliberately unreachable until a resale-specific signal is validated.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
import re

from ticketbot import EVENT_ID, Observation, State


class Kind(str, Enum):
    PAGE = "page-only"
    SEAT_PANEL = "seat-panel"
    SECTION_COUNTS = "section-counts"
    NO_SEATS = "explicit-no-seats"


@dataclass(frozen=True)
class Seat:
    section: str
    row: str
    number: str
    price_pence: int
    add_to_basket_enabled: bool

    def valid(self) -> bool:
        # Tight internal allowlist: do not copy arbitrary page/account text to alerts.
        return (all(isinstance(s, str) and re.fullmatch(r"[A-Za-z0-9]{1,6}", s)
                    for s in (self.section, self.row, self.number))
                and type(self.price_pence) is int and 0 < self.price_pence <= 100000
                and self.add_to_basket_enabled is True)

    @property
    def key(self) -> str:
        return f"seat:{self.section.upper()}:{self.row.upper()}:{self.number.upper()}"


@dataclass(frozen=True)
class Evidence:
    event_id: int
    captured_at: datetime
    kind: Kind = Kind.PAGE
    # Status of the relevant availability response, never a pricing/account request.
    http_status: int | None = None
    restricted: bool = False
    timed_out: bool = False
    # Defaults fail closed; an unvalidated parser must not emit ticket alerts.
    adapter_validated: bool = False
    seat: Seat | None = None
    section_counts: tuple[tuple[str, int], ...] = ()
    selection_rejected: bool = False


def classify(e: Evidence, now: datetime, *, max_age=timedelta(minutes=2)) -> Observation:
    """Describe this snapshot only; no claim that a ticket can be purchased."""
    def unknown(reason):
        return Observation(State.UNKNOWN, reason)

    if e.event_id != EVENT_ID:
        return unknown("Wrong fixture; evidence ignored")
    if (now.tzinfo is None or now.utcoffset() is None or
            e.captured_at.tzinfo is None or e.captured_at.utcoffset() is None):
        return unknown("Evidence needs an explicit time zone")
    age = now.astimezone(timezone.utc) - e.captured_at.astimezone(timezone.utc)
    if age < timedelta(0) or age > max_age:
        return unknown("Evidence is stale or has a future timestamp")
    if e.restricted or e.http_status in (401, 403, 429):
        return unknown("Access restricted; stop website checks until manually reviewed")
    if e.timed_out or e.http_status != 200:
        return unknown("Availability request failed or was not observed")
    if e.adapter_validated is not True:
        return unknown("Live evidence reader has not been validated")
    if not isinstance(e.kind, Kind):
        return unknown("Unexpected evidence kind")
    if e.kind == Kind.SEAT_PANEL:
        if not isinstance(e.seat, Seat) or not e.seat.valid():
            return unknown("No complete selectable seat details")
        seat = e.seat
        reason = (f"Section {seat.section}, row {seat.row}, seat {seat.number}, "
                  f"£{seat.price_pence / 100:.2f}; seat panel offers Add to Basket. "
                  "Resale status and purchase are unconfirmed.")
        if e.selection_rejected:
            reason += " A selection attempt failed; this seat may already be held."
        return Observation(State.POSSIBLE, reason, opportunity_key=seat.key)
    if e.kind == Kind.SECTION_COUNTS:
        if not isinstance(e.section_counts, (tuple, list)) or not e.section_counts:
            return unknown("No section inventory supplied")
        sections = set()
        total = 0
        for entry in e.section_counts:
            if not isinstance(entry, (tuple, list)) or len(entry) != 2:
                return unknown("Invalid section inventory")
            section, count = entry
            if (not isinstance(section, str) or not re.fullmatch(r"[A-Za-z0-9]{1,6}", section)
                    or section.upper() in sections or type(count) is not int or count < 0):
                return unknown("Invalid section inventory")
            if count > 0:
                total += count
            sections.add(section.upper())
        if total > 0:
            positive = sorted(section.upper() for section, count in e.section_counts if count > 0)
            return Observation(State.POSSIBLE,
                               f"{total} places reported in sections {', '.join(positive)}; "
                               "ordinary tickets may be included; no individual resale seat verified.",
                               opportunity_key="sections:" + ",".join(positive))
        return unknown("Zero section counts do not prove resale inventory is empty")
    if e.kind == Kind.NO_SEATS:
        if e.seat is not None or e.section_counts or e.selection_rejected:
            return unknown("Conflicting positive and negative evidence")
        return Observation(State.UNAVAILABLE,
                           "Current successful availability view explicitly reports no seats; "
                           "this is a snapshot, not a permanent sold-out status")
    return unknown("A page, map, pricing or account response is not ticket evidence")


class AccessGuard:
    """Fail-closed circuit breaker for a FUTURE adapter. Does not issue requests.

    A restriction latches the guard closed. Waiting does not reopen it. Transient
    errors back off for at least five minutes; this is not a claimed safe site rate.
    A future runner must check allowed() BEFORE any website interaction, persist
    the restriction across restarts, and require explicit manual review to clear it.
    """
    def __init__(self):
        self.stopped = False
        self.failures = 0
        self.next_allowed = None

    def record(self, status: int | None, now: datetime, *, restricted=False):
        if now.tzinfo is None or now.utcoffset() is None:
            raise ValueError("Time zone required")
        now = now.astimezone(timezone.utc)
        if restricted or status in (401, 403, 429):
            self.stopped = True
        elif status != 200:
            self.failures += 1
            self.next_allowed = now + timedelta(minutes=min(60, 5 * 2 ** min(self.failures - 1, 4)))
        else:
            self.failures = 0
            # A successful unrelated response must never shorten an existing pause.

    def allowed(self, now: datetime) -> bool:
        if now.tzinfo is None or now.utcoffset() is None:
            raise ValueError("Time zone required")
        return (not self.stopped and
                (self.next_allowed is None or now.astimezone(timezone.utc) >= self.next_allowed))
