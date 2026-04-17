import requests
import time

BOT_TOKEN = "YOUR_TELEGRAM_BOT_TOKEN"
CHAT_ID = "YOUR_CHAT_ID"

EVENT_ID = 1280  # change to 1281 for testing

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

        # SOLD OUT signals
        sold_out = (
            "no longer onsale" in html
            or "sold out" in html
        )

        # AVAILABLE signals (seat map usable)
        seat_map_active = (
            "choose your ticket preferences" in html
            or "qty. of seats" in html
        )

        available = seat_map_active and not sold_out

        print("Available:", available)

        if available and not last_state:
            send_telegram("🚨 TICKET WINDOW OPEN – CHECK NOW!")
            print("ALERT SENT")

        last_state = available

    except Exception as e:
        print("Error:", e)

    time.sleep(5)
