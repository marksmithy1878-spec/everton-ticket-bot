import os
import sys
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import requests

LONDON = ZoneInfo("Europe/London")

AREA_AVAILABILITY_URL = (
    "https://www.eticketing.co.uk/evertonfc/EDP/Ism/AreaAvailability"
    "?excludeTxSeats=False"
    "&excludePtxSeats=True"
    "&eventId=1280"
    "&includeAtxSeats=false"
    "&showHospitality=false"
)

MATCH_LINK = "https://www.eticketing.co.uk/evertonfc/EDP/Event/Index/1280?position=5#"

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
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-GB,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Referer": "https://www.eticketing.co.uk/evertonfc/EDP/Event/Index/1280",
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


def fetch_area_availability():
    for attempt in range(3):
        try:
            r = SESSION.get(AREA_AVAILABILITY_URL, timeout=15)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            log(f"AreaAvailability fetch error {attempt + 1}/3: {e}")
            time.sleep(1 + attempt)

    return None


def total_available_seats() -> int:
    data = fetch_area_availability()
    if data is None:
        log("AreaAvailability returned no data")
        return 0

    if not isinstance(data, list):
        log(f"Unexpected AreaAvailability format: {type(data)}")
        return 0

    total = 0

    for area in data:
        try:
            total += int(area.get("AvailableSeats", 0))
        except Exception:
            pass

    log(f"Total AvailableSeats = {total}")
    return total


def seats_available() -> bool:
    total = total_available_seats()
    return total > 0


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


def maybe_send_ticket_alert(total: int) -> None:
    global last_ticket_alert_sent

    now = london_now()

    if last_ticket_alert_sent is None:
        telegram_send(
            f"🎟 Everton v Liverpool seats available now! Total AvailableSeats = {total}\n👉 {MATCH_LINK}",
            force=True,
        )
        last_ticket_alert_sent = now
        return

    if now - last_ticket_alert_sent >= timedelta(minutes=REALERT_EVERY_MINUTES):
        telegram_send(
            f"🎟 Everton v Liverpool still has seats available. Total AvailableSeats = {total}\n👉 {MATCH_LINK}",
            force=True,
        )
        last_ticket_alert_sent = now


def main() -> None:
    global previously_available, last_heartbeat_sent, last_ticket_alert_sent

    log("SCRIPT STARTED")
    start_time = london_now()

    telegram_send(
        f"🤖 Everton v Liverpool availability bot started @ {start_time.strftime('%Y-%m-%d %H:%M:%S %Z')}",
        force=True,
    )
    last_heartbeat_sent = start_time

    while True:
        try:
            log("LOOP RUNNING")
            total = total_available_seats()
            available = total > 0

            if available:
                maybe_send_ticket_alert(total)
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
