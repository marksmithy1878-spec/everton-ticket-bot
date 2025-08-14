import requests
from bs4 import BeautifulSoup
import time
import os
from datetime import datetime

# Load environment variables for Telegram
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
CHAT_ID = os.getenv("CHAT_ID")

# Constants
EVENT_PAGE = "https://www.eticketing.co.uk/evertonfc/EDP/Event/Index/1205"
SOLD_OUT_REDIRECT = "https://www.eticketing.co.uk/evertonfc/EDP/Validation/EventNotAllowed?eventId=1205&reason=EventNoAvailableSalesModesOrSoldOut"
MAIN_EVENTS_PAGE = "https://www.eticketing.co.uk/evertonfc/EDP/Event"

# Track state
previously_available = False
last_heartbeat_sent = 0
HEARTBEAT_INTERVAL = 3600  # seconds

def send_telegram_message(message):
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    payload = {"chat_id": CHAT_ID, "text": message}
    try:
        response = requests.post(url, data=payload)
        if response.status_code != 200:
            print(f"Telegram send failed: {response.text}")
    except Exception as e:
        print("Error sending Telegram message:", e)

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

        # Look for visible prices and seat section links
        price_elements = soup.find_all(string=lambda text: "£" in text)
        section_links = soup.find_all("a", href=True)

        if price_elements and section_links:
            available_links = [
                link for link in section_links if "unavailable" not in link.get("class", [])
            ]
            if available_links:
                return True

        return False

    except Exception as e:
        print("Ticket check error:", e)
        return False

def check_tickets():
    global previously_available
    available = tickets_are_available()

    if available and not previously_available:
        send_telegram_message(f"🎟 Everton resale tickets are AVAILABLE!\n👉 {EVENT_PAGE}")
        print("✅ Alert sent: tickets available.")
    elif not available and previously_available:
        send_telegram_message("ℹ️ Tickets now SOLD OUT again.")
        print("ℹ️ Alert: tickets now sold out.")
    else:
        print("No change in ticket availability.")

    previously_available = available

def heartbeat():
    global last_heartbeat_sent
    now = time.time()
    if now - last_heartbeat_sent > HEARTBEAT_INTERVAL:
        send_telegram_message(f"✅ Bot heartbeat: still running @ {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        last_heartbeat_sent = now

# Loop every 60 seconds
print(f"Bot started at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
send_telegram_message("🤖 Bot started and monitoring ticket availability...")

while True:
    check_tickets()
    heartbeat()
    time.sleep(60)
