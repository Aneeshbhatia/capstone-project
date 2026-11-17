import unittest
from datetime import date, timedelta

from model import forecast_hourly


class ForecastHourlyTests(unittest.TestCase):
    def test_blends_recent_and_older_same_hour_demand(self) -> None:
        target = date(2026, 11, 16)
        recent = [{"date": target - timedelta(days=day), "hour": 9, "count": 10} for day in range(1, 8)]
        older = [{"date": target - timedelta(days=day), "hour": 9, "count": 2} for day in range(8, 31)]

        result = forecast_hourly(recent + older, target)

        self.assertEqual(result[9]["expectedTokens"], 7.2)
        self.assertEqual(result[9]["sampleDays"], 30)

    def test_cold_start_returns_zero_for_unobserved_hours(self) -> None:
        result = forecast_hourly([], date(2026, 11, 16))

        self.assertEqual(len(result), 24)
        self.assertTrue(all(row["expectedTokens"] == 0 for row in result))

    def test_includes_zero_count_days_in_historical_mean(self) -> None:
        target = date(2026, 11, 16)
        history = [
            {"date": target - timedelta(days=day), "hour": 9, "count": 0}
            for day in range(1, 8)
        ]
        history.append({"date": target - timedelta(days=8), "hour": 9, "count": 4})

        result = forecast_hourly(history, target)

        self.assertEqual(result[9]["expectedTokens"], 1.4)


if __name__ == "__main__":
    unittest.main()
