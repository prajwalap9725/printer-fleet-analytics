# Dataset-driven Anomaly Detection Backend (local AWS simulation)

Local, zero-dependency replacement for the whole AWS stack in `printer-backend/`,
driven entirely by the generated dataset instead of live IoT messages.

| AWS original | Local replacement |
| --- | --- |
| AWS IoT Core topic `anom/detect` (`emit_json_data.py`) | `POST /api/telemetry` fed by `replay_dataset.py --post http://localhost:3001/api/telemetry` |
| Lambda `anomaly_detector` (threshold breach -> EventCount) | same logic in `server.js` using per-metric thresholds from `printers.csv` |
| DynamoDB `PrinterProfiles` table | in-memory profiles with `state.json` persistence |
| API Gateway `GET /printers`, `GET /printers/{PrinterId}/events` | identical endpoints on `localhost:3001` ("published to CloudWatch" output -> `/api/stats`) |

## Run

```bash
node dataset-backend/server.js          # API on http://localhost:3001
python replay_dataset.py --post http://localhost:3001/api/telemetry --mode loop --speed 1
npm start --prefix printer-dashboard    # http://localhost:3000
```

## Anomaly logic (mirrors `printer-backend/lambda_function.py`)

Each replayed reading is checked against its printer's machine-specific
thresholds from `printers.csv` (temperature, vibration, rpm, power, humidity,
ink, paper stock, paper jams — identical rules and severities as `alerts.csv`).
A metric that stays out of bounds for `WINDOW` (= 3) *consecutive* readings
fires an anomaly event, increments that printer's `EventCount` (DynamoDB
equivalent), and is stored as an event the dashboard can list — the classic
`OutOfBoundsCount` from the Lambda becomes "metrics out of bounds in the latest
reading".

Offline readings (`status=OFFLINE` / `E-COMM-LOST`) count as a heartbeat loss
and fire `OFFLINE` critical events, just like the heartbeat rows in `alerts.csv`.

## Endpoints

- `GET /printers` — profiles sorted by `EventCount` (like the old Lambda output)
- `GET /printers/:PrinterId/events` — anomaly events for one printer
- `GET /api/stats` — ingestion progress, totals, top printers
- `POST /api/telemetry` — ingest one reading (replay producer)
- `POST /api/reset` — zero counters/events for a fresh run

Environment overrides: `PORT` (default 3001), `ANOMALY_WINDOW` (default 3),
`PRINTERS_CSV`, `STATE_FILE`. Delete `state.json` to start with empty counters.
