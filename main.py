import requests
import time

BOT_TOKEN = "YOUR_TELEGRAM_BOT_TOKEN"
CHAT_ID = "YOUR_CHAT_ID"

EVENT_ID = 1280  # Liverpool

URL = f"https://www.eticketing.co.uk/evertonfc/EDP/Event/Index/{EVENT_ID}"

headers = {
    "User-Agent": "Mozilla/5.0"
}

last_state = False

def send_telegram(msg):
    requests.post(
        f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
        data={"chat_id": CHAT_ID, "text": msg}
    )

while True:
    try:
        print("Checking page...")

        r = requests.get(URL, headers=headers, timeout=10)
        html = r.text.lower()

        # TRUE "no ticket" signal (this is the key)
        no_tickets = (
            "no seats available matching your criteria" in html
            or "0 results" in html
        )

        available = not no_tickets

        print("Available:", available)

        if available and not last_state:
            send_telegram("🚨 TICKET FOUND – CHECK NOW!")
            print("ALERT SENT")

        last_state = available

    except Exception as e:
        print("Error:", e)

    time.sleep(5)
