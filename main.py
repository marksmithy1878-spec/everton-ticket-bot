import os
import time
from datetime import datetime, timedelta
import pytz
import requests
from bs4 import BeautifulSoup

# ----------------- Config -----------------
EVENT_PAGE = "https://www.eticketing.co.uk/evertonfc/EDP/Event/Index/1205"
SOLD_OUT_REDIRECT = (
    "https://www.eticketing.co.uk/evertonfc/EDP/Validation/"
    "EventNotAllowed?eventId=1205&reason=EventNoAvailableSalesModesOrSoldOut"
)
MAIN_EVENTS_PAGE = "https://www.eticketing.co.uk/evertonfc/EDP/Event"

CHECK_EVERY_SEC = 60           # frequency of checks
HEARTBEAT_EVERY_SEC = 300      # heartbeat to Telegram
QUIET_START = (0, 0)           # 00:00 local
QUIET_END   = (6, 0)           # 06:00 local (no messages in this window)

# Telegram creds from environment
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
CHAT_ID = os.getenv("CHAT_ID")

# HTTP session
SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (EvertonTicketBot; +https://eticketing.co.uk)"
})

# State
previously_available = False
last_heartbeat = None


# ----------------- Helpers -----------------
def now_london():
    return datetime.now(pytz.timezone("Europe/London"))


def in_quiet_hours(ts: datetime) -> bool:
    start = ts.replace(hour=QUIET_START[0], minute=QUIET_START[1],
                       second=0, microsecond=0)
    end = ts.replace(hour=QUIET_END[0], minute=QUIET_END[1],
                     second=0, microsecond=0)
    # window could cross midnight (it does here)
    if start <= end:
        return start <= ts < end
    return ts >= start or ts < end


def send_telegram(text: str, force: bool = False):
    """Send a Telegram message unless we are in quiet hours (unless forced)."""
    ts = now_london()
    if in_quiet_hours(ts) and not force:
        print(f"[{ts.isoformat()}] Quiet hours: suppressed message: {text}")
        return
    if not TELEGRAM_TOKEN or not CHAT_ID:
        print("Missing TELEGRAM_TOKEN or CHAT_ID; cannot send Telegram message.")
        return
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
        SESSION.post(url, data={"chat_id": CHAT_ID, "text": text}, timeout=10)
    except Exception as e:
        print("Failed to send Telegram message:", e)


def page_text(url: str):
    """GET a page and return (final_url, text) with basic retries."""
    for attempt in range(3):
        try:
            r = SESSION.get(url, timeout=12, allow_redirects=True)
            return r.url, r.text
        except Exception as e:
            print(f"Fetch error ({attempt+1}/3) for {url}: {e}")
            time.sleep(1 + attempt)
    return None, ""


def tickets_are_available() -> bool:
    """
    Heuristics for availability:
    - Redirect to SOLD_OUT_REDIRECT  => False
    - Modal 'no seats available' on event page  => False
    - Main events page shows 'Sold Out' for Brighton  => False
    - Otherwise: look for indicative seat/pricing/section hints  => True
    """
    # 1) Event page
    final_url, html = page_text(EVENT_PAGE)
    if not html:
        return False

    if final_url and SOLD_OUT_REDIRECT in final_url:
        return False

    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(" ").lower()

    # site’s sold-out modal
    if "this event currently has no seats available" in text:
        return False

    # 2) List page quick check
    _, list_html = page_text(MAIN_EVENTS_PAGE)
    if "sold out" in (list_html or "").lower():
        # list page sometimes lags; treat as strong negative
        return False

    # 3) Positive signals on the event UI (heuristics)
    # Look for £ prices and the right column “Section Overview” list items etc.
    has_price_symbol = "£" in html or "gbp" in text
    looks_like_seatmap = ("section overview" in text) or ("compare seats" in text)
    # When there are selectable seats the DOM usually includes anchor tags around sections
    has_section_links = any(a.get("href") for a in soup.find_all("a", href=True))

    # If there’s price + seat/section hints, assume availability.
    if has_price_symbol and (looks_like_seatmap or has_section_links):
        # Try to ignore obvious ghost tickets by scanning for “no longer available”
        if "no longer available" not in text:
            return True

    return False


# ----------------- Main loop -----------------
def main():
    global previously_available, last_heartbeat

    # Start notice (forced: may be during quiet hours but useful on deploy)
    send_telegram("🤖 Bot started and monitoring ticket availability…", force=True)
    last_heartbeat = now_london()

    while True:
        ts = now_london()

        try:
            available = tickets_are_available()
        except Exception as e:
            print(f"[{ts.isoformat()}] check error: {e}")
            available = False

        if available and not previously_available:
            send_telegram(f"🎟 Everton v Brighton resale tickets are AVAILABLE!\n👉 {EVENT_PAGE}")
            print(f"[{ts.isoformat()}] Alert sent.")
        elif not available and previously_available:
            # Optional: notify when they go away (kept quiet-hour aware)
            send_telegram("❌ Tickets no longer available.")
            print(f"[{ts.isoformat()}] Availability ended.")

        previously_available = available

        # Heartbeat
        if (ts - last_heartbeat) >= timedelta(seconds=HEARTBEAT_EVERY_SEC):
            send_telegram(f"✅ Bot heartbeat: still running @ {ts.strftime('%Y-%m-%d %H:%M:%S %Z')}")
            last_heartbeat = ts

        time.sleep(CHECK_EVERY_SEC)


if __name__ == "__main__":
    main()
