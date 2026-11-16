import unittest
from unittest.mock import patch
import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from ticketbot import (AlertEngine, EVENT_ID, EVENT_URL, Observation, State,
                       TelegramError, classify_example_response, is_heartbeat_quiet, telegram_send)

UK = ZoneInfo("Europe/London")


def at(hour=12, minute=0, month=11):
    return datetime(2026, month, 16, hour, minute, tzinfo=UK)


class ClassifierTests(unittest.TestCase):
    def test_http_403_never_means_sold_out(self):
        result = classify_example_response(403, {"eventId": EVENT_ID}, fixture_id=EVENT_ID)
        self.assertEqual(result.state, State.UNKNOWN)

    def test_http_404_is_unknown(self):
        self.assertEqual(classify_example_response(404, {}, fixture_id=EVENT_ID).state, State.UNKNOWN)

    def test_http_540_no_seats_message_remains_unknown(self):
        # The real site's 5085 code has not been proven to mean resale inventory is zero.
        self.assertEqual(classify_example_response(540, {"errorCode": 5085}, fixture_id=EVENT_ID).state,
                         State.UNKNOWN)

    def test_timeout_is_unknown(self):
        self.assertEqual(classify_example_response(None, {}, fixture_id=EVENT_ID).state, State.UNKNOWN)

    def test_invalid_data_is_unknown(self):
        self.assertEqual(classify_example_response(200, "bad data", fixture_id=EVENT_ID).state,
                         State.UNKNOWN)

    def test_wrong_event_is_unknown(self):
        self.assertEqual(classify_example_response(200, {"eventId": 1481},
                                                   fixture_id=1481).state, State.UNKNOWN)

    def test_section_count_is_only_possible(self):
        data = {"eventId": EVENT_ID, "totalAvailableSeat": 3}
        self.assertEqual(classify_example_response(200, data, fixture_id=EVENT_ID).state, State.POSSIBLE)

    def test_simulated_confirmed_resale_seat(self):
        # The field below is INVENTED solely to test the alert engine. Not a real API schema.
        data = {"eventId": EVENT_ID, "resaleConfirmed": True, "selectableResaleSeats": 1}
        self.assertEqual(classify_example_response(200, data, fixture_id=EVENT_ID).state, State.AVAILABLE)

    def test_simulated_zero_resale_seats(self):
        data = {"eventId": EVENT_ID, "resaleConfirmed": True, "selectableResaleSeats": 0}
        self.assertEqual(classify_example_response(200, data, fixture_id=EVENT_ID).state, State.UNAVAILABLE)


class AlertTests(unittest.TestCase):
    def setUp(self):
        self.sent = []
        self.bot = AlertEngine(self.sent.append)
        self.possible = Observation(State.POSSIBLE, "Section availability changed")

    def test_opportunity_alert_includes_official_link(self):
        self.assertEqual(self.bot.process(self.possible, at()), "opportunity-alert-sent")
        self.assertIn(EVENT_URL, self.sent[0])

    def test_duplicate_is_suppressed(self):
        self.bot.process(self.possible, at())
        self.assertEqual(self.bot.process(self.possible, at(12, 1)), "duplicate-suppressed")
        self.assertEqual(len(self.sent), 1)

    def test_repeat_after_cooldown(self):
        self.bot.process(self.possible, at())
        self.assertEqual(self.bot.process(self.possible, at(12, 31)), "opportunity-alert-sent")
        self.assertEqual(len(self.sent), 2)

    def test_unavailable_resets_opportunity(self):
        self.bot.process(self.possible, at())
        self.bot.process(Observation(State.UNAVAILABLE, "Explicit negative"), at(12, 1))
        self.assertEqual(self.bot.process(self.possible, at(12, 2)), "opportunity-alert-sent")

    def test_three_errors_trigger_warning(self):
        err = Observation(State.UNKNOWN, "blocked")
        self.bot.process(err, at())
        self.bot.process(err, at(12, 1))
        self.assertEqual(len(self.sent), 0)
        self.assertEqual(self.bot.process(err, at(12, 2)), "failure-warning-sent")
        self.assertIn("NOT sold out", self.sent[0])

    def test_errors_do_not_send_repeat_warning_too_soon(self):
        err = Observation(State.UNKNOWN, "blocked")
        for minute in range(5):
            self.bot.process(err, at(12, minute))
        self.assertEqual(len(self.sent), 1)

    def test_error_warns_again_after_hour(self):
        err = Observation(State.UNKNOWN, "blocked")
        for minute in (0, 1, 2, 3):
            self.bot.process(err, at(12, minute))
        self.bot.process(err, at(13, 2))
        self.assertEqual(len(self.sent), 2)

    def test_wrong_event_refused(self):
        with self.assertRaises(ValueError):
            self.bot.process(Observation(State.AVAILABLE, "wrong", 1280), at())

    def test_heartbeats_quiet_at_midnight_and_five(self):
        self.assertFalse(self.bot.maybe_heartbeat(at(0)))
        self.assertFalse(self.bot.maybe_heartbeat(at(5, 59)))

    def test_heartbeat_allowed_at_six(self):
        self.assertTrue(self.bot.maybe_heartbeat(at(6)))
        self.assertEqual(len(self.sent), 1)
        self.assertIn("does NOT confirm live", self.sent[0])

    def test_real_opportunity_alert_even_during_quiet_hours(self):
        self.bot.process(self.possible, at(2))
        self.assertEqual(len(self.sent), 1)

    def test_dst(self):
        # UK is BST in July and GMT in November.
        self.assertEqual(at(12, month=7).utcoffset(), timedelta(hours=1))
        self.assertEqual(at(12, month=11).utcoffset(), timedelta(hours=0))
        self.assertTrue(is_heartbeat_quiet(at(2, month=7)))


class TelegramTests(unittest.TestCase):
    class FakeResponse:
        status = 200

        def __init__(self, body):
            self.body = body

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return json.dumps(self.body).encode("utf-8")

    def test_telegram_success_mocked(self):
        with patch("ticketbot.urlopen", return_value=self.FakeResponse({"ok": True})) as send:
            telegram_send("Test", token="fake-test-token", chat_id="fake-chat-id")
        self.assertEqual(send.call_count, 1)

    def test_telegram_api_rejection_mocked(self):
        with patch("ticketbot.urlopen", return_value=self.FakeResponse({"ok": False})):
            with self.assertRaises(TelegramError):
                telegram_send("Test", token="fake-test-token", chat_id="fake-chat-id")

    def test_telegram_network_failure_hides_token(self):
        with patch("ticketbot.urlopen", side_effect=OSError("down")):
            with self.assertRaises(TelegramError) as e:
                telegram_send("Test", token="secret-test-value", chat_id="fake-chat-id")
        self.assertNotIn("secret-test-value", str(e.exception))

    def test_telegram_requires_private_credentials(self):
        with patch.dict("os.environ", {"TELEGRAM_TOKEN": "", "CHAT_ID": ""}):
            with self.assertRaises(TelegramError):
                telegram_send("Test")


if __name__ == "__main__":
    unittest.main()
