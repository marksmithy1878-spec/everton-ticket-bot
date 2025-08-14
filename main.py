import requests
from bs4 import BeautifulSoup
import time
import os
import datetime

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
        response = requests.post(url, data=payload)
        print(f"[Telegram] Status: {response.status_code} | Message: {message}")
    except Exception as e:
        print("[ERROR] Failed to send Telegram message:", e)

def tickets_are_available():
    try:
        # 1. Fetch event page
        r = requests.get(EVENT_PAGE, timeout=10, allow_redirects=True)
        if SOLD_OUT_REDIRECT in r.url:
            return False

        soup = BeautifulSoup(r.text, "html.parser")
        page_text = soup.get_text(separator=" ").lower()

        # 2. Sold out overlay
        if "no seats available" in page_text:
            return False

        # 3. Check main page for sold out label
        list_check = requests.get(MAIN_EVENTS_PAGE, timeout=10)
        if "sold out" in list_check.text.lower():
            return False

        # 4. Look for prices and links
        price_elements = soup.find_all(string=lambda text: "£" in text)
        section_links = soup.find_all("a", href=True)
        if price_elements and section_links:
            if not any("unavailable" in link.get("class", []) for link in section_links):
                return True

        return False
    except Exception as e:
        print("[ERROR] While checking tickets:", e)
        return False

def check_tickets():
    global previously_available
    try:
        available = tickets_are_available()

        if available and not previously_available:
            send_telegram_message(f"🎟 Everton v Brighton resale tickets are AVAILABLE!\n👉 {EVENT_PAGE}")
            print(f"[{datetime.datetime.now()}] 🔔 Tickets AVAILABLE")
        else:
            print(f"[{datetime.datetime.now()}] No tickets available.")

        previously_available = available
    except Exception as e:
        print("[FATAL ERROR] in check_tickets:", e)
        send_telegram_message("⚠️ Ticket bot crashed with an error. Check logs.")

# STARTUP PING
print(f"✅ Bot started at {datetime.datetime.now()}")
send_telegram_message("👀 Everton ticket bot restarted and watching...")

# LOOP
while True:
    check_tickets()
    time.sleep(60)
