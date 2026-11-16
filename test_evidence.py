"""Offline regression tests derived from the handover; NOT live recordings."""
from dataclasses import replace
from datetime import datetime, timedelta, timezone
import io
import unittest
from contextlib import redirect_stdout
from unittest.mock import Mock, patch

from evidence import AccessGuard, Evidence, Kind, Seat, classify
from ticketbot import AlertEngine, EVENT_ID, Observation, State, TelegramError, telegram_send


NOW = datetime(2026, 11, 16, 12, tzinfo=timezone.utc)


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.e = Evidence(EVENT_ID, NOW, Kind.SEAT_PANEL, 200,
                          adapter_validated=True,
                          seat=Seat("014", "02", "080", 7500, True))

    def test_reported_individual_seat_is_possible(self):
        obs = classify(self.e, NOW)
        self.assertEqual(obs.state, State.POSSIBLE)
        self.assertIn("£75.00", obs.reason)
        self.assertEqual(obs.opportunity_key, "seat:014:02:080")

    def test_failed_selection_does_not_erase_earlier_opportunity(self):
        obs = classify(replace(self.e, selection_rejected=True), NOW)
        self.assertEqual(obs.state, State.POSSIBLE)
        self.assertIn("failed", obs.reason)

    def test_unvalidated_reader_cannot_emit_alert(self):
        self.assertEqual(classify(replace(self.e, adapter_validated=False), NOW).state, State.UNKNOWN)
        self.assertEqual(classify(replace(self.e, adapter_validated="false"), NOW).state, State.UNKNOWN)

    def test_map_pricing_and_account_success_are_unknown(self):
        self.assertEqual(classify(replace(self.e, kind=Kind.PAGE), NOW).state, State.UNKNOWN)

    def test_pink_marker_without_panel_is_insufficient(self):
        self.assertEqual(classify(replace(self.e, seat=None), NOW).state, State.UNKNOWN)

    def test_disabled_basket_button_is_insufficient(self):
        self.assertEqual(classify(replace(self.e, seat=replace(self.e.seat, add_to_basket_enabled=False)), NOW).state,
                         State.UNKNOWN)

    def test_invalid_seat_labels_price_or_button_are_unknown(self):
        for changes in ({"section": "<script>"}, {"row": ""}, {"number": 80},
                        {"price_pence": True}, {"price_pence": -1},
                        {"add_to_basket_enabled": "false"}):
            with self.subTest(changes=changes):
                self.assertEqual(classify(replace(self.e, seat=replace(self.e.seat, **changes)), NOW).state,
                                 State.UNKNOWN)

    def test_http_errors_override_positive_seat(self):
        for status in (None, 401, 403, 404, 429, 500, 540):
            with self.subTest(status=status):
                self.assertEqual(classify(replace(self.e, http_status=status), NOW).state, State.UNKNOWN)

    def test_restriction_inside_http_200_overrides_positive(self):
        self.assertEqual(classify(replace(self.e, restricted=True), NOW).state, State.UNKNOWN)

    def test_timeout_is_unknown(self):
        self.assertEqual(classify(replace(self.e, timed_out=True), NOW).state, State.UNKNOWN)

    def test_wrong_fixture_ignored_even_if_positive(self):
        self.assertEqual(classify(replace(self.e, event_id=1481), NOW).state, State.UNKNOWN)

    def test_stale_future_and_naive_timestamps_are_unknown(self):
        for captured in (NOW - timedelta(minutes=3), NOW + timedelta(seconds=1), NOW.replace(tzinfo=None)):
            self.assertEqual(classify(replace(self.e, captured_at=captured), NOW).state, State.UNKNOWN)
        self.assertEqual(classify(self.e, NOW.replace(tzinfo=None)).state, State.UNKNOWN)

    def test_positive_sections_are_possible_not_confirmed_resale(self):
        e = replace(self.e, kind=Kind.SECTION_COUNTS, seat=None, section_counts=(("014", 2), ("015", 0)))
        obs = classify(e, NOW)
        self.assertEqual(obs.state, State.POSSIBLE)
        self.assertIn("ordinary tickets", obs.reason)

    def test_zero_sections_do_not_mean_unavailable(self):
        e = replace(self.e, kind=Kind.SECTION_COUNTS, seat=None, section_counts=(("014", 0),))
        self.assertEqual(classify(e, NOW).state, State.UNKNOWN)

    def test_invalid_section_values_and_schema_drift(self):
        for counts in ((("014", True),), (("014", -1),), (("014", "1"),),
                       (("014", 1), ("014", 2)), (("014",),), (None,), None, (("bad label", 1),)):
            with self.subTest(counts=counts):
                e = replace(self.e, kind=Kind.SECTION_COUNTS, seat=None, section_counts=counts)
                self.assertEqual(classify(e, NOW).state, State.UNKNOWN)

    def test_explicit_fresh_successful_no_seats_is_snapshot_unavailable(self):
        e = replace(self.e, kind=Kind.NO_SEATS, seat=None)
        self.assertEqual(classify(e, NOW).state, State.UNAVAILABLE)
        self.assertEqual(classify(replace(e, http_status=540), NOW).state, State.UNKNOWN)

    def test_conflicting_no_seats_and_positive_is_unknown(self):
        self.assertEqual(classify(replace(self.e, kind=Kind.NO_SEATS), NOW).state, State.UNKNOWN)


class AccessGuardTests(unittest.TestCase):
    def test_restrictions_latch_closed_without_automatic_retries(self):
        for status in (401, 403, 429):
            guard = AccessGuard()
            guard.record(status, NOW)
            self.assertFalse(guard.allowed(NOW + timedelta(days=30)))
            guard.record(200, NOW + timedelta(days=30))
            self.assertFalse(guard.allowed(NOW + timedelta(days=31)))

    def test_challenge_in_successful_page_stops_checks(self):
        guard = AccessGuard()
        guard.record(200, NOW, restricted=True)
        self.assertFalse(guard.allowed(NOW))

    def test_timeout_and_540_back_off_without_tight_retries(self):
        guard = AccessGuard()
        guard.record(None, NOW)
        self.assertFalse(guard.allowed(NOW + timedelta(minutes=4)))
        self.assertTrue(guard.allowed(NOW + timedelta(minutes=5)))
        guard.record(540, NOW + timedelta(minutes=5))
        self.assertFalse(guard.allowed(NOW + timedelta(minutes=14)))
        self.assertTrue(guard.allowed(NOW + timedelta(minutes=15)))

    def test_success_does_not_shorten_existing_pause(self):
        guard = AccessGuard()
        guard.record(500, NOW)
        guard.record(200, NOW + timedelta(seconds=1))
        self.assertFalse(guard.allowed(NOW + timedelta(seconds=2)))

    def test_backoff_caps_at_one_hour(self):
        guard = AccessGuard()
        for _ in range(20):
            guard.record(500, NOW)
        self.assertEqual(guard.next_allowed, NOW + timedelta(hours=1))


class DeliveryAndDedupTests(unittest.TestCase):
    def setUp(self):
        self.sent = []
        self.engine = AlertEngine(self.sent.append)
        self.a = Observation(State.POSSIBLE, "Seat A", opportunity_key="seat:014:02:080")
        self.b = Observation(State.POSSIBLE, "Seat B", opportunity_key="seat:014:02:081")

    def test_new_seat_alerts_immediately_and_previous_seat_stays_suppressed(self):
        self.engine.process(self.a, NOW)
        self.engine.process(self.b, NOW + timedelta(seconds=1))
        self.assertEqual(self.engine.process(self.a, NOW + timedelta(seconds=2)), "duplicate-suppressed")
        self.assertEqual(len(self.sent), 2)

    def test_state_downgrade_does_not_duplicate_but_upgrade_does(self):
        self.engine.process(self.a, NOW)
        self.engine.process(replace(self.a, state=State.AVAILABLE), NOW + timedelta(seconds=1))
        self.engine.process(self.a, NOW + timedelta(seconds=2))
        self.assertEqual(len(self.sent), 2)

    def test_unknown_does_not_reset_dedup(self):
        self.engine.process(self.a, NOW)
        self.engine.process(Observation(State.UNKNOWN, "timeout"), NOW)
        self.engine.process(self.a, NOW)
        self.assertEqual(len(self.sent), 1)

    def test_failed_notification_retries_on_fresh_evidence_without_marking_delivered(self):
        sender = Mock(side_effect=[TelegramError("test"), None])
        engine = AlertEngine(sender)
        self.assertEqual(engine.process(self.a, NOW), "notification-failed")
        self.assertEqual(engine.process(self.a, NOW + timedelta(seconds=1)), "notification-failed")
        self.assertEqual(sender.call_count, 1)
        self.assertEqual(engine.process(self.a, NOW + timedelta(minutes=1)), "opportunity-alert-sent")
        self.assertEqual(sender.call_count, 2)

    def test_failed_alert_is_not_sent_later_without_current_positive_evidence(self):
        sender = Mock(side_effect=TelegramError("test"))
        engine = AlertEngine(sender)
        engine.process(self.a, NOW)
        engine.process(Observation(State.UNAVAILABLE, "no seats"), NOW + timedelta(minutes=2))
        self.assertEqual(sender.call_count, 1)

    def test_failure_warning_delivery_failure_is_handled(self):
        engine = AlertEngine(Mock(side_effect=TelegramError("test")), failure_threshold=1)
        self.assertEqual(engine.process(Observation(State.UNKNOWN, "error"), NOW), "notification-failed")
        self.assertIsNone(engine.last_failure_alert)

    def test_heartbeat_delivery_failure_does_not_mark_it_sent(self):
        engine = AlertEngine(Mock(side_effect=TelegramError("test")))
        self.assertFalse(engine.maybe_heartbeat(NOW))
        self.assertIsNone(engine.last_heartbeat)

    def test_arbitrary_reason_not_logged(self):
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            self.engine.process(Observation(State.UNKNOWN, "private-token-do-not-log"), NOW)
        self.assertNotIn("private-token", buffer.getvalue())

    def test_naive_time_refused(self):
        with self.assertRaises(ValueError):
            self.engine.process(self.a, NOW.replace(tzinfo=None))

    def test_utc_quiet_hours_convert_to_uk_summer_time(self):
        # 23:30 UTC in July is 00:30 BST; routine heartbeat must be silent.
        summer = datetime(2026, 7, 16, 23, 30, tzinfo=timezone.utc)
        self.assertFalse(self.engine.maybe_heartbeat(summer))
        self.engine.process(self.a, summer)
        self.assertEqual(len(self.sent), 1)

    def test_elapsed_time_across_autumn_clock_change(self):
        from zoneinfo import ZoneInfo
        uk = ZoneInfo("Europe/London")
        first = datetime(2026, 10, 25, 1, 50, tzinfo=uk, fold=0)
        second = datetime(2026, 10, 25, 1, 25, tzinfo=uk, fold=1)
        self.engine.process(self.a, first)
        self.engine.process(self.a, second)  # 35 real minutes later, despite wall clock going back.
        self.assertEqual(len(self.sent), 2)

    def test_malformed_telegram_responses_are_sanitized(self):
        from test_ticketbot import TelegramTests
        for body in (None, [], {"ok": "false"}, {"ok": 1}):
            with patch("ticketbot.urlopen", return_value=TelegramTests.FakeResponse(body)):
                with self.assertRaises(TelegramError):
                    telegram_send("test", token="fake", chat_id="fake")


if __name__ == "__main__":
    unittest.main()
