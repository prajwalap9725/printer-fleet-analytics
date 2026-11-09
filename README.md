# Project 27 — Ensuring Operational Excellence with IoT Monitoring at EpicReads

A real-time anomaly-detection and analytics system for EpicReads' fleet of 8 industrial
printing machines, built entirely on the project dataset (`printers.csv`,
`telemetry.csv`, `alerts.csv`). It replaces the original AWS IoT → Lambda → DynamoDB →
API Gateway pipeline with an equivalent local stack that replays the dataset as live
IoT traffic, so the whole cloud architecture runs and can be demonstrated without any
AWS account.

## What it does

- **Ingests** telemetry readings as live IoT messages (replayed from the dataset).
- **Detects anomalies** against each machine's own thresholds (temperature, vibration,
  motor RPM, power, humidity, ink, paper stock, paper jams) — a metric that stays out
  of bounds for 3 consecutive readings fires an event, mirroring the original
  Lambda's `EventCount` / `OutOfBoundsCount` logic.
- **Alerts** with CRITICAL / WARNING / INFO severities, matching `alerts.csv`.
- **Visualizes** everything in a dark-themed analytics dashboard with 5 sections:
  Overview, Anomaly Detection, Telemetry Explorer, Prediction and Live Monitor.
- **Predicts** anomaly risk for any simulated sensor state using lift weights learned
  from the labelled dataset.

## Architecture

```
printers.csv  telemetry.csv  alerts.csv         (the dataset)
        │            │
        │            ▼
        │   replay_dataset.py  ──── HTTP POST /api/telemetry (reads as live IoT messages)
        │            │
        ▼            ▼
┌─────────────────────────────────────────────────────────┐
│  dataset-backend/server.js   (local "cloud" backend)    │
│  • anomaly engine  ( = AWS Lambda anomaly_detector )    │
│  • printer profiles ( = DynamoDB PrinterProfiles )      │
│  • REST API         ( = API Gateway)                    │
│  • analytics.js     (KPIs, trends, pivot, prediction)   │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
        printer-dashboard  (React + TypeScript + Chart.js)
        dark-themed, 5 sections, live-refreshing
```

The original AWS artifacts (IoT rule, IAM roles, Lambda, `infra.yaml`) are preserved
untouched in `printer-backend/` and `printer-dashboard/infra.yaml` if you want to
deploy the real AWS version.

## Project structure

| Path | Purpose |
| --- | --- |
| `printers.csv` | 8 machines with their machine-specific thresholds |
| `telemetry.csv` | 6,912 labelled readings (3 days × 8 printers, 5-min interval) |
| `alerts.csv` | 346 generated threshold-breach alerts with severities |
| `generate_dataset.py` | Regenerates the three CSVs (seed 27) |
| `replay_dataset.py` | Replays `telemetry.csv` as live IoT messages |
| `dataset-backend/server.js` | Anomaly-detection backend + REST API (zero dependencies) |
| `dataset-backend/analytics.js` | Dataset analytics: KPIs, distributions, trends, pivot, prediction |
| `printer-dashboard/` | React + TypeScript + Chart.js dashboard |
| `printer-backend/` | Original AWS version (Lambda, IoT rule, IAM policy) — unchanged |

## Running the project

Prerequisites: Node.js ≥ 18 and Python 3. No AWS account needed.

**Terminal 1 — backend (the "cloud"):**
```bash
node dataset-backend/server.js
```
Listens on `http://localhost:3001`, loads `printers.csv`, persists counters to
`dataset-backend/state.json` (delete it for a fresh start).

**Terminal 2 — dataset replay (the "IoT devices"):**
```bash
python replay_dataset.py --post http://localhost:3001/api/telemetry --mode loop --speed 2
```
Streams every reading as live traffic, one tick every 2 s, looping forever.
(`--speed 0` replays as fast as possible; `--speed 5` slows it down.)

**Terminal 3 — dashboard:**
```bash
npm start --prefix printer-dashboard
```
Open `http://localhost:3000` after "Compiled successfully!". The dashboard talks to
`http://localhost:3001` by default; override with `REACT_APP_API_BASE`.

Type-check the dashboard (from the project root):
```bash
npm --prefix printer-dashboard exec -- tsc --noEmit -p printer-dashboard
```
(Or `npx tsc --noEmit -p .` from inside `printer-dashboard/`. From the root, bare
`npx tsc` would grab an unrelated npm package called `tsc` — don't.)

## Dashboard sections

1. **Overview** — KPI cards (readings, anomaly rate, alerts, critical alerts,
   offline readings), anomaly-by-episode-type and status-distribution charts, daily
   and hourly anomaly-rate trends, severity breakdown, and an OLAP pivot table
   (printer × status with anomaly counts and totals).
2. **Anomaly Detection** — every printer's machine-specific threshold rules with
   severity badges, breaches-by-metric chart, and a 24-hour heat strip showing when
   anomalies strike.
3. **Telemetry Explorer** — time series for any printer × any sensor, with the
   dataset's labelled anomalies painted as red points.
4. **Prediction** — 8 interactive sensor sliders; the backend scores risk using lift
   weights learned from the labelled data (P(anomaly | breach) ÷ P(anomaly)) against
   the selected printer's own limits, and lists breached thresholds.
5. **Live Monitor** — live-ingestion counters, streaming anomaly-event table, top
   offenders, auto-refresh toggle and counter reset, fed by the running replay.

## REST API

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/telemetry` | Ingest one telemetry reading (used by the replay) |
| `GET` | `/printers` | Printer profiles sorted by `EventCount` (as the old Lambda output) |
| `GET` | `/printers/:PrinterId/events` | Anomaly events for one printer |
| `GET` | `/api/events` | Recent anomaly events across the fleet |
| `GET` | `/api/stats` | Live ingestion counters and top printers |
| `POST` | `/api/reset` | Zero the live counters and events |
| `GET` | `/api/analytics/overview` | Dataset KPIs |
| `GET` | `/api/analytics/distributions` | Anomaly/status/severity/metric distributions |
| `GET` | `/api/analytics/trends` | Hourly and daily anomaly-rate trends |
| `GET` | `/api/analytics/pivot` | Printer × status pivot table |
| `GET` | `/api/analytics/thresholds` | Machine-specific threshold rules |
| `GET` | `/api/telemetry/:printer?metric=…` | Time series for one printer + metric |
| `POST` | `/api/analytics/predict` | Risk score for a simulated sensor state |
| `GET` | `/api/analytics/meta` | Dataset metadata (row counts, metric list) |

## Anomaly-detection rules (mirroring `printer-backend/lambda_function.py`)

For each reading, every metric is compared against the printer's own bounds from
`printers.csv`:

| Metric | Bound | Severity |
| --- | --- | --- |
| `temperature_c` | ≤ `max_temperature_c` | CRITICAL |
| `vibration_mm_s` | ≤ `max_vibration_mm_s` | CRITICAL |
| `paper_jams` | ≤ `max_paper_jams_per_interval` | CRITICAL |
| `motor_rpm` | ≤ `max_motor_rpm` | WARNING |
| `power_kw` | ≤ `max_power_kw` | WARNING |
| `humidity_pct` | `min_humidity_pct` … `max_humidity_pct` | WARNING |
| `ink_level_pct` | ≥ `min_ink_level_pct` | WARNING |
| `paper_stock_pct` | ≥ `min_paper_stock_pct` | INFO |
| heartbeat | offline readings (`E-COMM-LOST`) | CRITICAL |

A metric breaching its bound for **3 consecutive readings** (`ANOMALY_WINDOW`
env var) fires an anomaly event and increments that printer's `EventCount` —
the exact `OutOfBoundsCount → EventCount` behaviour of the original Lambda.

## Verification

- Full single-pass replay of all 6,912 readings produced 97 anomaly events, consistent
  with the dataset's labelled anomaly episodes.
- Live replay verified end-to-end: readings ingest, events fire, dashboard refreshes.
- Prediction verified in both directions: healthy state → 0% NORMAL (no false
  breaches); all-breaches state → ~47% CRITICAL with a per-metric breach table.
- Dashboard type-checks cleanly (`tsc --noEmit` exit 0).

## Environment variables

| Variable | Default | Used by |
| --- | --- | --- |
| `PORT` | `3001` | backend |
| `ANOMALY_WINDOW` | `3` | backend (consecutive readings before an event) |
| `PRINTERS_CSV` | `../printers.csv` | backend |
| `STATE_FILE` | `./state.json` | backend |
| `REACT_APP_API_BASE` | `http://localhost:3001` | dashboard |
# printer-fleet-analytics
