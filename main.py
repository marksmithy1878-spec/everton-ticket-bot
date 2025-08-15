import os
import time
from datetime import datetime, timedelta
import json
import pytz
import requests
from bs4 import BeautifulSoup

# ----------------- Config -----------------
EVENT_PAGE = "https://www.eticketing.co.uk/evertonfc/EDP/Event/Index/1205"
SEATMAP_PAGE = "https://www.eticketing.co.uk/evertonfc/EDP/Event/Index/1205?position=1#"
SOLD_OUT_REDIRECT = (
    "https://www.eticketing.co.uk/evertonfc/EDP/Validation/"
    "EventNotAllowed?eventId=1205&reason=EventNoAvailableSalesModesOrSoldOut"
)
MAIN_EVENTS_PAGE = "https://www.eticketing.co.uk/evertonfc/EDP/Event"

# How often?
CHECK_EVERY_SEC = 30            # tighten for resale bursts
HEARTBEAT_EVERY_SEC = 300       # 5 minutes

# Quiet hours (London). Messages (including availability) are suppressed in this window.
QUIET_START = (0, 0)            # 00:00
QUIET_END   = (6, 0)            # 06:00

# Telegram
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
CHAT_ID = os.getenv("CHAT_ID")

# Optional: a direct JSON/XHR endpoint that reports availability
# Paste from DevTools (Network) when you catch one. If not set, we fall back to HTML.
AVAILABILITY_URL = os.getenv("AVAILABILITY_URL", "").strip()

# HTTP session with sane headers
SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (EvertonTicketBot)",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-GB,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
})

# State
previously_available = False
last_heartbeat = None


# ----------------- Time helpers -----------------
def now_london():
    return datetime.now(pytz.timezone("Europe/London"))

def in_quiet_hours(ts: datetime) -> bool:
    start = ts.replace(hour=QUIET_START[0], minute=QUIET_START[1], second=0, microsecond=0)
    end   = ts.replace(hour=QUIET_END[0],   minute=QUIET_END[1],   second=0, microsecond=0)
    if start <= end:
        return start <= ts < end
    # window crosses midnight
    return ts >= start or ts < end


# ----------------- Telegram -----------------
def send_telegram(text: str, force: bool = False):
    ts = now_london()
    if in_quiet_hours(ts) and not force:
        print(f"[{ts:%Y-%m-%d %H:%M:%S %Z}] Quiet hours: suppressed: {text}")
        return
    if not TELEGRAM_TOKEN or not CHAT_ID:
        print("Missing TELEGRAM_TOKEN or CHAT_ID")
        return
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
        SESSION.post(url, data={"chat_id": CHAT_ID, "text": text}, timeout=10)
    except Exception as e:
        print("Telegram error:", e)


# ----------------- Fetch helpers -----------------
def get(url, referer=None, timeout=12, expect_json=False):
    for attempt in range(3):
        try:
            headers = {}
            if referer:
                headers["Referer"] = referer
            r = SESSION.get(url, headers=headers, timeout=timeout, allow_redirects=True)
            if expect_json:
                return r.url, r.json()
            return r.url, r.text
        except Exception as e:
            print(f"GET error {attempt+1}/3 for {url}: {e}")
            time.sleep(1 + attempt)
    return None, None


# ----------------- Availability checks -----------------
def json_availability() -> bool | None:
    """
    If AVAILABILITY_URL is provided and returns JSON indicating availability,
    return True/False. If we can't decide from JSON, return None to fall back.
    """
    if not AVAILABILITY_URL:
        return None
    final_url, data = get(AVAILABILITY_URL, referer=EVENT_PAGE, expect_json=True)
    if data is None:
        return None
    # Try to interpret common shapes
    try:
        # Case 1: {"available": true/false}
        if isinstance(data, dict) and "available" in data:
            return bool(data["available"])
        # Case 2: {"count": 0/1/...} or {"itemsCount": ...}
        for key in ("count", "itemsCount", "availableCount", "seats", "tickets"):
            if key in data:
                val = data[key]
                if isinstance(val, (int, float)):
                    return val > 0
                # sometimes it's a list of items
                if isinstance(val, (list, tuple)):
                    return len(val) > 0
        # Case 3: top-level list of items
        if isinstance(data, (list, tuple)):
            return len(data) > 0
    except Exception as e:
        print("JSON parse hint failed:", e)
    # Unknown JSON shape; don’t break, just fall back
    return None


def html_availability() -> bool:
    """
    Heuristic HTML path:
    - Negatives: sold-out redirect, 'no seats available' modal, main list 'Sold Out'.
    - Positives: seat-map page shows prices/sections without 'no longer available'.
    """
    # Pull event page to set cookies + detect redirect/modal
    final_url, html = get(EVENT_PAGE)
    if not html:
        return False

    if final_url and SOLD_OUT_REDIRECT in final_url:
        return False

    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text(" ").lower()

    if "this event currently has no seats available" in text:
        return False

    # List page “Sold Out” (strong negative)
    _, list_html = get(MAIN_EVENTS_PAGE, referer=EVENT_PAGE)
    if list_html and "sold out" in list_html.lower():
        return False

    # Now load the seat-map view which usually exposes sections/prices in the side panel
    _, seat_html = get(SEATMAP_PAGE, referer=EVENT_PAGE)
    if not seat_html:
        return False

    seat_soup = BeautifulSoup(seat_html, "lxml")
    seat_text = seat_soup.get_text(" ").lower()

    # Positive signals
    has_price_symbol = ("£" in seat_html) or ("gbp" in seat_text)
    looks_like_seatmap = ("section overview" in seat_text) or ("compare seats" in seat_text)
    has_section_links = any(a.get("href") for a in seat_soup.find_all("a", href=True))

    # Anti-ghost: if the UI already says “no longer available”, treat as false.
    if "no longer available" in seat_text:
        return False

    # Sometimes the modal appears over the seat map too
    if "this event currently has no seats available" in seat_text:
        return False

    # If we see price + seat/section hints (and no ghost), call it available
    return bool(has_price_symbol and (looks_like_seatmap or has_section_links))


def tickets_are_available() -> bool:
    # Priority 1: JSON/XHR if provided and conclusive
    j = json_availability()
    if j is not None:
        return j
    # Fallback: HTML heuristics
    return html_availability()


# ----------------- Main loop -----------------
def main():
    global previously_available, last_heartbeat

    send_telegram("🤖 Bot started and monitoring ticket availability…", force=True)
    last_heartbeat = now_london()

    while True:
        ts = now_london()
        try:
            available = tickets_are_available()
        except Exception as e:
            print(f"[{ts:%Y-%m-%d %H:%M:%S %Z}] check error: {e}")
            available = False

        if available and not previously_available:
            send_telegram(f"🎟 Everton v Brighton resale tickets are AVAILABLE!\n👉 {EVENT_PAGE}")
            print(f"[{ts:%Y-%m-%d %H:%M:%S %Z}] Availability flipped: TRUE")

        if not available and previously_available:
            # Optional “gone” notice
            send_telegram("❌ Tickets no longer available.")
            print(f"[{ts:%Y-%m-%d %H:%M:%S %Z}] Availability flipped: FALSE")

        previously_available = available

        # Heartbeat
        if (ts - last_heartbeat) >= timedelta(seconds=HEARTBEAT_EVERY_SEC):
            send_telegram(f"✅ Bot heartbeat: still running @ {ts.strftime('%Y-%m-%d %H:%M:%S %Z')}")
            last_heartbeat = ts

        time.sleep(CHECK_EVERY_SEC)


if __name__ == "__main__":
    main()
