import json
import os
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from model import Observation, forecast_hourly


class ForecastHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path != "/health":
            self._send_json(404, {"error": "Route not found"})
            return
        self._send_json(200, {"status": "ok"})

    def do_POST(self) -> None:
        if self.path != "/forecast":
            self._send_json(404, {"error": "Route not found"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length < 1 or content_length > 1_000_000:
                raise ValueError("Request body must be between 1 byte and 1 MB")
            payload = json.loads(self.rfile.read(content_length))
            target_date = date.fromisoformat(payload["targetDate"])
            history = self._validated_history(payload["history"])
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            self._send_json(400, {"error": str(error)})
            return

        self._send_json(200, {
            "service": payload.get("service", ""),
            "targetDate": target_date.isoformat(),
            "forecast": forecast_hourly(history, target_date),
        })

    @staticmethod
    def _validated_history(value: object) -> list[Observation]:
        if not isinstance(value, list) or len(value) > 1000:
            raise ValueError("history must be a list with at most 1000 entries")

        rows: list[Observation] = []
        for item in value:
            if not isinstance(item, dict):
                raise ValueError("Each history entry must be an object")
            day = date.fromisoformat(item["date"])
            hour = item["hour"]
            count = item["count"]
            if isinstance(hour, bool) or not isinstance(hour, int) or not 0 <= hour <= 23:
                raise ValueError("hour must be an integer from 0 to 23")
            if isinstance(count, bool) or not isinstance(count, int) or count < 0:
                raise ValueError("count must be a non-negative integer")
            rows.append({"date": day, "hour": hour, "count": count})
        return rows

    def _send_json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        print(f"{self.address_string()} - {format % args}")


def main() -> None:
    port = int(os.environ.get("FORECAST_PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), ForecastHandler)
    print(f"Python forecast service listening on port {port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
