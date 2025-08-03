import requests
from bs4 import BeautifulSoup
import time
import os

# Load secrets from Render environment variables
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
CHAT_ID = os.getenv("CHAT_ID")

# Everton v Brighton resale page (correct event link)
URL = "https://www.eticketing.co.uk/evertonfc/EDP/Event/Index/635"

# Keywords to look for on the page
KEYWORDS = ["Brighton", "Buy", "Available"]

def send_telegram_message(message):
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    payload = {"chat_id": CHAT_ID, "text": message}
    try:
        requests.post(url, data=payload)
    except Exception as e:
        print("Failed to send Telegram message:", e)

def check_tickets():
    try:
        r = requests.get(URL, timeout=10)
        soup = BeautifulSoup(r.text, "html.parser")
        page_text = soup.get_text()

        if all(word.lower() in page_text.lower() for word in KEYWORDS):
            send_telegram_message("🎟 Everton v Brighton resale tickets are available!")
    except Exception as e:
        print("Error checking tickets:", e)

# Run every 60 seconds
while True:
    check_tickets()
    time.sleep(60)
