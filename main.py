import requests
from bs4 import BeautifulSoup
import time
import os

# Load from environment variables (Render or local)
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
CHAT_ID = os.getenv("CHAT_ID")

# Target URLs
EVENT_PAGE = "https://www.eticketing.co.uk/evertonfc/EDP/Event/Index/1205"
SOLD_OUT_REDIRECT = "https://www.eticketing.co.uk/evertonfc/EDP/Validation/EventNotAllowed?eventId=1205&reason=EventNoAvailableSalesModesOrSoldOut"
MAIN_EVENTS_PAGE = "https://www.eticketing.co.uk/evertonfc/EDP/Event"

# State tracking to avoid duplicate notifications
previously_available = False

def send_telegram_message(message):
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    payload = {"chat_id": CHAT_ID, "text": message}
    try:
        requests.post(url, data=payload)
    except Exception as e:
        print("Failed to send Telegram message:", e)

def tickets_are_available():
    try:
        # 1. Check for redirect (hard sold out state)
        r = requests.get(EVENT_PAGE, timeout=10, allow_redirects=True)
        if SOLD_OUT_REDIRECT in r.url:
            return False

        # 2. Check for overlay message (no seats available)
        soup = BeautifulSoup(r.text, "html.parser")
        page_text = soup.get_text(separator=" ").lower()
        if "no seats available" in page_text:
            return False

        # 3. Check main event list page for Sold Out label
        event_list_check = requests.get(MAIN_EVENTS_PAGE, timeout=10)
        if "sold out" in event_list_check.text.lower():
            return False

        # 4. Smarter ticket availability detection
        if "choose your seat" in page_text or "select your seat" in page_text:
            return True
        if "£" in page_text and "sold out" not in page_text:
            return True

        return False

    except Exception as e:
        print("Error checking tickets:", e)
        return False

def check_tickets():
    global previously_available
    available = tickets_are_available()

    if available and not previously_available:
        send_telegram_message(
            f"🎟 Everton v Brighton resale tickets may be available now!\n👉 {EVENT_PAGE}"
        )
        print("✅ Notification sent.")
    elif not available:
        print("❌ No tickets available.")
    else:
        print("🔁 Still available (no repeat alert sent).")

    previously_available = available

# Run every 60 seconds
while True:
    check_tickets()
    time.sleep(60)
