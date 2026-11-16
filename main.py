"""Safe entry point. Cannot run as a live monitor without a validated source."""
import argparse
import sys

from ticketbot import EVENT_ID, EVENT_URL, telegram_send


def main() -> int:
    parser = argparse.ArgumentParser(description="Everton ticket alert engine (not a live detector)")
    parser.add_argument("--telegram-test", action="store_true", help="Send a test Telegram message")
    args = parser.parse_args()
    if args.telegram_test:
        telegram_send(f"✅ Telegram test for Everton v Liverpool (event {EVENT_ID}).\n"
                      f"No live availability checked.\n{EVENT_URL}")
        print("Telegram test sent and confirmed by Telegram API.")
        return 0
    print("NOT RUNNING: no validated, permitted live ticket availability source is configured.")
    print("This is intentional. Do not deploy it as a working ticket detector.")
    return 2


if __name__ == "__main__":
    sys.exit(main())
