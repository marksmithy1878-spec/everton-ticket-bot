import os
import sys
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

LONDON = ZoneInfo("Europe/London")

FIXTURES_PAGE = "https://www.eticketing.co.uk/evertonfc/Events?preFilter=1&preFilterName=Home+Fixtures"
MATCH_LINK = "https://www.eticketing.co.uk/evertonfc/EDP/Event/Index/1280"

CHECK_EVERY_SECONDS = 30
HEARTBEAT_EVERY_MINUTES = 30
REALERT_EVERY_MINUTES = 2

# Only heartbeats muted overnight
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


def fetch(url: str):
    for attempt in range(3):
        try:
            r = SESSION.get(url, timeout=15)
            return r.text
        except Exception as e:
            log(f"Fetch error {attempt + 1}/3 for {url}: {e}")
            time.sleep(1 + attempt)
    return None


def get_liverpool_card_status() -> str:
    """
    Returns:
    - 'sold_out'
    - 'see_availability'
    - 'unknown'
    - 'not_found'
    """

    html = fetch(FIXTURES_PAGE)
    if not html:
        log("Fixtures page returned no HTML")
        return "unknown"

    soup = BeautifulSoup(html, "lxml")

    # Flexible match: any text node containing both Everton and Liverpool
    match_text_node = soup.find(
        string=lambda s: s
        and "everton" in s.lower()
        and "liverpool" in s.lower()
    )

    if not match_text_node:
        log("Could not find Everton/Liverpool text on fixtures page")
        return "not_found"

    current = match_text_node.parent

    for _ in range(10):
        if current is None:
            break

        text = current.get_text(" ", strip=True).lower()

        # Keep this tight so we do not accidentally inspect other fixture cards
        if len(text) <= 1200:
            if "sold out" in text:
                log("Liverpool card says SOLD OUT")
                return "sold_out"

            if "see availability" in text:
                log("Liverpool card says SEE AVAILABILITY")
                return "see_availability"

        current = current.parent

    log("Found Liverpool fixture but could not isolate card status")
    return "unknown"


def tickets_available() -> bool:
    status = get_liverpool_card_status()

    if status == "sold_out":
        return False

    if status == "see_availability":
        return True

    return False


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
            f"🎟 Everton v Liverpool now shows SEE AVAILABILITY.\n👉 {MATCH_LINK}",
            force=True,
        )
        last_ticket_alert_sent = now
        return

    if now - last_ticket_alert_sent >= timedelta(minutes=REALERT_EVERY_MINUTES):
        telegram_send(
            f"🎟 Everton v Liverpool still shows SEE AVAILABILITY.\n👉 {MATCH_LINK}",
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
