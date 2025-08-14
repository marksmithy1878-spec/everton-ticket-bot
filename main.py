import requests
from bs4 import BeautifulSoup
import time
import pytz
from datetime import datetime
from telegram import Bot

# === CONFIGURATION ===
TELEGRAM_TOKEN = 'your-telegram-bot-token'
TELEGRAM_CHAT_ID = 'your-chat-id'
CHECK_INTERVAL = 60  # seconds
HEARTBEAT_INTERVAL = 300  # 5 minutes
TICKET_URL = 'https://example.com/ticket-page'  # Replace with actual ticket URL

# === INITIALISE ===
bot = Bot(token=TELEGRAM_TOKEN)
last_heartbeat_time = 0
ticket_notified = False  # Prevents duplicate ticket messages


# === TIME CHECK FUNCTION ===
def is_within_allowed_hours():
    bst = pytz.timezone("Europe/London")
    now = datetime.now(bst)
    return 6 <= now.hour < 24


# === SMART SEND WRAPPER ===
def safe_send_message(bot, chat_id, message):
    if is_within_allowed_hours():
        bot.send_message(chat_id=chat_id, text=message)
    else:
        print(f"⏰ Skipped message outside allowed hours: {message}")


# === MAIN TICKET CHECK FUNCTION ===
def check_ticket_availability():
    try:
        response = requests.get(TICKET_URL)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')

        # Modify this logic based on the site structure
        ticket_elements = soup.find_all(string=lambda text: 'resale' in text.lower() or 'buy' in text.lower())

        return bool(ticket_elements)

    except Exception as e:
        print(f"[ERROR] Could not check ticket availability: {e}")
        return False


# === MAIN LOOP ===
safe_send_message(bot, TELEGRAM_CHAT_ID, "🤖 Bot started and monitoring ticket availability...")

while True:
    current_time = time.time()

    # Heartbeat
    if current_time - last_heartbeat_time > HEARTBEAT_INTERVAL:
        now_bst = datetime.now(pytz.timezone("Europe/London")).strftime('%Y-%m-%d %H:%M:%S')
        safe_send_message(bot, TELEGRAM_CHAT_ID, f"✅ Bot heartbeat: still running @ {now_bst}")
        last_heartbeat_time = current_time

    # Check for ticket
    if check_ticket_availability():
        if not ticket_notified:
            safe_send_message(bot, TELEGRAM_CHAT_ID, "🎟️ Ticket AVAILABLE NOW — GO GET IT!")
            ticket_notified = True
    else:
        ticket_notified = False  # Reset if no ticket, so it can notify again later

    time.sleep(CHECK_INTERVAL)
