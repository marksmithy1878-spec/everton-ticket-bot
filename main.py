import requests
from bs4 import BeautifulSoup
import time
import os

TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
CHAT_ID = os.getenv("CHAT_ID")

EVENT_PAGE = "https://www.eticketing.co.uk/evertonfc/EDP/Event/Index/1205"
SOLD_OUT_REDIRECT = "https://www.eticketing.co.uk/evertonfc/EDP/Validation/EventNotAllowed?eventId=1205&reason=EventNoAvailableSalesModesOrSoldOut"
MAIN_EVENTS_PAGE = "https://www.eticketing.co.uk/evertonfc/EDP/Event"

previously_available = False

def send_telegram_message(message):
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    payload = {"chat_id": CHAT_ID, "text": message}
    try:
        requests.post(url, data=payload)
    except Exception as e:
        print("Failed to send Telegram message:", e)

def tickets_are_available():
    """Returns True if purchasable tickets are likely available, False otherwise."""
    try:
        # 1. Fetch event page
        r = requests.get(EVENT_PAGE, timeout=10, allow_redirects=True)

        # 2. Redirect = sold out
        if SOLD_OUT_REDIRECT in r.url:
            return False

        soup = BeautifulSoup(r.text, "html.parser")
        page_text = soup.get_text(separator=" ").lower()

        # 3. Overlay message = sold out
        if "no seats available" in page_text:
            return False

        # 4. Check main events page for Sold Out flag
        list_check = requests.get(MAIN_EVENTS_PAGE, timeout=10)
        if "sold out" in list_check.text.lower():
            return False

        # 5. Ghost ticket filter:
        # Look for actual sections/prices and ensure they're not marked unavailable
        # Many eticketing systems wrap active prices in <span> or <a> tags
        price_elements = soup.find_all(string=lambda text: "£" in text)
        section_links = soup.find_all("a", href=True)

        # Filter: must have price and section link (indicating selectable seat)
        if price_elements and section_links:
            # Extra filter: ignore links with disabled/unavailable markers
            if not any("unavailable" in link.get("class", []) for link in section_links):
                return True

        return False

    except Exception as e:
        print("Error checking tickets:", e)
        return False

def check_tickets():
    global previously_available
    available = tickets_are_available()

    if available and not previously_available:
        send_telegram_message(f"🎟 Everton v Brighton resale tickets are AVAILABLE!\n👉 {EVENT_PAGE}")
        print("Alert sent: tickets available.")
    elif not available:
        print("No tickets available.")

    previously_available = available

# Run every 60 seconds
while True:
    check_tickets()
    time.sleep(60)
