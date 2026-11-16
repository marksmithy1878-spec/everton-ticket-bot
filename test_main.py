import io
from contextlib import redirect_stdout
import unittest
from unittest.mock import patch

import main
from ticketbot import TelegramError


class StartupTests(unittest.TestCase):
    def test_default_startup_refuses_and_sends_nothing(self):
        with patch("sys.argv", ["main.py"]), patch("main.telegram_send") as send, redirect_stdout(io.StringIO()):
            self.assertEqual(main.main(), 2)
        send.assert_not_called()

    def test_explicit_telegram_test_says_no_live_check(self):
        with patch("sys.argv", ["main.py", "--telegram-test"]), patch("main.telegram_send") as send, redirect_stdout(io.StringIO()):
            self.assertEqual(main.main(), 0)
        self.assertIn("No live availability checked", send.call_args.args[0])

    def test_telegram_test_failure_is_clean_and_does_not_print_exception(self):
        output = io.StringIO()
        with patch("sys.argv", ["main.py", "--telegram-test"]), patch("main.telegram_send", side_effect=TelegramError("do-not-print")), redirect_stdout(output):
            self.assertEqual(main.main(), 1)
        self.assertNotIn("do-not-print", output.getvalue())


if __name__ == "__main__":
    unittest.main()
