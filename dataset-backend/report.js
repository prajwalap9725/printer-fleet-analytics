/**
 * Individual Printer PDF Report generator.
 *
 * All figures come from the same dataset views the dashboard uses
 * (analytics.js exports): telemetry.csv rows (T), alerts.csv rows (ALERTS),
 * printers.csv profiles (printersCsv). Nothing is hardcoded or randomised.
 *
 * Three distinct anomaly counts are reported and clearly distinguished:
 *   - labelled anomalous READINGS   (telemetry.csv is_anomaly = 1, ground truth)
 *   - raw threshold-breach READINGS (any sensor out of its printers.csv bounds)
 *   - DETECTED anomaly EVENTS       (live 3-consecutive-reading detector state)
 */
'use strict';

const PDFDocument = require('pdfkit');
const analytics = require('./analytics');

const { T, ALERTS, printersCsv } = analytics;

// Machine-specific threshold columns in printers.csv for each sensor (mirrors
// server.js METRIC_RULES so breaches match the alerts.csv generation logic).
const METRICS = [
  { key: 'temperature_c',   label: 'Temperature', unit: '°C',    upper: 'max_temperature_c',            sev: 'CRITICAL' },
  { key: 'humidity_pct',    label: 'Humidity',    unit: '%',     upper: 'max_humidity_pct',    lower: 'min_humidity_pct', sev: 'WARNING' },
  { key: 'ink_level_pct',   label: 'Ink level',   unit: '%',                                  lower: 'min_ink_level_pct',  sev: 'WARNING' },
  { key: 'paper_stock_pct', label: 'Paper stock', unit: '%',                                  lower: 'min_paper_stock_pct', sev: 'INFO' },
  { key: 'motor_rpm',       label: 'Motor RPM',   unit: 'rpm',   upper: 'max_motor_rpm',                sev: 'WARNING' },
  { key: 'vibration_mm_s',  label: 'Vibration',   unit: 'mm/s',  upper: 'max_vibration_mm_s',           sev: 'CRITICAL' },
  { key: 'power_kw',        label: 'Power',       unit: 'kW',    upper: 'max_power_kw',                 sev: 'WARNING' },
  { key: 'pages_per_min',   label: 'Throughput',  unit: 'ppm' },
  { key: 'paper_jams',      label: 'Paper jams',  unit: 'count', upper: 'max_paper_jams_per_interval',  sev: 'CRITICAL' },
];

const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const fmt = (x, d = 1) => (x === null || x === undefined ? '—' : Number(x).toFixed(d));
const fmtTS = (t) => (!t ? '—' : t.replace('T', ' ').replace('Z', ''));

// ------------------------------------------------------------------ report data
function buildReportData(printerId, live) {
  const csv = printersCsv.rows.find((r) => r.printer_id === printerId);
  if (!csv) return null;

  const rows = T.filter((r) => r.printer_id === printerId).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  if (!rows.length) return null;
  const alerts = ALERTS.filter((a) => a.printer_id === printerId).sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const timestamps = rows.map((r) => r.timestamp).sort();
  const labelled = rows.filter((r) => r.is_anomaly === 1);
  const last = rows[rows.length - 1];

  // per-sensor stats + raw breach counts (OFFLINE rows carry null sensor values)
  const sensors = METRICS.map((m) => {
    const vs = rows.filter((r) => r.status !== 'OFFLINE' && r[m.key] !== null).map((r) => r[m.key]);
    const min = vs.length ? Math.min(...vs) : null;
    const max = vs.length ? Math.max(...vs) : null;
    const mean = vs.length ? vs.reduce((s, x) => s + x, 0) / vs.length : null;

    let breaches = 0;
    if (rows.length) {
      const upper = m.upper ? num(csv[m.upper]) : null;
      const lower = m.lower ? num(csv[m.lower]) : null;
      for (const r of rows) {
        if (r.status === 'OFFLINE' || r[m.key] === null) continue;
        if ((upper !== null && r[m.key] > upper) || (lower !== null && r[m.key] < lower)) breaches++;
      }
    }
    return {
      ...m,
      lower: m.lower ? num(csv[m.lower]) : null,
      upper: m.upper ? num(csv[m.upper]) : null,
      min, max, mean,
      current: last ? last[m.key] : null,
      breaches,
    };
  });

  const breachReadings = rows.filter((r) => r.status !== 'OFFLINE' && sensors.some((s) => {
    if (r[s.key] === null || (s.upper === null && s.lower === null)) return false;
    return (s.upper !== null && r[s.key] > s.upper) || (s.lower !== null && r[s.key] < s.lower);
  })).length;

  const types = {};
  for (const r of labelled) types[r.anomaly_type || 'UNKNOWN'] = (types[r.anomaly_type || 'UNKNOWN'] || 0) + 1;

  const statusCounts = {};
  for (const r of rows) statusCounts[r.status || 'OFFLINE'] = (statusCounts[r.status || 'OFFLINE'] || 0) + 1;

  return {
    printer: {
      id: csv.printer_id, name: csv.printer_name, model: csv.model, type: csv.machine_type,
      location: csv.location, installed: csv.install_date,
      status: last ? last.status : '—',
    },
    period: `${fmtTS(timestamps[0])} to ${fmtTS(timestamps[timestamps.length - 1])}`,
    generatedAt: fmtTS(new Date().toISOString()),
    readings: rows.length,
    labelledReadings: labelled.length,
    labelledPct: (labelled.length / rows.length) * 100,
    breachReadings,
    sensors,
    types,
    statusCounts,
    alerts,
    alertCount: alerts.length,
    criticalAlerts: alerts.filter((a) => a.severity === 'CRITICAL').length,
    detectedEvents: live.eventCount,
    detectedEventsAvailable: live.available,
    eventWindow: live.window,
    lastEventAt: live.lastEventAt,
  };
}

// ------------------------------------------------------------------ summary
function recommendations(d) {
  const out = [];

  if (d.labelledPct >= 8) out.push(`This printer shows an elevated labelled-anomaly rate of ${fmt(d.labelledPct)}% against a fleet-wide 6.0%.`);
  else if (d.labelledPct > 0) out.push(`This printer shows a labelled-anomaly rate of ${fmt(d.labelledPct)}%, in line with the fleet-wide 6.0%.`);
  else out.push('This printer recorded no labelled anomalous readings across the monitoring period.');

  const s = (key) => d.sensors.find((x) => x.key === key);

  const temp = s('temperature_c');
  const vib = s('vibration_mm_s');
  const rpm = s('motor_rpm');
  const power = s('power_kw');
  const hum = s('humidity_pct');
  const ink = s('ink_level_pct');
  const paper = s('paper_stock_pct');
  const jams = s('paper_jams');
  const offline = d.statusCounts.OFFLINE || 0;

  if (temp && temp.breaches > 0) out.push(`Temperature was out of bounds on ${temp.breaches} reading(s) (limit ${fmt(temp.upper)} °C, max seen ${fmt(temp.max)} °C). Recommend checking the cooling system and ventilation of ${d.printer.location}.`);
  if (vib && vib.breaches > 0) out.push(`Vibration was out of bounds on ${vib.breaches} reading(s) (limit ${fmt(vib.upper)} mm/s, max seen ${fmt(vib.max)} mm/s). Recommend inspecting mechanical components such as bearings, mounts and drive belts.`);
  if (rpm && rpm.breaches > 0) out.push(`Motor speed exceeded its limit on ${rpm.breaches} reading(s) (limit ${fmt(rpm.upper, 0)} rpm, max seen ${fmt(rpm.max, 0)} rpm). Recommend verifying drive settings and motor load.`);
  if (power && power.breaches > 0) out.push(`Power draw exceeded its limit on ${power.breaches} reading(s) (limit ${fmt(power.upper)} kW, max seen ${fmt(power.max)} kW). Recommend checking electrical load and supply stability.`);
  if (hum && hum.breaches > 0) out.push(`Humidity fell outside the ${fmt(hum.lower, 0)}–${fmt(hum.upper, 0)}% band on ${hum.breaches} reading(s). Recommend reviewing site climate control.`);
  if (jams && jams.breaches > 0) out.push(`Paper jams exceeded ${fmt(jams.upper, 0)} per interval on ${jams.breaches} reading(s). Recommend checking feed rollers and media quality.`);
  if (ink && ink.breaches > 0) out.push(`Ink level dropped below the ${fmt(ink.lower)}% floor on ${ink.breaches} reading(s) (min seen ${fmt(ink.min)}%). Recommend scheduling ink replenishment.`);
  if (paper && paper.breaches > 0) out.push(`Paper stock dropped below the ${fmt(paper.lower)}% floor on ${paper.breaches} reading(s) (min seen ${fmt(paper.min)}%). Recommend replenishing paper stock.`);
  if (offline > 0) out.push(`${offline} reading(s) were logged with the machine OFFLINE. Recommend investigating connectivity or power availability during those windows.`);

  if (!d.sensors.some((x) => x.breaches > 0) && offline === 0) {
    out.push('No sensor breached its configured threshold limits in this dataset — the printer operated within normal bounds. Continue routine monitoring.');
  }

  out.push('Note: recommendations are rule-based responses to threshold breaches present in the monitored data. They are maintenance suggestions, not confirmed diagnoses.');
  return out;
}

// ------------------------------------------------------------------ pdf drawing
const C = {
  ink: '#1a2330', soft: '#5a6a7a', line: '#c9d4df', band: '#eef4f9',
  cyan: '#00838f', red: '#c62828', headerBg: '#0d1524', headerInk: '#ffffff', frag: '#eef4f9',
};
const PAGE_W = 595.28, PAGE_H = 841.89, MX = 40;
const PW = PAGE_W - MX * 2;
const BOTTOM = 772; // content must end above this; footer sits at 784
const FOOTER_Y = 784;

function heading(doc, text, y) {
  doc.fillColor(C.cyan).font('Helvetica-Bold').fontSize(10).text(text.toUpperCase(), MX, y);
  return y + 16;
}

function ensure(doc, cy, needed) {
  if (cy + needed <= BOTTOM) return cy;
  doc.addPage();
  return 50;
}

// generic table; returns bottom y
function table(doc, y, cols, rows, opts = {}) {
  const total = cols.reduce((s, c) => s + c.w, 0);
  const size = opts.size || 8.5;
  doc.fontSize(size);
  y = ensure(doc, y, 24);
  doc.rect(MX, y, total, 16).fill(C.headerBg);
  let cx = MX + 4;
  doc.fillColor(C.headerInk).font('Helvetica-Bold').fontSize(7.6);
  for (const c of cols) {
    doc.text(c.label.toUpperCase(), cx, y + 4.5, { width: c.w - 8, ellipsis: true, lineBreak: true });
    cx += c.w;
  }
  y += 16;
  rows.forEach((cells, ri) => {
    doc.font(opts.bold && opts.bold(cells) ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
    let rh = 8;
    cols.forEach((c, i) => {
      rh = Math.max(rh, doc.heightOfString(String(cells[i]), { width: c.w - 8 }) + 8);
    });
    y = ensure(doc, y, rh);
    if (opts.rowFill && opts.rowFill(cells)) doc.rect(MX, y, total, rh).fill(opts.rowFill(cells));
    else if (ri % 2 === 1) doc.rect(MX, y, total, rh).fill(C.band);
    doc.rect(MX, y, total, rh).lineWidth(0.4).stroke(C.line);
    doc.fillColor(C.ink);
    let cx = MX + 4;
    cols.forEach((c, i) => {
      doc.text(String(cells[i]), cx, y + 4, { width: c.w - 8, ellipsis: true, lineBreak: true });
      cx += c.w;
    });
    y += rh;
  });
  return y + 10;
}

// label/value rows, full width
function kvTable(doc, y, pairs) {
  const wLabel = 168;
  doc.fontSize(8.5);
  pairs.forEach(([k, v], i) => {
    doc.font('Helvetica').fontSize(8.5);
    const rh = Math.max(17, doc.heightOfString(String(v), { width: PW - wLabel - 12 }) + 10);
    y = ensure(doc, y, rh);
    if (i % 2 === 1) doc.rect(MX, y, PW, rh).fill(C.band);
    doc.rect(MX, y, PW, rh).lineWidth(0.4).stroke(C.line);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.soft).text(String(k), MX + 4, y + 4.5, { width: wLabel - 8, ellipsis: true });
    doc.font('Helvetica').fontSize(8.5).fillColor(C.ink).text(String(v), MX + wLabel + 4, y + 4.5, { width: PW - wLabel - 8, ellipsis: true });
    y += rh;
  });
  return y + 8;
}

// vector line chart with optional threshold; returns bottom y
function lineChart(doc, y, data, opts) {
  const { title, unit, threshold } = opts;
  const pts = data.filter((p) => p.v !== null && p.v !== undefined);
  const H = 140;
  y = heading(doc, title + (unit ? ` (${unit})` : ''), y) - 6;

  if (!pts.length) {
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(C.soft)
      .text('No readable data for this sensor on the selected printer.', MX, y + 8);
    return ensure(doc, y + 30, 40) + 30;
  }

  let lo = Math.min(...pts.map((p) => p.v));
  let hi = Math.max(...pts.map((p) => p.v));
  if (threshold !== null && threshold !== undefined) { lo = Math.min(lo, threshold); hi = Math.max(hi, threshold); }
  if (hi === lo) hi = lo + 1;
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const dataMin = Math.min(...pts.map((p) => p.v));
  if (lo < 0 && dataMin >= 0) lo = 0; // keep non-negative sensors on a non-negative baseline

  const padL = 46, padB = 26, padT = 6;
  const gx = MX + padL, gTop = y + padT, gw = PW - padL, gh = H - padT - padB;
  const ys = (v) => gTop + gh - ((v - lo) / (hi - lo)) * gh;
  const xs = (i) => (pts.length === 1 ? gx + gw / 2 : gx + (i / (pts.length - 1)) * gw);

  doc.lineWidth(0.3).strokeColor(C.line);
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4;
    const yy = ys(v);
    doc.moveTo(gx, yy).lineTo(gx + gw, yy).stroke();
    doc.font('Helvetica').fontSize(7).fillColor(C.soft)
      .text(fmt(v, Math.abs(hi) > 200 ? 0 : 1), MX, yy - 3.5, { width: padL - 8, align: 'right' });
  }

  let drawLimitLabel = null;
  if (threshold !== null && threshold !== undefined && threshold >= lo && threshold <= hi) {
    const ty = ys(threshold);
    doc.save();
    doc.moveTo(gx, ty).lineTo(gx + gw, ty);
    doc.dash(3, { space: 2 });
    doc.strokeColor(C.red).lineWidth(1).stroke();
    doc.restore();
    const labelY = ty < gTop + 14 ? ty + 4 : ty - 10; // don't collide with the top tick label
    const lx = gx + gw - 66, lw = 64;
    drawLimitLabel = () => { // drawn after the data line so it stays on top
      doc.save();
      doc.rect(lx - 1, labelY - 1, lw + 2, 10).fill('#ffffff');
      doc.restore();
      doc.font('Helvetica-Bold').fontSize(7.4).fillColor(C.red)
        .text(`limit ${fmt(threshold)}`, lx, labelY, { width: lw, align: 'right' });
    };
  }

  doc.save();
  doc.moveTo(xs(0), ys(pts[0].v));
  for (let i = 1; i < pts.length; i++) doc.lineTo(xs(i), ys(pts[i].v));
  doc.strokeColor('#00838f').lineWidth(1).stroke();
  doc.restore();

  // red dots: labelled anomaly readings that also breach this sensor's limit
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].flag) doc.circle(xs(i), ys(pts[i].v), 1.8).fill(C.red);
  }

  if (drawLimitLabel) drawLimitLabel();

  const step = Math.max(1, Math.floor(pts.length / 6));
  doc.font('Helvetica').fontSize(7).fillColor(C.soft);
  for (let i = 0; i < pts.length; i += step) {
    doc.text(pts[i].t, xs(i) - 26, gTop + gh + 3, { width: 64, align: 'left' });
  }
  doc.text(`${pts.length} plotted readings · red dots = labelled anomaly also breaching this sensor's limit`, gx, gTop + gh + 14, { width: gw, align: 'right' });

  return gTop + gh + padB + 16;
}

// ------------------------------------------------------------------ pdf build
const CHART_KEYS = ['temperature_c', 'vibration_mm_s', 'motor_rpm'];

function writeContent(doc, d) {
  // header band on page 1
  doc.rect(0, 0, PAGE_W, 96).fill(C.headerBg);
  doc.fillColor('#9fb3c8').font('Helvetica').fontSize(8)
    .text('PROJECT 27 - Ensuring Operational Excellence with IoT Monitoring at EpicReads', MX, 14, { width: PW, characterSpacing: 0.4 });
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16.5)
    .text('Individual Printer Performance and Anomaly Report', MX, 30, { width: PW });
  doc.fillColor('#7fe7f2').font('Helvetica-Bold').fontSize(12).text(d.printer.id, MX, 54, { width: 220 });
  doc.fillColor('#c7d5e0').font('Helvetica').fontSize(8.5)
    .text(`${d.printer.name} · ${d.printer.model} · ${d.printer.location}`, MX, 72, { width: PW });

  // ----- Section 1-2: printer info + thresholds
  let y = 112;
  y = heading(doc, 'Printer information', y);
  const stMix = Object.entries(d.statusCounts).map(([k, v]) => `${k} ${v}`).join(', ');
  y = kvTable(doc, y, [
    ['Printer ID', d.printer.id],
    ['Printer name', d.printer.name],
    ['Model', d.printer.model],
    ['Machine type', d.printer.type],
    ['Location', d.printer.location],
    ['Installed', d.printer.installed],
    ['Last recorded status', d.printer.status],
    ['Status mix over period', stMix || '—'],
    ['Total telemetry readings', d.readings.toLocaleString()],
    ['Monitoring period', d.period],
    ['Report generated', d.generatedAt],
  ]);

  y = heading(doc, 'Configured sensor threshold limits', y);
  const thrRows = d.sensors.filter((sr) => sr.upper !== null || sr.lower !== null).map((sr) => ([
    `${sr.label} (${sr.unit || '—'})`,
    sr.lower !== null ? fmt(sr.lower) : '—',
    sr.upper !== null ? fmt(sr.upper) : '—',
    sr.sev || '—',
  ]));
  y = table(doc, y, [
    { label: 'Sensor', w: 150 }, { label: 'Lower limit', w: 76 }, { label: 'Upper limit', w: 76 }, { label: 'Severity', w: 60 },
  ], thrRows);

  // ----- Section 3: sensor performance summary
  y = heading(doc, 'Sensor performance summary', y);
  const statRows = d.sensors.map((sr) => ([
    `${sr.label} (${sr.unit || '—'})`,
    fmt(sr.min), fmt(sr.mean, 2), fmt(sr.max),
    sr.current === null ? '—' : fmt(sr.current),
    String(sr.breaches),
  ]));
  y = table(doc, y, [
    { label: 'Sensor (unit)', w: 128 }, { label: 'Min', w: 60 }, { label: 'Avg', w: 60 },
    { label: 'Max', w: 60 }, { label: 'Last value', w: 62 }, { label: 'Breach readings', w: 92 },
  ], statRows);

  // ----- Section 4: anomaly detection summary (own page, keeps the section intact)
  doc.addPage();
  y = 50;
  y = heading(doc, 'Anomaly detection summary', y);
  const evText = d.detectedEventsAvailable
    ? `${d.detectedEvents} fired by the live detector (window=${d.eventWindow} consecutive readings), last at ${fmtTS(d.lastEventAt)}`
    : 'Not available in this run';
  y = kvTable(doc, y, [
    ['Labelled anomalous readings', `${d.labelledReadings} of ${d.readings} readings (${fmt(d.labelledPct)}%)`],
    ['Raw threshold-breach readings', `${d.breachReadings} readings with at least one sensor out of bounds`],
    ['Anomaly types', Object.entries(d.types).map(([t, c]) => `${t}: ${c}`).join(' · ') || 'None'],
    ['Detected anomaly events', evText],
    ['Alerts in alerts.csv', `${d.alertCount} total · ${d.criticalAlerts} CRITICAL`],
  ]);

  doc.font('Helvetica-Oblique').fontSize(8).fillColor(C.soft);
  const note = 'Counts intentionally differ: labelled readings are dataset ground-truth episodes; breach readings are raw out-of-bounds values; detected events are spawned only after one metric stays out of bounds for 3 consecutive readings.';
  doc.text(note, MX, y, { width: PW });
  y += doc.heightOfString(note, { width: PW }) + 10;

  // ----- Section 5: charts (flow right after the anomaly summary)
  y = heading(doc, 'Sensor performance graphs', y);
  const allRows = T.filter((r) => r.printer_id === d.printer.id).sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  for (const key of CHART_KEYS) {
    const s = d.sensors.find((x) => x.key === key);
    const rowsK = allRows.filter((r) => r.status !== 'OFFLINE' && r[key] !== null);
    const stride = Math.max(1, Math.ceil(rowsK.length / 200));
    const sampled = rowsK.filter((_, i) => i % stride === 0);
    const threshold = s ? (s.upper !== null ? s.upper : s.lower) : null;
    const data = sampled.map((r) => ({
      t: r.timestamp.slice(5, 16).replace('T', ' '),
      v: r[key],
      flag: r.is_anomaly === 1 && (
        threshold !== null && ((s.upper !== null && r[key] > s.upper) || (s.lower !== null && r[key] < s.lower))
      ),
    }));
    const title = key === 'temperature_c' ? 'Temperature over time' : key === 'vibration_mm_s' ? 'Vibration over time' : 'Motor RPM over time';
    y = lineChart(doc, y, data, { title, unit: s && s.unit ? s.unit : '', threshold });
    y += 8;
  }

  // ----- Section 6 + 7: alerts, summary (continue on the last chart page)
  if (y + 420 > BOTTOM) { doc.addPage(); y = 50; } // keep the alert table with its heading
  y = heading(doc, 'Alert history', y);
  const MAX_ALERTS = 22;
  if (!d.alerts.length) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(C.ink)
      .text(`No alerts were recorded for ${d.printer.id} in alerts.csv during this monitoring period.`, MX, y + 4);
    y += 34;
  } else {
    const shown = d.alerts.slice(0, MAX_ALERTS);
    const alertRows = shown.map((a) => ([
      fmtTS(a.timestamp).slice(0, 16),
      a.metric || 'heartbeat/OFFLINE',
      a.value === null ? '—' : fmt(a.value),
      a.threshold === null ? '—' : fmt(a.threshold),
      a.severity || '—',
      (a.message || '').replace('Device offline - no telemetry received', 'Device offline — no telemetry received'),
    ]));
    y = table(doc, y, [
      { label: 'Timestamp', w: 88 }, { label: 'Metric', w: 88 }, { label: 'Value', w: 44 },
      { label: 'Threshold', w: 58 }, { label: 'Severity', w: 54 }, { label: 'Message', w: 170 },
    ], alertRows, {
      size: 8,
      rowFill: (cells) => (cells[4] === 'CRITICAL' ? '#fdecea' : null),
    });
    if (d.alerts.length > MAX_ALERTS) {
      doc.font('Helvetica-Oblique').fontSize(8).fillColor(C.soft)
        .text(`Showing latest ${MAX_ALERTS} of ${d.alertCount} alerts, newest first. The full history is available in alerts.csv.`, MX, y + 2);
      y += 22;
    }
  }

  y = heading(doc, 'Summary & recommendations', y);
  doc.font('Helvetica').fontSize(9).fillColor(C.ink);
  for (const rec of recommendations(d)) {
    const h = doc.heightOfString(rec, { width: PW });
    y = ensure(doc, y, h + 4);
    doc.font('Helvetica').fontSize(9).fillColor(C.ink);
    doc.text(rec, MX, y, { width: PW });
    y += h + 5;
  }

  // footers are stamped in makeDoc's pageAdded handler (page count known via pass 1)
}

function makeDoc(d, totalPages) {
  const doc = new PDFDocument({
    size: 'A4', margins: { top: 40, bottom: 40, left: MX, right: MX },
    info: { Title: `EpicReads Printer Report ${d.printer.id}`, Author: 'EpicReads IoT Monitoring' },
  });
  let pageNo = 0;
  if (process.env.DEBUG_FOOTER) console.log('[footer] stamp for', totalPages, 'totalPages');
  const stamp = () => {
    pageNo++;
    if (process.env.DEBUG_FOOTER) console.log('[footer] stamp pageNo', pageNo, 'total', totalPages);
    if (!totalPages) return;
    doc.font('Helvetica').fontSize(7.5).fillColor(C.soft);
    doc.text(`EpicReads - IoT Monitoring - Individual Printer Report - generated ${d.generatedAt}`, MX, FOOTER_Y, { width: PW - 90, height: 10, lineBreak: false });
    doc.text(`Page ${pageNo} of ${totalPages}`, MX + PW - 90, FOOTER_Y, { width: 90, align: 'right', height: 10, lineBreak: false });
  };
  doc.footerStamp = () => pageNo;
  doc.on('pageAdded', stamp);
  stamp(); // constructor page emits no pageAdded event
  writeContent(doc, d);
  return doc;
}

// ------------------------------------------------------------------ endpoints
function printerReportPdf(printerId, live) {
  const data = buildReportData(printerId, live);
  if (!data) return null;
  // Pass 1: generate once (identical content, no footers) just to learn the page count.
  return new Promise((resolve, reject) => {
    const probe = makeDoc(data, null);
    probe.on('data', () => {});
    probe.on('error', reject);
    probe.once('end', () => {
      // Pass 2: regenerate with "Page x of N" footers on every page.
      const doc = makeDoc(data, probe.footerStamp());
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('error', reject);
      doc.once('end', () => resolve(Buffer.concat(chunks)));
      try { doc.end(); } catch (e) { reject(e); }
    });
    try { probe.end(); } catch (e) { reject(e); }
  });
}

module.exports = { buildReportData, printerReportPdf };
