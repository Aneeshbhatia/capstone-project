from datetime import date, timedelta
from statistics import fmean
from typing import TypedDict


class Observation(TypedDict):
    date: date
    hour: int
    count: int


def forecast_hourly(history: list[Observation], target_date: date) -> list[dict[str, int | float]]:
    recent_start = target_date - timedelta(days=7)
    forecast = []

    for hour in range(24):
        recent = [
            row["count"]
            for row in history
            if row["hour"] == hour and recent_start <= row["date"] < target_date
        ]
        earlier = [
            row["count"]
            for row in history
            if row["hour"] == hour and row["date"] < recent_start
        ]

        if recent and earlier:
            expected = 0.65 * fmean(recent) + 0.35 * fmean(earlier)
        elif recent:
            expected = fmean(recent)
        elif earlier:
            expected = fmean(earlier)
        else:
            expected = 0.0

        forecast.append({
            "hour": hour,
            "expectedTokens": round(expected, 2),
            "sampleDays": len(recent) + len(earlier),
        })

    return forecast
