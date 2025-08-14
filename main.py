import requests
from bs4 import BeautifulSoup
import time
import os
from datetime import datetime

TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
CHAT_ID = os.getenv("CHAT_ID")

EVENT_PAGE = "https://www.eticketing.co.uk/evertonfc/EDP/Event/Index/1205"
SOLD_OUT_REDIRECT = "https://www.eticketing.co.uk/evertonfc/EDP/Validation/EventNotAllowed?eventId=1205&reason=EventNoAvailableSalesModesOrSoldOut"
MAIN_EVENTS_PAGE = "https://www.eticketing.co.uk/evertonfc/EDP/Event"

previously_available = False
last_heartbeat_sent = None

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
        r = requests.get(EVENT_PAGE, timeout=10, allow_redirects=True)
        if SOLD_OUT_REDIRECT in r.url:
            print("[Check] Redirected to sold out page.")
            return False

        soup = BeautifulSoup(r.text, "html.parser")
        page_text = soup.get_text(separator=" ").lower()

        if "no seats available" in page_text or "sold out" in page_text:
            print("[Check] Page text says 'no seats available' or 'sold out'.")
            return False

        # Main events page check
        list_check = requests.get(MAIN_EVENTS_PAGE, timeout=10)
        if "sold out" in list_check.text.lower():
            print("[Check] Main event listing says 'sold out'.")
            return False

        # Ghost filter – are any actual tickets selectable?
        price_elements = soup.find_all(string=lambda text: "£" in text)
        section_links = soup.find_all("a", href=True)

        # Log number of prices and links found
        print(f"[Debug] Found {len(price_elements)} price elements and {len(section_links)} links.")

        if price_elements and section_links:
            valid_links = [
                link for link in section_links
                if not any(term in str(link.get("class", "")).lower() for term in ["unavailable", "disabled"])
            ]
            print(f"[Debug] Found {len(valid_links)} usable links.")
            if valid_links:
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
        print("✅ Alert sent: tickets available.")
    elif not available:
        print("No tickets available.")

    previously_available = available

def send_daily_heartbeat():
    global last_heartbeat_sent
    now = datetime.now()
    if now.hour == 9 and (last_heartbeat_sent is None or last_heartbeat_sent.date() != now.date()):
        send_telegram_message("👋 Bot is still running. No resale tickets found yet.")
        last_heartbeat_sent = now

# Continuous loop
while True:
    send_daily_heartbeat()
    check_tickets()
    time.sleep(60)
