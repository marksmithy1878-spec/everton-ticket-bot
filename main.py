import os
import sys
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

# ---------------- CONFIG ----------------
LONDON = ZoneInfo("Europe/London")

# Everton v Liverpool
EVENT_PAGE = "https://www.eticketing.co.uk/evertonfc/EDP/Event/Index/1280"
SEATMAP_PAGE = "https://www.eticketing.co.uk/evertonfc/EDP/Event/Index/1280?position=5#"
MAIN_EVENTS_PAGE = "https://www.eticketing.co.uk/evertonfc/Events?preFilter=1&preFilterName=Home+Fixtures"

CHECK_EVERY_SECONDS = 30
HEARTBEAT_EVERY_MINUTES = 30

# Quiet hours apply to HEARTBEATS only
HEARTBEAT_QUIET_START_HOUR = 0   # 00:00
HEARTBEAT_QUIET_END_HOUR = 6     # 06:00

TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
CHAT_ID = os.getenv("CHAT_ID")

# Optional: if you later find the hidden XHR availability URL, add it in Render
AVAILABILITY_URL = os.getenv("AVAILABILITY_URL", "").strip()

# --------------- HTTP SESSION ---------------
SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/135.0 Safari/537.36"
    ),
    "Accept-Language": "en-GB,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
})

# --------------- STATE ---------------
previously_available = False
last_heartbeat_sent = None


# --------------- HELPERS ---------------
def log(message: str) -> None:
    now = datetime.now(LONDON).strftime("%Y-%m-%d %H:%M:%S %Z")
    print(f"[{now}] {message}", flush=True)
    sys.stdout.flush()


def london_now() -> datetime:
    return datetime.now(LONDON)


def in_heartbeat_quiet_hours(now: datetime) -> bool:
    return HEARTBEAT_QUIET_START_HOUR <= now.hour < HEARTBEAT_QUIET_END_HOUR


def telegram_send(text: str, force: bool = False) -> None:
    """
    force=True bypasses quiet hours.
    Use force for startup + ticket alerts.
    Use force=False for heartbeats.
    """
    if not TELEGRAM_TOKEN or not CHAT_ID:
        log("Missing TELEGRAM_TOKEN or CHAT_ID")
        return

    now = london_now()

    if not force and in_heartbeat_quiet_hours(now):
        log(f"Heartbeat suppressed overnight: {text}")
        return

    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    payload = {"chat_id": CHAT_ID, "text": text}

    try:
        r = SESSION.post(url, data=payload, timeout=15)
        log(f"Telegram status {r.status_code}")
        if r.status_code != 200:
            log(f"Telegram response body: {r.text}")
    except Exception as e:
        log(f"Telegram send failed: {e}")


def fetch(url: str, referer: str | None = None, expect_json: bool = False):
    headers = {}
    if referer:
        headers["Referer"] = referer

    for attempt in range(3):
        try:
            r = SESSION.get(url, headers=headers, timeout=15, allow_redirects=True)
            if expect_json:
                return r.url, r.json()
            return r.url, r.text
        except Exception as e:
            log(f"Fetch error {attempt + 1}/3 for {url}: {e}")
            time.sleep(1 + attempt)

    return None, None


# --------------- AVAILABILITY LOGIC ---------------
def json_availability_check():
    """
    Optional best path if AVAILABILITY_URL is supplied.
    Returns True / False if conclusive, or None if not usable.
    """
    if not AVAILABILITY_URL:
        return None

    final_url, data = fetch(AVAILABILITY_URL, referer=EVENT_PAGE, expect_json=True)
    if data is None:
        return None

    try:
        # Common dict shapes
        if isinstance(data, dict):
            for key in ("available", "isAvailable"):
                if key in data:
                    return bool(data[key])

            for key in ("count", "itemsCount", "availableCount", "seatCount", "tickets"):
                if key in data:
                    value = data[key]
                    if isinstance(value, (int, float)):
                        return value > 0
                    if isinstance(value, list):
                        return len(value) > 0

        # Top-level list
        if isinstance(data, list):
            return len(data) > 0

    except Exception as e:
        log(f"JSON availability parse failed: {e}")

    return None


def html_availability_check() -> bool:
    """
    Fallback HTML logic:
    1. If event page redirects to EventNotAllowed -> unavailable
    2. If event/seat page says 'no seats available' -> unavailable
    3. If seat page says 'no longer available' -> unavailable (ghost)
    4. If seat page shows price + section/seat hints -> available
    """
    final_url, html = fetch(EVENT_PAGE)
    if not html:
        log("Event page returned no HTML")
        return False

    if final_url and "EventNotAllowed" in final_url:
        log("Redirected to EventNotAllowed")
        return False

    soup = BeautifulSoup(html, "lxml")
    event_text = soup.get_text(" ").lower()

    if "this event currently has no seats available" in event_text:
        log("Event page says no seats available")
        return False

    # Seat-map page is often the real source of useful signals
    _, seat_html = fetch(SEATMAP_PAGE, referer=EVENT_PAGE)
    if not seat_html:
        log("Seatmap page returned no HTML")
        return False

    seat_soup = BeautifulSoup(seat_html, "lxml")
    seat_text = seat_soup.get_text(" ").lower()

    if "this event currently has no seats available" in seat_text:
        log("Seat page says no seats available")
        return False

    if "no longer available" in seat_text:
        log("Ghost-seat wording found")
        return False

    has_price = ("£" in seat_html) or ("gbp" in seat_text)
    has_section_hint = (
        "section overview" in seat_text
        or "compare seats" in seat_text
        or "section" in seat_text
    )
    has_links = any(a.get("href") for a in seat_soup.find_all("a", href=True))

    if has_price and (has_section_hint or has_links):
        log("Positive seat-map signals found")
        return True

    log("No positive seat-map signals found")
    return False


def tickets_available() -> bool:
    # Best route first if supplied
    json_result = json_availability_check()
    if json_result is not None:
        log(f"JSON availability result: {json_result}")
        return json_result

    # Fallback to HTML checks
    return html_availability_check()


# --------------- HEARTBEAT ---------------
def maybe_send_heartbeat() -> None:
    global last_heartbeat_sent

    now = london_now()

    if last_heartbeat_sent is None:
        last_heartbeat_sent = now
        return

    if now - last_heartbeat_sent >= timedelta(minutes=HEARTBEAT_EVERY_MINUTES):
        telegram_send(
            f"✅ Everton v Liverpool bot heartbeat @ {now.strftime('%Y-%m-%d %H:%M:%S %Z')}",
            force=False,
        )
        last_heartbeat_sent = now


# --------------- MAIN LOOP ---------------
def main() -> None:
    global previously_available, last_heartbeat_sent

    log("SCRIPT STARTED")
    start_time = london_now()

    telegram_send(
        f"🤖 Everton v Liverpool bot started @ {start_time.strftime('%Y-%m-%d %H:%M:%S %Z')}",
        force=True,
    )
    last_heartbeat_sent = start_time

    while True:
        try:
            log("LOOP RUNNING")
            available = tickets_available()

            if available and not previously_available:
                telegram_send(
                    f"🎟 Everton v Liverpool resale ticket may be available now!\n👉 {SEATMAP_PAGE}",
                    force=True,
                )
                log("Availability flipped to TRUE")

            elif not available and previously_available:
                log("Availability flipped to FALSE")

            else:
                log(f"No change. Available = {available}")

            previously_available = available
            maybe_send_heartbeat()

        except Exception as e:
            log(f"Main loop error: {e}")

        time.sleep(CHECK_EVERY_SECONDS)


if __name__ == "__main__":
    main()
