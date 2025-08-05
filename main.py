import requests
from bs4 import BeautifulSoup
import time
import os

# Load secrets from Render environment variables
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
CHAT_ID = os.getenv("CHAT_ID")

# Direct ticket availability URL
URL = "https://www.eticketing.co.uk/evertonfc/EDP/Event/Index/1205"

# Phrases indicating NO tickets
SOLD_OUT_KEYWORDS = [
    "Sold Out",
    "No tickets available",
    "This event currently has no seats available"
]

def send_telegram_message(message):
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    payload = {"chat_id": CHAT_ID, "text": message}
    try:
        requests.post(url, data=payload)
    except Exception as e:
        print("Failed to send Telegram message:", e)

def check_tickets():
    try:
        headers = {"User-Agent": "Mozilla/5.0"}
        r = requests.get(URL, headers=headers, timeout=10)
        soup = BeautifulSoup(r.text, "html.parser")
        page_text = soup.get_text()

        # If NONE of the sold-out phrases are present → tickets likely available
        if not any(keyword.lower() in page_text.lower() for keyword in SOLD_OUT_KEYWORDS):
            send_telegram_message("🎟 Everton v Brighton resale tickets are AVAILABLE!")
    except Exception as e:
        print("Error checking tickets:", e)

# Check every 60 seconds
while True:
    check_tickets()
    time.sleep(60)
