import time
import requests
from bs4 import BeautifulSoup
from datetime import datetime
import pytz
import logging
import os
import telegram

# ----------------------
# CONFIGURATION
# ----------------------

URL = 'https://tickets.evertonfc.com/en-GB/categories/resale'
TELEGRAM_TOKEN = os.getenv('TELEGRAM_TOKEN')
TELEGRAM_CHAT_ID = os.getenv('TELEGRAM_CHAT_ID')

# Heartbeat interval in seconds (e.g. every 5 minutes)
HEARTBEAT_INTERVAL = 5 * 60

# Delay between ticket checks in seconds
CHECK_INTERVAL = 60

# ----------------------
# INITIALISE
# ----------------------

bot = telegram.Bot(token=TELEGRAM_TOKEN)
last_heartbeat = time.time()

logging.basicConfig(level=logging.INFO)
london_tz = pytz.timezone("Europe/London")

def send_telegram_message(message: str):
    try:
        bot.send_message(chat_id=TELEGRAM_CHAT_ID, text=message)
        logging.info(f"Sent message: {message}")
    except Exception as e:
        logging.error(f"Failed to send message: {e}")

def get_ticket_page_html():
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0'
        }
        response = requests.get(URL, headers=headers, timeout=10)
        response.raise_for_status()
        return response.text
    except Exception as e:
        logging.error(f"Error fetching ticket page: {e}")
        return None

def check_for_tickets(html: str):
    soup = BeautifulSoup(html, 'html.parser')
    listings = soup.find_all('a', class_='resale-event-item')
    return len(listings) > 0

# ----------------------
# START BOT
# ----------------------

send_telegram_message("🤖 Bot started and monitoring ticket availability...")

while True:
    try:
        html = get_ticket_page_html()
        if html:
            if check_for_tickets(html):
                london_time = datetime.now(london_tz).strftime('%Y-%m-%d %H:%M:%S')
                send_telegram_message(f"🎟️ Tickets found! Go now: {URL}\n🕒 {london_time}")
            else:
                logging.info("No tickets found.")
        else:
            logging.warning("No HTML returned from ticket site.")

        # Send heartbeat if interval exceeded
        current_time = time.time()
        if current_time - last_heartbeat > HEARTBEAT_INTERVAL:
            london_time = datetime.now(london_tz).strftime('%Y-%m-%d %H:%M:%S')
            send_telegram_message(f"✅ Bot heartbeat: still running @ {london_time}")
            last_heartbeat = current_time

    except Exception as e:
        logging.error(f"Unexpected error: {e}")
        send_telegram_message(f"⚠️ Bot error: {e}")

    time.sleep(CHECK_INTERVAL)
