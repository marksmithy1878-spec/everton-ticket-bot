import requests
from bs4 import BeautifulSoup
import time
import os
from datetime import datetime, timedelta
import pytz

# Telegram setup
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
CHAT_ID = os.getenv("CHAT_ID")

# Ticket URLs
EVENT_PAGE = "https://www.eticketing.co.uk/evertonfc/EDP/Event/Index/1205"
SOLD_OUT_REDIRECT = "https://www.eticketing.co.uk/evertonfc/EDP/Validation/EventNotAllowed?eventId=1205&reason=EventNoAvailableSalesModesOrSoldOut"
MAIN_EVENTS_PAGE = "https://www.eticketing.co.uk/evertonfc/EDP/Event"

# State tracking
previously_available = False
last_heartbeat = datetime.now(pytz.timezone("Europe/London"))

def send_telegram_message(message):
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    payload = {"chat_id": CHAT_ID, "text": message}
    try:
        requests.post(url, data=payload)
    except Exception as e:
        print("Failed to send Telegram message:", e)

def tickets_are_available():
    try:
        r = requests.get(EVENT_PAGE, timeout=10, allow_redirects=True)

        if SOLD_OUT_REDIRECT in r.url:
            return False

        soup = BeautifulSoup(r.text, "html.parser")
        page_text = soup.get_text(separator=" ").lower()

        if "no seats available" in page_text:
            return False

        list_check = requests.get(MAIN_EVENTS_PAGE, timeout=10)
        if "sold out" in list_check.text.lower():
            return False

        price_elements = soup.find_all(string=lambda text: "£" in text)
        section_links = soup.find_all("a", href=True)
        if price_elements and section_links:
            if not any("unavailable" in link.get("class", []) for link in section_links):
                return True

        return False

    except Exception as e:
        send_telegram_message(f"⚠️ Error during ticket check:\n{str(e)}")
        return False

def get_bst_time():
    return datetime.now(pytz.timezone("Europe/London")).strftime('%Y-%m-%d %H:%M:%S')

def check_tickets():
    global previously_available, last_heartbeat
    bst_now = datetime.now(pytz.timezone("Europe/London"))

    available = tickets_are_available()

    if available and not previously_available:
        send_telegram_message(f"🎟 Everton v Brighton resale tickets are AVAILABLE!\n👉 {EVENT_PAGE}")
        print(f"{get_bst_time()} | Tickets available! Alert sent.")
    elif not available:
        print(f"{get_bst_time()} | No tickets available.")

    previously_available = available

    # Send heartbeat every 60 minutes
    if (bst_now - last_heartbeat) >= timedelta(minutes=60):
        send_telegram_message(f"✅ Bot heartbeat: still running @ {get_bst_time()}")
        last_heartbeat = bst_now

# Start message
send_telegram_message("🤖 Bot started and monitoring ticket availability...")

# Main loop
while True:
    check_tickets()
    time.sleep(60)
