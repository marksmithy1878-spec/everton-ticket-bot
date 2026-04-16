import os
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

# ---------- CONFIG ----------
LONDON = ZoneInfo("Europe/London")

# Everton v Liverpool, Sun 19 April 2026
EVENT_PAGE = "https://www.eticketing.co.uk/evertonfc/EDP/Event/Index/1280"
SEATMAP_PAGE = "https://www.eticketing.co.uk/evertonfc/EDP/Event/Index/1280?position=5#"
MAIN_EVENTS_PAGE = "https://www.eticketing.co.uk/evertonfc/Events?preFilter=1&preFilterName=Home+Fixtures"

CHECK_EVERY_SECONDS = 30
HEARTBEAT_EVERY_MINUTES = 30

# Quiet hours for heartbeat only.
# Ticket alerts will STILL send overnight so you do not miss resale drops.
HEARTBEAT_QUIET_START_HOUR = 0
HEARTBEAT_QUIET_END_HOUR = 6

TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
CHAT_ID = os.getenv("CHAT_ID")

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36",
    "Accept-Language": "en-GB,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
})

previously_available = False
last_heartbeat_sent = None


def london_now() -> datetime:
    return datetime.now(LONDON)


def in_heartbeat_quiet_hours(now: datetime) -> bool:
    return HEARTBEAT_QUIET_START_HOUR <= now.hour < HEARTBEAT_QUIET_END_HOUR


def telegram_send(text: str, force: bool = False) -> None:
    if not TELEGRAM_TOKEN or not CHAT_ID:
        print("Missing TELEGRAM_TOKEN or CHAT_ID")
        return

    now = london_now()
    # Only suppress heartbeats overnight, not ticket alerts
    if not force and in_heartbeat_quiet_hours(now) and text.startswith("✅"):
        print(f"[{now:%Y-%m-%d %H:%M:%S %Z}] Heartbeat suppressed overnight")
        return

    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    payload = {"chat_id": CHAT_ID, "text": text}
    try:
        r = SESSION.post(url, data=payload, timeout=15)
        print(f"[{now:%Y-%m-%d %H:%M:%S %Z}] Telegram status {r.status_code}")
    except Exception as e:
        print(f"[{now:%Y-%m-%d %H:%M:%S %Z}] Telegram send failed: {e}")


def fetch(url: str, referer: str | None = None):
    headers = {}
    if referer:
        headers["Referer"] = referer

    for attempt in range(3):
        try:
            r = SESSION.get(url, headers=headers, timeout=15, allow_redirects=True)
            return r.url, r.text
        except Exception as e:
            print(f"[{london_now():%Y-%m-%d %H:%M:%S %Z}] Fetch error {attempt + 1}/3 for {url}: {e}")
            time.sleep(1 + attempt)

    return None, None


def tickets_available() -> bool:
    """
    Logic:
    1. If event page redirects to EventNotAllowed -> unavailable
    2. If event or seat page says 'no seats available' -> unavailable
    3. If seat page shows price + seat/section hints and no ghost wording -> available
    """
    final_url, html = fetch(EVENT_PAGE)
    if not html:
        return False

    if final_url and "EventNotAllowed" in final_url:
        print(f"[{london_now():%Y-%m-%d %H:%M:%S %Z}] Redirected to EventNotAllowed")
        return False

    soup = BeautifulSoup(html, "lxml")
    page_text = soup.get_text(" ").lower()

    if "this event currently has no seats available" in page_text:
        print(f"[{london_now():%Y-%m-%d %H:%M:%S %Z}] Event page says no seats available")
        return False

    # Check seatmap page as this is often where availability shows up first
    _, seat_html = fetch(SEATMAP_PAGE, referer=EVENT_PAGE)
    if not seat_html:
        return False

    seat_soup = BeautifulSoup(seat_html, "lxml")
    seat_text = seat_soup.get_text(" ").lower()

    if "this event currently has no seats available" in seat_text:
        print(f"[{london_now():%Y-%m-%d %H:%M:%S %Z}] Seat page says no seats available")
        return False

    if "no longer available" in seat_text:
        print(f"[{london_now():%Y-%m-%d %H:%M:%S %Z}] Ghost-seat wording found")
        return False

    has_price = ("£" in seat_html) or ("gbp" in seat_text)
    has_section_hint = (
        "section overview" in seat_text
        or "compare seats" in seat_text
        or "section" in seat_text
    )
    has_links = any(a.get("href") for a in seat_soup.find_all("a", href=True))

    if has_price and (has_section_hint or has_links):
        print(f"[{london_now():%Y-%m-%d %H:%M:%S %Z}] Positive seat-map signals found")
        return True

    print(f"[{london_now():%Y-%m-%d %H:%M:%S %Z}] No positive seat-map signals found")
    return False


def maybe_send_heartbeat() -> None:
    global last_heartbeat_sent

    now = london_now()
    if last_heartbeat_sent is None:
        last_heartbeat_sent = now
        return

    if now - last_heartbeat_sent >= timedelta(minutes=HEARTBEAT_EVERY_MINUTES):
        telegram_send(f"✅ Everton v Liverpool bot heartbeat @ {now.strftime('%Y-%m-%d %H:%M:%S %Z')}")
        last_heartbeat_sent = now


def main() -> None:
    global previously_available, last_heartbeat_sent

    start_time = london_now()
    print(f"[{start_time:%Y-%m-%d %H:%M:%S %Z}] Bot started")
    telegram_send(
        f"🤖 Everton v Liverpool bot started @ {start_time.strftime('%Y-%m-%d %H:%M:%S %Z')}",
        force=True,
    )
    last_heartbeat_sent = start_time

    while True:
        now = london_now()
        try:
            available = tickets_available()

            if available and not previously_available:
                telegram_send(
                    f"🎟 Everton v Liverpool resale ticket may be available now!\n👉 {SEATMAP_PAGE}",
                    force=True,
                )
                print(f"[{now:%Y-%m-%d %H:%M:%S %Z}] Availability flipped to TRUE")

            elif not available and previously_available:
                print(f"[{now:%Y-%m-%d %H:%M:%S %Z}] Availability flipped to FALSE")

            else:
                print(f"[{now:%Y-%m-%d %H:%M:%S %Z}] No change. Available = {available}")

            previously_available = available
            maybe_send_heartbeat()

        except Exception as e:
            print(f"[{now:%Y-%m-%d %H:%M:%S %Z}] Main loop error: {e}")

        time.sleep(CHECK_EVERY_SECONDS)


if __name__ == "__main__":
    main()
