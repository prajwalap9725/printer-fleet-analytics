/**
 * Dataset analytics engine — computes every figure the dashboard shows.
 * Loads printers.csv, telemetry.csv, alerts.csv once at startup and serves
 * KPIs, distributions, trends, pivot tables and prediction scoring.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function parseCsv(file) {
  const text = fs.readFileSync(file, 'utf8').trim();
  const lines = text.split(/\r?\n/);
  const headers = lines[0].split(',');
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row = {};
    headers.forEach((h, i) => (row[h] = cells[i]));
    return row;
  });
  return { headers, rows };
}

function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

const printersCsv = parseCsv(path.join(ROOT, 'printers.csv'));
const telemetryCsv = parseCsv(path.join(ROOT, 'telemetry.csv'));
const alertsCsv = parseCsv(path.join(ROOT, 'alerts.csv'));

const METRICS = [
  { key: 'temperature_c', label: 'Temperature', unit: '°C', min: 0, max: 90 },
  { key: 'humidity_pct', label: 'Humidity', unit: '%', min: 20, max: 95 },
  { key: 'ink_level_pct', label: 'Ink level', unit: '%', min: 0, max: 100 },
  { key: 'paper_stock_pct', label: 'Paper stock', unit: '%', min: 0, max: 100 },
  { key: 'motor_rpm', label: 'Motor RPM', unit: '', min: 0, max: 14000 },
  { key: 'vibration_mm_s', label: 'Vibration', unit: 'mm/s', min: 0, max: 8 },
  { key: 'power_kw', label: 'Power', unit: 'kW', min: 0, max: 55 },
  { key: 'pages_per_min', label: 'Throughput', unit: 'ppm', min: 0, max: 180 },
  { key: 'paper_jams', label: 'Jams', unit: '', min: 0, max: 5 },
];

const SEVERITY_ORDER = { CRITICAL: 0, WARNING: 1, INFO: 2 };

// precompute telemetry rows with numeric fields
const T = telemetryCsv.rows.map((r) => {
  const out = { ...r };
  for (const m of METRICS) out[m.key] = num(r[m.key]);
  out.is_anomaly = num(r.is_anomaly);
  return out;
});

const ALERTS = alertsCsv.rows.map((a) => ({ ...a, value: num(a.value), threshold: num(a.threshold) }));

function avg(arr) {
  const xs = arr.filter((x) => x !== null && !Number.isNaN(x));
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
}

// ---------------------------------------------------------------- overview KPIs
function overviewKpis() {
  const timestamps = [...new Set(T.map((r) => r.timestamp))].sort();
  const anomalies = T.filter((r) => r.is_anomaly === 1);
  const measuring = anomalies.filter((r) => r.status !== 'OFFLINE');
  const kpis = {
    printers: printersCsv.rows.length,
    machines: [...new Set(printersCsv.rows.map((r) => r.model))].length,
    locations: [...new Set(printersCsv.rows.map((r) => r.location))].length,
    readings: T.length,
    window: `${timestamps[0]} → ${timestamps[timestamps.length - 1]}`,
    anomalyPct: ((anomalies.length / T.length) * 100).toFixed(1),
    offlineCount: T.filter((r) => r.status === 'OFFLINE').length,
    alerts: ALERTS.length,
    criticalAlerts: ALERTS.filter((a) => a.severity === 'CRITICAL').length,
    anomalyTypes: {
      OVERHEAT: anomalies.filter((r) => r.anomaly_type === 'OVERHEAT').length,
      VIBRATION_SPIKE: anomalies.filter((r) => r.anomaly_type === 'VIBRATION_SPIKE').length,
      PAPER_JAM_BURST: anomalies.filter((r) => r.anomaly_type === 'PAPER_JAM_BURST').length,
      INK_LEAK_DROP: anomalies.filter((r) => r.anomaly_type === 'INK_LEAK_DROP').length,
      HUMIDITY_SPIKE: anomalies.filter((r) => r.anomaly_type === 'HUMIDITY_SPIKE').length,
      OFFLINE: anomalies.filter((r) => r.anomaly_type === 'OFFLINE').length,
      MOTOR_OVERSPEED: anomalies.filter((r) => r.anomaly_type === 'MOTOR_OVERSPEED').length,
      POWER_SURGE: anomalies.filter((r) => r.anomaly_type === 'POWER_SURGE').length,
    },
    sensors: METRICS.length * printersCsv.rows.length,
  };
  return kpis;
}

// ---------------------------------------------------------------- distributions
function distributions() {
  // anomalies by type
  const byType = {};
  for (const r of T) {
    if (r.is_anomaly === 1) byType[r.anomaly_type || 'UNKNOWN'] = (byType[r.anomaly_type || 'UNKNOWN'] || 0) + 1;
  }
  const statusDist = {};
  for (const r of T) {
    if (r.status) statusDist[r.status] = (statusDist[r.status] || 0) + 1;
  }
  const sevDist = {};
  for (const a of ALERTS) sevDist[a.severity] = (sevDist[a.severity] || 0) + 1;
  const metricDist = {};
  for (const a of ALERTS) metricDist[a.metric] = (metricDist[a.metric] || 0) + 1;
  return { byType, statusDist, sevDist, metricDist };
}

// ---------------------------------------------------------------- trends
function hourlyTrend() {
  // anomaly rate by hour-of-day
  const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, total: 0, anomaly: 0 }));
  for (const r of T) {
    const h = Number(r.timestamp.slice(11, 13));
    const b = buckets[h];
    if (!b) continue;
    b.total++;
    if (r.is_anomaly === 1) b.anomaly++;
  }
  return buckets.map((b) => ({
    hour: b.hour,
    rate: b.total ? (b.anomaly / b.total) * 100 : 0,
    count: b.anomaly,
    readings: b.total,
  }));
}

function dailyTrend() {
  const byDay = new Map();
  for (const r of T) {
    const d = r.timestamp.slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, { day: d, total: 0, anomaly: 0, printing: 0 });
    const e = byDay.get(d);
    e.total++;
    if (r.is_anomaly === 1) e.anomaly++;
    if (r.status === 'PRINTING') e.printing++;
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).map((e) => ({
    ...e, anomalyRate: (e.anomaly / e.total) * 100.0,
  }));
}

// ---------------------------------------------------------------- pivot
function pivot() {
  // rows = printer, cols = status, values = anomaly readings; plus totals
  const printers = printersCsv.rows.map((r) => r.printer_id);
  const statuses = [...new Set(T.map((r) => r.status || 'OFFLINE'))].sort();
  const cells = new Map(); // `${pid}|${status}` -> count
  const totals = new Map();
  for (const r of T) {
    const key = `${r.printer_id}|${r.status || 'OFFLINE'}`;
    cells.set(key, (cells.get(key) || 0) + 1);
    if (r.is_anomaly === 1) {
      const at = `${r.printer_id}|ANOMALY`;
      cells.set(at, (cells.get(at) || 0) + 1);
    }
  }
  const cols = [...statuses, 'ANOMALY'];
  const rows = printers.map((pid) => {
    const row = { Printer: pid };
    let rowTotal = 0;
    for (const c of cols) {
      const v = cells.get(`${pid}|${c}`) || 0;
      row[c] = v;
      rowTotal += v;
    }
    row.Total = rowTotal;
    return row;
  });
  const totalsRow = { Printer: 'Total' };
  for (const c of cols) totalsRow[c] = rows.reduce((s, r) => s + r[c], 0);
  totalsRow.Total = rows.reduce((s, r) => s + r.Total, 0);
  rows.push(totalsRow);
  return { cols, rows };
}

// ---------------------------------------------------------------- prediction
function predictScore(input) {
  /**
   * Transparent, explainable risk model for an input sensor state:
   * risk = Σ out-of-bounds metric severities / total possible, weighted
   * by how much each metric correlates with labelled anomalies in the dataset.
   */
  // compute dataset correlation weight per metric: how discriminative a breach is
  const weights = {};
  for (const m of METRICS) {
    let inAnom = 0, outAnom = 0, inNorm = 0, outNorm = 0;
    for (const r of T) {
      if (r.status === 'OFFLINE' || r[m.key] === null) continue;
      const row = printersCsv.rows.find((p) => p.printer_id === r.printer_id);
      if (!row) continue;
      // machine-specific thresholds
      const bounds = {
        temperature_c: [null, 'max_temperature_c'],
        humidity_pct: ['min_humidity_pct', 'max_humidity_pct'],
        ink_level_pct: ['min_ink_level_pct', null],
        paper_stock_pct: ['min_paper_stock_pct', null],
        motor_rpm: [null, 'max_motor_rpm'],
        vibration_mm_s: [null, 'max_vibration_mm_s'],
        power_kw: [null, 'max_power_kw'],
        pages_per_min: null,
        paper_jams: [null, 'max_paper_jams_per_interval'],
      }[m.key];
      if (!bounds) continue;
      const lower = bounds[0] ? num(row[bounds[0]]) : null;
      const upper = bounds[1] ? num(row[bounds[1]]) : null;
      if (lower === null && upper === null) continue;
      const isOut = (lower !== null && r[m.key] < lower) || (upper !== null && r[m.key] > upper);
      if (isOut && r.is_anomaly === 1) outAnom++;
      if (isOut && r.is_anomaly === 0) outNorm++;
      if (!isOut && r.is_anomaly === 1) inAnom++;
      if (!isOut && r.is_anomaly === 0) inNorm++;
    }
    // lift: P(anomaly | out) / P(anomaly)
    const pAnomOut = outAnom + outNorm ? outAnom / (outAnom + outNorm) : 0;
    const pAnom = (outAnom + outNorm + inAnom + inNorm) ? (outAnom + inAnom) / (outAnom + outNorm + inAnom + inNorm) : 0;
    weights[m.key] = pAnom ? Math.max(0.05, Math.min(4, pAnomOut / pAnom)) : 1;
  }
  // score input
  const BOUND_COLS = {
    temperature_c:   { upper: 'max_temperature_c' },
    humidity_pct:    { upper: 'max_humidity_pct', lower: 'min_humidity_pct' },
    ink_level_pct:   { lower: 'min_ink_level_pct' },
    paper_stock_pct: { lower: 'min_paper_stock_pct' },
    motor_rpm:       { upper: 'max_motor_rpm' },
    vibration_mm_s:  { upper: 'max_vibration_mm_s' },
    power_kw:        { upper: 'max_power_kw' },
    paper_jams:      { upper: 'max_paper_jams_per_interval' },
  };
  let score = 0, maxScore = 0, breached = [];
  for (const m of METRICS.slice(0, 8)) {
    const row = printersCsv.rows.find((p) => p.printer_id === (input.printer_id || 'EPR-001'));
    if (input[m.key] === null || input[m.key] === undefined) continue;
    const bounds = BOUND_COLS[m.key];
    if (!bounds) continue;
    const upper = bounds.upper ? num(row[bounds.upper]) : null;
    const lower = bounds.lower ? num(row[bounds.lower]) : null;
    const v = input[m.key];
    const over = upper !== null && v > upper;
    const under = lower !== null && v < lower;
    const isOut = over || under;
    const limit = over ? upper : under ? lower : null;
    const span = upper !== null && lower !== null ? (upper - lower) : upper !== null ? upper : 1;
    const distance = isOut ? Math.min(1, Math.abs(v - limit) / (span || 1)) : 0;
    maxScore += 1 * weights[m.key];
    if (isOut) {
      score += (0.4 + 0.6 * distance) * weights[m.key];
      breached.push({ metric: m.key, value: v, limit, dir: over ? 'above' : 'below' });
    }
  }
  const riskPct = maxScore ? (score / maxScore) * 100 : 0;
  const level = riskPct > 35 ? 'CRITICAL' : riskPct > 12 ? 'WARNING' : riskPct > 4 ? 'ELEVATED' : 'NORMAL';
  return {
    riskPct: Number(riskPct.toFixed(1)),
    level,
    breached,
    weights: METRICS.slice(0, 8).map((m) => ({ metric: m.key, weight: Number((weights[m.key] || 1).toFixed(2)) })).filter((w) => w.weight > 1),
  };
}

// ---------------------------------------------------------------- threshold rules
function thresholdRules() {
  return printersCsv.rows.map((p) => ({
    printer_id: p.printer_id, printer_name: p.printer_name, model: p.model,
    location: p.location,
    rules: [
      { metric: 'temperature_c', limit: num(p.max_temperature_c), dir: '<=', severity: 'CRITICAL' },
      { metric: 'vibration_mm_s', limit: num(p.max_vibration_mm_s), dir: '<=', severity: 'CRITICAL' },
      { metric: 'paper_jams', limit: num(p.max_paper_jams_per_interval), dir: '<=', severity: 'CRITICAL' },
      { metric: 'motor_rpm', limit: num(p.max_motor_rpm), dir: '<=', severity: 'WARNING' },
      { metric: 'power_kw', limit: num(p.max_power_kw), dir: '<=', severity: 'WARNING' },
      { metric: 'humidity_pct', min: num(p.min_humidity_pct), max: num(p.max_humidity_pct), severity: 'WARNING' },
      { metric: 'ink_level_pct', min: num(p.min_ink_level_pct), severity: 'WARNING' },
      { metric: 'paper_stock_pct', min: num(p.min_paper_stock_pct), severity: 'INFO' },
    ],
  }));
}

// ---------------------------------------------------------------- printer time series
function getPrinterSeries(printerId, metric) {
  if (!T.length || !T.some((r) => r.printer_id === printerId)) throw new Error('unknown printer');
  if (!T[0].hasOwnProperty(metric)) throw new Error('unknown metric');
  const series = T
    .filter((r) => r.printer_id === printerId)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map((r) => ({ t: r.timestamp, v: r[metric], anom: r.is_anomaly }));
  return { printer_id: printerId, metric, series };
}

// ---------------------------------------------------------------- assembly export
const cache = { started: Date.now() };

function getOverview() { return overviewKpis(); }
function getDistributions() { return distributions(); }
function getTrends() { return { hourly: hourlyTrend(), daily: dailyTrend() }; }
function getPivot() { return pivot(); }
function getPrediction(input) { return predictScore(input); }
function getThresholdRules() { return thresholdRules(); }
function getMeta() {
  return {
    datasetRows: T.length,
    alertRows: ALERTS.length,
    printerRows: printersCsv.rows.length,
    metrics: METRICS,
    computationMs: Date.now() - cache.started,
  };
}

module.exports = {
  getOverview, getDistributions, getTrends, getPivot, getPrediction,
  getThresholdRules, getMeta, getPrinterSeries, T, ALERTS, METRICS, printersCsv,
};
