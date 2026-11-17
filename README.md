# Slot recommendation platform

React dashboard with a MongoDB/Express API, Socket.IO live updates, Python demand forecasting, and QR-coded tickets/appointments. The dashboard includes live queue controls, token issuance, booking, counter setup, and traffic analytics.

## Run locally

1. Install Node.js and MongoDB.
2. Copy `.env.example` to `.env` and set `MONGODB_URI`.
3. Run `npm install`, then `npm run dev`.
4. In a second terminal, run `cd forecasting` and `python app.py` to start the Python forecast service on port `8000`. It uses only the Python standard library.
5. In another terminal, run `cd frontend`, copy `frontend/.env.example` to `frontend/.env`, then run `npm install` and `npm run dev`.

The API listens on port `5000`, the dashboard on port `5173`, and the forecast service on port `8000` by default. `GET /health` checks the API; `GET http://localhost:8000/health` checks the Python service. Socket.IO clients can listen for `queue:updated` events to refresh the live queue board.

The React dashboard uses separate browser routes: `/` (overview), `/queue`, `/recommendations`, `/appointments`, `/analytics`, and `/services`. The sidebar navigates between these pages.

## API

All API routes are under `/api`.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/counters` | Create a counter (`name`, `code`, optional `services`, `capacity`, `avgServiceMinutes`) |
| `GET` | `/counters` | List counters |
| `PATCH` | `/counters/:id` | Update counter configuration |
| `POST` | `/tokens` | Issue a live token (`service`, optional `customerName` and `counterId`); response includes estimated wait |
| `GET` | `/public/tickets/:code` | Return privacy-limited token/appointment status for the QR link |
| `GET` | `/board?counterId=` | Get today's waiting and serving tokens grouped by counter |
| `PATCH` | `/tokens/:id/status` | Move a token to `serving`, `completed`, `no_show`, or `cancelled` |
| `GET` | `/recommendations?service=&from=&limit=` | Rank available counter/time slots using current queue load and the last 30 days of demand and service duration |
| `GET` | `/appointments?status=&from=&to=&limit=` | List upcoming or filtered appointments |
| `POST` | `/appointments` | Book an appointment (`service`, `customerName`, `scheduledAt`, optional `counterId`) |
| `POST` | `/appointments/:id/check-in` | Check in a booked appointment and issue its token |
| `POST` | `/appointments/:id/no-show` | Mark an appointment as a no-show |
| `GET` | `/analytics?from=&to=` | Return totals, no-show rate, average service duration, hourly traffic, and counter breakdown |

Recommendations return the lowest-wait half-hour slots (up to eight hours ahead). Node sends 30 days of hourly service counts, including zero-count hours, to Python; Python forecasts each hour using a weighted recent/older average. If the Python service is unavailable, recommendation requests return an explicit service error. Walk-in token issuance continues using live queue load without depending on forecasting.

The dashboard offers General service, Document verification, Bill payment, Account services, and Appointment consultation. Add the chosen service to a counter's supported services in Counter setup; otherwise that counter will not be offered for the service. Counters with an empty supported-services list accept all services.

Issued tokens and appointments include a random public code. The frontend encodes a status-only link as a QR code; scanning it opens the dashboard’s public ticket view. The QR lookup omits customer names and other personal details.

### Scan QR codes from a phone

`localhost` in a QR link refers to the device scanning it, not the computer running the app. To scan tickets on another device, connect both devices to the same network and:

1. Find the computer's LAN IPv4 address (for example, `192.168.1.25`).
2. Set `VITE_PUBLIC_APP_URL=http://192.168.1.25:5173` in `frontend/.env`.
3. Add that same frontend origin to `CLIENT_ORIGIN` in the backend `.env`, for example `http://localhost:5173,http://127.0.0.1:5173,http://192.168.1.25:5173`.
4. Restart the frontend and backend, then scan a newly generated QR code. Allow ports `5173` and `5000` through the computer's firewall if prompted.

The API URL defaults to the hostname used to open the dashboard, so opening `http://192.168.1.25:5173` on the phone makes its API requests go to `http://192.168.1.25:5000`. Set `VITE_API_URL` explicitly only if the API is hosted elsewhere.

## Tests

Run the wait-estimation tests with `npm test` and the Python forecast tests from `forecasting` with `python -m unittest test_model.py`.
