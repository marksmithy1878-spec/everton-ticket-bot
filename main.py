import os
import sys
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

LONDON = ZoneInfo("Europe/London")

EVENT_NAME = "everton vs liverpool"
EVENT_PAGE = "https://www.eticketing.co.uk/evertonfc/EDP/Event/Index/1280"
SEATMAP_PAGE = "https://www.eticketing.co.uk/evertonfc/EDP/Event/Index/1280?position=5#"
MAIN_EVENTS_PAGE = "https://www.eticketing.co.uk/evertonfc/Events?preFilter=1&preFilterName=Home+Fixtures"

CHECK_EVERY_SECONDS = 30
HEARTBEAT_EVERY_MINUTES = 30
REALERT_EVERY_MINUTES = 2

# Heartbeats only muted overnight
HEARTBEAT_QUIET_START_HOUR = 0
HEARTBEAT_QUIET_END_HOUR = 6

TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
CHAT_ID = os.getenv("CHAT_ID")

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

previously_available = False
last_heartbeat_sent = None
last_ticket_alert_sent = None


def log(message: str) -> None:
    now = datetime.now(LONDON).strftime("%Y-%m-%d %H:%M:%S %Z")
    print(f"[{now}] {message}", flush=True)
    sys.stdout.flush()


def london_now() -> datetime:
    return datetime.now(LONDON)


def in_heartbeat_quiet_hours(now: datetime) -> bool:
    return HEARTBEAT_QUIET_START_HOUR <= now.hour < HEARTBEAT_QUIET_END_HOUR


def telegram_send(text: str, force: bool = False) -> None:
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


def fetch(url: str, referer: str | None = None):
    headers = {}
    if referer:
        headers["Referer"] = referer

    for attempt in range(3):
        try:
            r = SESSION.get(url, headers=headers, timeout=15, allow_redirects=True)
            return r.url, r.text
        except Exception as e:
            log(f"Fetch error {attempt + 1}/3 for {url}: {e}")
            time.sleep(1 + attempt)

    return None, None


def main_page_says_sold_out() -> bool:
    """
    Checks the MAIN_EVENTS_PAGE specifically for the Everton vs Liverpool card.
    If that card says SOLD OUT, treat the match as unavailable.
    """
    _, html = fetch(MAIN_EVENTS_PAGE)
    if not html:
        log("Main events page returned no HTML")
        return False

    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text(" ", strip=True).lower()

    idx = text.find(EVENT_NAME)
    if idx == -1:
        log("Could not find Everton vs Liverpool on main events page")
        return False

    window = text[idx:idx + 500]

    if "sold out" in window:
        log("Main events page says SOLD OUT for Everton vs Liverpool")
        return True

    log("Main events page does not say SOLD OUT for Everton vs Liverpool")
    return False


def page_indicates_unavailable(text: str, final_url: str | None) -> bool:
    lower = text.lower()

    if final_url and "EventNotAllowed" in final_url:
        return True

    unavailable_phrases = [
        "this event currently has no seats available",
        "no seats available",
        "sold out",
        "no longer available",
        "eventnotallowed",
        "eventnoavailablesalesmodesorsoldout",
    ]

    return any(phrase in lower for phrase in unavailable_phrases)


def tickets_available() -> bool:
    # Strongest signal first: main fixtures page
    if main_page_says_sold_out():
        return False

    # Event page
    event_final_url, event_html = fetch(EVENT_PAGE)
    if not event_html:
        log("Event page returned no HTML")
        return False

    event_soup = BeautifulSoup(event_html, "lxml")
    event_text = event_soup.get_text(" ", strip=True)

    if page_indicates_unavailable(event_text, event_final_url):
        log("Event page indicates unavailable")
        return False

    # Seat map page
    seat_final_url, seat_html = fetch(SEATMAP_PAGE, referer=EVENT_PAGE)
    if not seat_html:
        log("Seat map page returned no HTML")
        return False

    seat_soup = BeautifulSoup(seat_html, "lxml")
    seat_text = seat_soup.get_text(" ", strip=True)

    if page_indicates_unavailable(seat_text, seat_final_url):
        log("Seat map page indicates unavailable")
        return False

    log("Seat map accessible and no unavailable wording found — treating as AVAILABLE")
    return True


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


def maybe_send_ticket_alert() -> None:
    global last_ticket_alert_sent

    now = london_now()

    if last_ticket_alert_sent is None:
        telegram_send(
            f"🎟 Everton v Liverpool resale ticket may be available now!\n👉 {SEATMAP_PAGE}",
            force=True,
        )
        last_ticket_alert_sent = now
        return

    if now - last_ticket_alert_sent >= timedelta(minutes=REALERT_EVERY_MINUTES):
        telegram_send(
            f"🎟 Everton v Liverpool resale still appears available!\n👉 {SEATMAP_PAGE}",
            force=True,
        )
        last_ticket_alert_sent = now


def main() -> None:
    global previously_available, last_heartbeat_sent, last_ticket_alert_sent

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

            if available:
                maybe_send_ticket_alert()
                if not previously_available:
                    log("Availability flipped to TRUE")
                else:
                    log("Still available")
            else:
                if previously_available:
                    log("Availability flipped to FALSE")
                else:
                    log("No change. Available = False")
                last_ticket_alert_sent = None

            previously_available = available
            maybe_send_heartbeat()

        except Exception as e:
            log(f"Main loop error: {e}")

        time.sleep(CHECK_EVERY_SECONDS)


if __name__ == "__main__":
    main()
