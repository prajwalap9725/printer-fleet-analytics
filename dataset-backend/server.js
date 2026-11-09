/**
 * Printer Anomaly Detection Backend — dataset edition.
 *
 * Replaces the AWS stack (IoT Core -> Lambda -> DynamoDB -> API Gateway) with a
 * single local Node server driven by the telemetry dataset:
 *
 *   POST /api/telemetry              <- ingest one reading (feed with replay_dataset.py --post http://localhost:3001/api/telemetry)
 *   GET  /printers                    <- printer profiles sorted by EventCount (same shape as the old Lambda)
 *   GET  /printers/:PrinterId/events  <- anomaly events for one printer
 *   GET  /api/stats                   <- ingestion progress / totals (handy for the demo)
 *   POST /api/reset                   <- clear EventCount/OutOfBounds/events
 *
 * Anomaly logic mirrors printer-backend/lambda_function.py: each reading is
 * compared against the printer's per-metric thresholds from printers.csv.
 * A metric that stays out of bounds for WINDOW consecutive readings fires an
 * anomaly event; EventCount counts the fired events (like the old Lambda).
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const analytics = require('./analytics');
const reports = require('./report');

function envInt(name, fallback) {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const PORT = envInt('PORT', 3001);
const PRINTERS_CSV = process.env.PRINTERS_CSV || path.join(__dirname, '..', 'printers.csv');
const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, 'state.json');
const WINDOW = envInt('ANOMALY_WINDOW', 3); // consecutive out-of-bounds readings before an event fires

// ---------------------------------------------------------------- CSV loading
function parseCsv(file) {
  const text = fs.readFileSync(file, 'utf8').trim();
  const lines = text.split(/\r?\n/);
  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row = {};
    headers.forEach((h, i) => (row[h] = cells[i]));
    return row;
  });
}

// metric key in a telemetry reading -> [printer_csv column(lower|upper)] pair,
// where a side is null if printers.csv has no bound for it on that side.
// Matches exactly the rules used to generate alerts.csv.
const METRIC_RULES = [
  ['temperature_c',   [null, 'max_temperature_c'],                'CRITICAL', 'Temperature above threshold'],
  ['vibration_mm_s',  [null, 'max_vibration_mm_s'],               'CRITICAL', 'Excessive vibration - inspect bearings'],
  ['motor_rpm',       [null, 'max_motor_rpm'],                    'WARNING',  'Motor speed above limit'],
  ['power_kw',        [null, 'max_power_kw'],                     'WARNING',  'Power draw above limit'],
  ['humidity_pct',    ['min_humidity_pct', 'max_humidity_pct'],   'WARNING',  'Humidity outside limits'],
  ['ink_level_pct',   ['min_ink_level_pct', null],                'WARNING',  'Ink level low'],
  ['paper_stock_pct', ['min_paper_stock_pct', null],              'INFO',     'Paper stock low'],
  ['paper_jams',      [null, 'max_paper_jams_per_interval'],      'CRITICAL', 'Repeated paper jams'],
];

// ---------------------------------------------------------------------- state
const csvRows = parseCsv(PRINTERS_CSV);
const profiles = new Map(); // printer_id -> runtime profile

function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

for (const p of csvRows) {
  profiles.set(p.printer_id, {
    csv: p,
    PrinterId: p.printer_id,
    PrinterName: p.printer_name,
    Model: p.model,
    MachineType: p.machine_type,
    Location: p.location,
    EventCount: 0,
    OutOfBoundsCount: 0, // metrics currently out of bounds (for the classic chart bar)
    Consecutive: {},     // metric -> consecutive out-of-bounds readings
    LastReading: null,
    LastEventAt: null,
    // Legacy DynamoDB-style Thresholds pair (used by the old EventChart): the
    // humidity band is the only printer-profile band that has both bounds.
    Thresholds: { Lower: num(p.min_humidity_pct), Upper: num(p.max_humidity_pct) },
    // Full machine-specific threshold profile used for anomaly evaluation
    MetricThresholds: METRIC_RULES.map(([metric, cols, severity]) => ({
      metric,
      severity,
      lower: cols[0] ? num(p[cols[0]]) : null,
      upper: cols[1] ? num(p[cols[1]]) : null,
    })),
    ThresholdSummary: METRIC_RULES.map(([metric, cols]) => {
      const lo = cols[0] ? num(p[cols[0]]) : null;
      const hi = cols[1] ? num(p[cols[1]]) : null;
      if (metric === 'humidity_pct') return `humidity ${lo}–${hi}%`;
      if (metric === 'ink_level_pct') return `ink >= ${lo}%`;
      if (metric === 'paper_stock_pct') return `paper >= ${lo}%`;
      if (metric === 'temperature_c') return `temp <= ${hi}°C`;
      if (metric === 'vibration_mm_s') return `vibration <= ${hi} mm/s`;
      if (metric === 'motor_rpm') return `rpm <= ${hi}`;
      if (metric === 'power_kw') return `power <= ${hi} kW`;
      return `jams <= ${hi}`;
    }).join(' · '),
  });
}

const events = []; // all anomaly events, oldest first
let ingestCount = 0;
let eventSeq = 0;

function persist() {
  const data = {
    ingestCount,
    eventSeq,
    printers: [...profiles.values()].map((p) => ({
      PrinterId: p.PrinterId, EventCount: p.EventCount, OutOfBoundsCount: p.OutOfBoundsCount,
      Consecutive: p.Consecutive, LastEventAt: p.LastEventAt,
    })),
    events: events.slice(-2000),
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(data));
}

function loadPersisted() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    ingestCount = data.ingestCount || 0;
    eventSeq = data.eventSeq || 0;
    for (const s of data.printers || []) {
      const p = profiles.get(s.PrinterId);
      if (p) Object.assign(p, { EventCount: s.EventCount || 0, OutOfBoundsCount: s.OutOfBoundsCount || 0, Consecutive: s.Consecutive || {}, LastEventAt: s.LastEventAt || null });
    }
    for (const e of data.events || []) events.push(e);
    console.log(`[state] restored: ${ingestCount} readings, ${events.length} events`);
  } catch (_) { /* no previous state */ }
}
loadPersisted();
const persistTimer = setInterval(persist, 15000);
persistTimer.unref && persistTimer.unref();

// ----------------------------------------------------------- anomaly detection
function recordEvent(tick) {
  events.push({
    id: `EVT-${String(++eventSeq).padStart(5, '0')}`,
    deviceId: tick.printer_id,
    type: tick.metric,
    timestamp: tick.timestamp || new Date().toISOString(),
    severity: tick.severity,
    value: tick.value,
    threshold: tick.threshold,
    message: tick.message,
    anomalyType: tick.anomalyType,
  });
}

function ingest(raw) {
  const profile = profiles.get(raw.printer_id);
  if (!profile) return { error: `unknown printer ${raw.printer_id}` };

  profile.LastReading = { ...raw, ingestedAt: new Date().toISOString() };
  const csvRow = profile.csv;
  const offline = raw.status === 'OFFLINE' || raw.error_code === 'E-COMM-LOST';
  let breached = 0;

  if (offline) {
    breached = 1;
    const c = (profile.Consecutive.OFFLINE || 0) + 1;
    profile.Consecutive.OFFLINE = c;
    if (c >= WINDOW && c % WINDOW === 0) {
      recordEvent({
        metric: 'OFFLINE', severity: 'CRITICAL',
        message: 'Device offline - no telemetry received',
        timestamp: raw.timestamp, anomalyType: 'OFFLINE', printer_id: raw.printer_id,
      });
      profile.EventCount++;
      profile.LastEventAt = raw.timestamp;
    }
  } else {
    profile.Consecutive.OFFLINE = 0;
    for (const [metric, cols, severity, message] of METRIC_RULES) {
      const value = num(raw[metric]);
      if (value === null) continue;
      const lower = cols[0] ? num(csvRow[cols[0]]) : null;
      const upper = cols[1] ? num(csvRow[cols[1]]) : null;
      const out = (lower !== null && value < lower) || (upper !== null && value > upper);
      let c = profile.Consecutive[metric] || 0;
      if (out) {
        breached++;
        c++;
        profile.Consecutive[metric] = c;
        if (c >= WINDOW && c % WINDOW === 0) {
          recordEvent({
            metric, severity, message,
            timestamp: raw.timestamp,
            anomalyType: raw.anomaly_type || '',
            printer_id: raw.printer_id,
            value,
            threshold: lower !== null && value < lower ? lower : upper,
          });
          profile.EventCount++;
          profile.LastEventAt = raw.timestamp;
        }
      } else {
        profile.Consecutive[metric] = 0;
      }
    }
  }
  profile.OutOfBoundsCount = breached;
  ingestCount++;
  return { EventCount: profile.EventCount, OutOfBoundsCount: breached };
}

// ------------------------------------------------------------------- HTTP API
function send(res, status, body) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : null); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function printersPayload() {
  return [...profiles.values()].map((p) => ({
    PrinterId: p.PrinterId,
    PrinterName: p.PrinterName,
    Model: p.Model,
    MachineType: p.MachineType,
    Location: p.Location,
    EventCount: p.EventCount,
    OutOfBoundsCount: p.OutOfBoundsCount,
    Window: WINDOW,
    Thresholds: p.Thresholds,
    MetricThresholds: p.MetricThresholds,
    ThresholdSummary: p.ThresholdSummary,
    LastEventAt: p.LastEventAt,
    LastReading: p.LastReading,
  })).sort((a, b) => b.EventCount - a.EventCount);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const parts = url.pathname.split('/').filter(Boolean);

  if (req.method === 'OPTIONS') return send(res, 204, '');

  if (req.method === 'POST' && url.pathname === '/api/telemetry') {
    let reading;
    try { reading = await readBody(req); } catch (e) { return send(res, 400, { message: 'invalid JSON body' }); }
    if (!reading) return send(res, 400, { message: 'empty body' });
    const result = ingest(reading);
    if (result.error) return send(res, 404, result);
    return send(res, 200, result);
  }

  if (req.method === 'GET' && url.pathname === '/printers') return send(res, 200, printersPayload());

  if (req.method === 'GET' && parts[0] === 'printers' && parts[1] && parts[2] === 'events') {
    const pid = decodeURIComponent(parts[1]);
    if (!profiles.get(pid)) return send(res, 404, { message: 'No events found for this printer' });
    return send(res, 200, events.filter((e) => e.deviceId === pid).slice().reverse());
  }

  if (req.method === 'GET' && url.pathname === '/api/stats') {
    return send(res, 200, {
      printers: profiles.size,
      readingsIngested: ingestCount,
      eventsFired: events.length,
      lastEvent: events[events.length - 1] || null,
      topPrinters: printersPayload().slice(0, 5).map((p) => ({ PrinterId: p.PrinterId, EventCount: p.EventCount })),
      window: WINDOW,
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/analytics/overview') return send(res, 200, analytics.getOverview());
  if (req.method === 'GET' && url.pathname === '/api/analytics/distributions') return send(res, 200, analytics.getDistributions());
  if (req.method === 'GET' && url.pathname === '/api/analytics/trends') return send(res, 200, analytics.getTrends());
  if (req.method === 'GET' && url.pathname === '/api/analytics/pivot') return send(res, 200, analytics.getPivot());
  if (req.method === 'GET' && url.pathname === '/api/analytics/thresholds') return send(res, 200, analytics.getThresholdRules());
  if (req.method === 'GET' && url.pathname === '/api/analytics/meta') return send(res, 200, analytics.getMeta());

  if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'telemetry' && parts[2]) {
    const printerId = decodeURIComponent(parts[2]);
    const metric = url.searchParams.get('metric') || 'temperature_c';
    try {
      const series = analytics.getPrinterSeries(printerId, metric);
      return send(res, 200, series);
    } catch (e) {
      return send(res, 404, { message: `unknown printer ${printerId} or metric ${metric}` });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/analytics/predict') {
    let body;
    try { body = await readBody(req); } catch (e) { return send(res, 400, { message: 'invalid JSON' }); }
    return send(res, 200, analytics.getPrediction(body || {}));
  }

  if (req.method === 'GET' && url.pathname === '/api/events') {
    const limit = Math.min(100, Number(url.searchParams.get('limit')) || 30);
    return send(res, 200, events.slice(-limit).reverse());
  }

  if (req.method === 'POST' && url.pathname === '/api/reset') {
    for (const p of profiles.values()) {
      p.EventCount = 0; p.OutOfBoundsCount = 0; p.Consecutive = {}; p.LastEventAt = null;
    }
    events.length = 0; ingestCount = 0; eventSeq = 0;
    persist();
    return send(res, 200, { status: 'reset' });
  }

  if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'report' && parts[2]) {
    const pid = decodeURIComponent(parts[2]);
    const profile = profiles.get(pid);
    if (!profile) return send(res, 404, { message: `unknown printer ${pid}` });
    const printerEvents = events.filter((e) => e.deviceId === pid);
    let buf;
    try {
      buf = await reports.printerReportPdf(pid, {
        available: true,
        eventCount: profile.EventCount,
        window: WINDOW,
        lastEventAt: printerEvents.length ? printerEvents[printerEvents.length - 1].timestamp : null,
      });
    } catch (e) {
      console.error('[report] generation failed for', pid, e);
      return send(res, 500, { message: 'PDF generation failed', error: String((e && e.message) || e) });
    }
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': buf.length,
      'Content-Disposition': `attachment; filename="EpicReads_Printer_${pid}_Report.pdf"`,
      'Access-Control-Allow-Origin': '*',
    });
    return res.end(buf);
  }

  send(res, 404, { message: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`[backend] listening on http://localhost:${PORT}`);
  console.log(`[backend] ${profiles.size} printer profiles loaded (anomaly window = ${WINDOW} consecutive out-of-bounds readings)`);
  console.log(`[backend] feed readings with: python replay_dataset.py --post http://localhost:${PORT}/api/telemetry`);
});
