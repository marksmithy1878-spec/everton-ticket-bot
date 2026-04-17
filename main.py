import requests
import time

BOT_TOKEN = "YOUR_TELEGRAM_BOT_TOKEN"
CHAT_ID = "YOUR_CHAT_ID"

EVENT_ID = 1281  # Man City test

EVENT_URL = f"https://www.eticketing.co.uk/evertonfc/EDP/Event/Index/{EVENT_ID}"
AREA_URL = (
    f"https://www.eticketing.co.uk/evertonfc/EDP/Ism/AreaAvailability"
    f"?excludeTxSeats=False"
    f"&excludePtxSeats=True"
    f"&eventId={EVENT_ID}"
    f"&includeAtxSeats=false"
    f"&showHospitality=false"
)

session = requests.Session()

headers = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/plain, */*",
    "Referer": EVENT_URL,
}

last_state = False

def send_telegram(msg):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    requests.post(url, data={"chat_id": CHAT_ID, "text": msg}, timeout=10)

while True:
    try:
        print("Checking Man City test...")

        # 1. Load event page first to establish session/cookies
        session.get(EVENT_URL, headers=headers, timeout=10)

        # 2. Then call area availability
        r = session.get(AREA_URL, headers=headers, timeout=10)

        print("Status code:", r.status_code)

        if r.status_code != 200:
            print("Bad response body:", r.text[:500])
            time.sleep(10)
            continue

        data = r.json()
        total = sum(area.get("AvailableSeats", 0) for area in data if isinstance(area, dict))

        print("Available seats:", total)

        available = total > 0

        if available and not last_state:
            send_telegram(f"🚨 MAN CITY TEST: seats available! Total AvailableSeats = {total}")
            print("ALERT SENT")

        last_state = available

    except Exception as e:
        print("Error:", e)

    time.sleep(10)
