import os
import sys
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

LONDON = ZoneInfo("Europe/London")

EVENT_NAME = "everton vs liverpool"
MAIN_EVENTS_PAGE = "https://www.eticketing.co.uk/evertonfc/Events?preFilter=1&preFilterName=Home+Fixtures"
MATCH_LINK = "https://www.eticketing.co.uk/evertonfc/EDP/Event/Index/1280"

CHECK_EVERY_SECONDS = 30
HEARTBEAT_EVERY_MINUTES = 30
REALERT_EVERY_MINUTES = 2

# Only heartbeats are muted overnight
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


def liverpool_card_text() -> str | None:
    html = fetch(MAIN_EVENTS_PAGE)
    if not html:
        log("Main events page returned no HTML")
        return None

    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text(" ", strip=True).lower()

    idx = text.find(EVENT_NAME)
    if idx == -1:
        log("Could not find Everton vs Liverpool on fixtures page")
        return None

    # Grab only the nearby text around the Liverpool card
    window = text[idx:idx + 800]
    return window


def tickets_available() -> bool:
    card = liverpool_card_text()
    if not card:
        return False

    if "sold out" in card:
        log("Liverpool card says SOLD OUT")
        return False

    if "see availability" in card:
        log("Liverpool card says SEE AVAILABILITY")
        return True

    # Fallback: if it no longer says sold out but also doesn't clearly say see availability,
    # treat as unavailable rather than false alerting.
    log("Liverpool card unclear - treating as unavailable")
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
