import requests
from bs4 import BeautifulSoup
import time
import os

TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
CHAT_ID = os.getenv("CHAT_ID")

ITEMS_COUNT_API = "https://www.eticketing.co.uk/evertonfc/api/ItemsCount"
TICKET_PAGE_URL = "https://www.eticketing.co.uk/evertonfc/EDP/Event/Index/1205"
VALIDATION_URL = "https://www.eticketing.co.uk/evertonfc/EDP/Validation/EventNotAllowed?eventId=1205&reason=EventNoAvailableSalesModesOrSoldOut"

previously_available = False

def send_telegram_message(message):
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    payload = {"chat_id": CHAT_ID, "text": message}
    try:
        requests.post(url, data=payload)
    except Exception as e:
        print("Failed to send Telegram message:", e)

def check_tickets():
    global previously_available
    try:
        # Check API first
        response = requests.get(ITEMS_COUNT_API, timeout=10, allow_redirects=True)

        # Check redirect to sold out page
        if response.url.startswith(VALIDATION_URL):
            print("Redirected to Validation page — no tickets.")
            previously_available = False
            return

        # Parse API response
        try:
            counts = response.json()
        except ValueError:
            counts = [0]

        if isinstance(counts, int):
            counts = [counts]

        # Determine availability from API
        available = any(c > 0 for c in counts)

        # If API shows 0, double-check main ticket page for “Sold Out”
        if not available:
            html = requests.get(TICKET_PAGE_URL, timeout=10).text
            soup = BeautifulSoup(html, "html.parser")
            if "sold out" in soup.get_text().lower():
                available = False
            else:
                # If no sold-out text and API says 0, treat as available (edge case)
                available = True

        # Send alert only on change from unavailable to available
        if available and not previously_available:
            send_telegram_message(f"🎟 Everton v Brighton tickets are AVAILABLE!\n👉 {TICKET_PAGE_URL}")

        previously_available = available

    except Exception as e:
        print("Error checking tickets:", e)

while True:
    check_tickets()
    time.sleep(60)
