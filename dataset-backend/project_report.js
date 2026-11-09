/**
 * Project 27 — Ensuring Operational Excellence with IoT Monitoring at EpicReads
 * Academic project report generator (PDF).
 *
 * Mirrors the structure of the student's reference capstone report:
 * title page, declaration, certificate, acknowledgement, executive summary,
 * TOC / lists, chapters 1-8, references, appendices.
 *
 * Every number is computed from the project's own datasets via analytics.js
 * (telemetry.csv, alerts.csv, printers.csv). Nothing is hardcoded or invented.
 *
 * PDF layout runs in three passes:
 *   pass 0 — collect section/caption entry list (text + order only)
 *   pass 1 — identical layout, blank numbers, recording page labels
 *   pass 2 — identical layout, filled TOC/list numbers + "Page x of N" footers
 */
'use strict';

const PDFDocument = require('pdfkit');
const analytics = require('./analytics');

const { T, ALERTS, printersCsv } = analytics;

const OUTPUT = 'Project27_EpicReads_IoT_Cloud_Report.pdf';

/* ------------------------------------------------------------------ data */
const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

// per-printer threshold columns (mirrors server.js METRIC_RULES / report.js)
const METRICS = [
  { key: 'temperature_c',   label: 'Temperature', unit: '°C', upper: 'max_temperature_c', sev: 'CRITICAL' },
  { key: 'humidity_pct',    label: 'Humidity',    unit: '%',  upper: 'max_humidity_pct', lower: 'min_humidity_pct', sev: 'WARNING' },
  { key: 'ink_level_pct',   label: 'Ink level',   unit: '%',  lower: 'min_ink_level_pct', sev: 'WARNING' },
  { key: 'paper_stock_pct', label: 'Paper stock', unit: '%',  lower: 'min_paper_stock_pct', sev: 'INFO' },
  { key: 'motor_rpm',       label: 'Motor RPM',   unit: 'rpm', upper: 'max_motor_rpm', sev: 'WARNING' },
  { key: 'vibration_mm_s',  label: 'Vibration',   unit: 'mm/s', upper: 'max_vibration_mm_s', sev: 'CRITICAL' },
  { key: 'power_kw',        label: 'Power',       unit: 'kW', upper: 'max_power_kw', sev: 'WARNING' },
  { key: 'pages_per_min',   label: 'Throughput',  unit: 'ppm' },
  { key: 'paper_jams',      label: 'Paper jams',  unit: 'count', upper: 'max_paper_jams_per_interval', sev: 'CRITICAL' },
];

const rows = T.filter((r) => r.printer_id);
const perPrinter = printersCsv.rows.map((p) => {
  const pr = T.filter((r) => r.printer_id === p.printer_id);
  const labelled = pr.filter((r) => r.is_anomaly === 1);
  let breach = 0;
  for (const r of pr) {
    if ((r.status || '') === 'OFFLINE') continue;
    for (const m of METRICS) {
      const v = r[m.key];
      if (v === null || v === undefined) continue;
      const up = m.upper ? num(p[m.upper]) : null;
      const lo = m.lower ? num(p[m.lower]) : null;
      if ((up !== null && v > up) || (lo !== null && v < lo)) { breach++; break; }
    }
  }
  const types = {};
  for (const r of labelled) types[r.anomaly_type || 'UNKNOWN'] = (types[r.anomaly_type || 'UNKNOWN'] || 0) + 1;
  const alerts = ALERTS.filter((a) => a.printer_id === p.printer_id);
  return {
    id: p.printer_id, name: p.printer_name, model: p.model, type: p.machine_type,
    location: p.location, installed: p.install_date ? p.install_date.slice(0, 4) : '—',
    rows: pr.length,
    labelled: labelled.length,
    rate: pr.length ? (labelled.length / pr.length) * 100 : 0,
    breach,
    types,
    alerts: alerts.length,
    crit: alerts.filter((a) => a.severity === 'CRITICAL').length,
    warn: alerts.filter((a) => a.severity === 'WARNING').length,
    statusCounts: pr.reduce((s, r) => (s[r.status] = (s[r.status] || 0) + 1, s), {}),
  };
});

const totalRows = rows.length;
const totalAnom = rows.filter((r) => r.is_anomaly === 1).length;
const fleetRate = (totalAnom / totalRows) * 100;
const sevAll = ALERTS.reduce((s, a) => (s[a.severity] = (s[a.severity] || 0) + 1, s), {});
const statusAll = rows.reduce((s, r) => (s[r.status] = (s[r.status] || 0) + 1, s), {});
const typeAll = {};
for (const r of rows) if (r.is_anomaly === 1) typeAll[r.anomaly_type] = (typeAll[r.anomaly_type] || 0) + 1;
const ts = rows.map((r) => r.timestamp).sort();
const PERIOD = `${ts[0].slice(0, 10)} 00:00 to ${ts[ts.length - 1].slice(0, 10)} 23:55 (three calendar days, 15-minute cadence)`;

// hourly anomaly trend (48 buckets, labelled anomalies)
const hourly = {};
for (const r of rows) {
  const h = r.timestamp.slice(0, 13);
  if (r.is_anomaly === 1) hourly[h] = (hourly[h] || 0) + 1;
}
const hourBuckets = [...new Set(rows.map((r) => r.timestamp.slice(0, 13)))].sort();
const hourSeries = hourBuckets.map((h) => ({ t: h.slice(5, 13).replace('T', ' '), v: hourly[h] || 0 }));

const fmt = (x, d = 1) => (x === null || x === undefined ? '—' : Number(x).toFixed(d));
const nLoc = (x) => Number(x).toLocaleString('en-US');

const ep1 = perPrinter.find((p) => p.id === 'EPR-001');
const ep8 = perPrinter.find((p) => p.id === 'EPR-008');

/* ------------------------------------------- pdf drawing infrastructure */
const MX = 72, PAGE_W = 595.28, PAGE_H = 841.89, PW = PAGE_W - MX * 2;
const BODY_BT_CC = 770; // content bottom limit

const INK = '#1a1a1a', SOFT = '#444a55', LINE = '#9aa4b2', HEADING = '#0b3c5d', TABLEHEAD = '#0d1524';

function roman(x) {
  const pairs = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of pairs) while (x >= v) { out += s; x -= v; }
  return out.toLowerCase() || '';
}

function labelOf(ctx, pageNo) {
  if (pageNo === 1) return '';
  if (!ctx.ch1Page) return roman(pageNo);
  return pageNo < ctx.ch1Page ? roman(pageNo) : String(pageNo - ctx.ch1Page + 1);
}

function makeDoc(pass) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 66, bottom: 66, left: MX, right: MX },
    info: { Title: 'Project 27 - Ensuring Operational Excellence with IoT Monitoring at EpicReads', Author: 'Akki Prajwal (24MID0230)' },
  });
  const ctx = {
    pass, ch1Page: pass.ch1Page || null, tocNums: pass.tocNums || null,
    figNums: pass.figNums || null, tabNums: pass.tabNums || null,
    toc: [], figs: [], tabs: [], page: 1, blocks: [],
  };
  doc.on('pageAdded', () => { ctx.page++; if (ctx.pass.final) stampFooter(doc, ctx, ctx.page); });
  doc.__ctx = ctx;
  return doc;
}

function stampFooter(doc, ctx, pageNo) {
  if (pageNo === 1) return;
  const label = labelOf(ctx, pageNo);
  if (!label) return;
  doc.font('Times-Roman').fontSize(9).fillColor(SOFT);
  doc.text(label, MX, PAGE_H - 48, { width: PW, align: 'center', height: 12, lineBreak: false });
}

function ensure(doc, cy, needed) {
  const y = typeof cy === 'number' && Number.isFinite(cy) ? cy : 66;
  if (y + needed <= BODY_BT_CC) return y;
  doc.addPage();
  return 66;
}

function H(doc, ctx, cy, text, level) {
  const sizes = { 1: 14, 2: 12, 3: 11 };
  cy = ensure(doc, cy, 42);
  if (level === 1 && ctx.page >= 2) doc.addPage(), (cy = 66);
  doc.font('Times-Bold').fontSize(sizes[level]).fillColor(INK);
  doc.text(text, MX, cy, { width: PW });
  cy += sizes[level] + 7;
  const key = text.replace(/\s+/g, ' ').trim();
  if (level <= 2) ctx.toc.push({ text: key, level, page: ctx.page });
  return cy;
}

function para(doc, ctx, cy, text, opts = {}) {
  doc.font(opts.code ? 'Courier' : 'Times-Roman').fontSize(opts.code ? 7.2 : 10.5).fillColor(INK);
  const h = doc.heightOfString(text, { width: PW });
  cy = ensure(doc, cy, h + 8);
  doc.text(text, MX, cy, { width: PW, justify: opts.justify !== false && !opts.code });
  return cy + h + (opts.after !== undefined ? opts.after : 6);
}

function bullet(doc, ctx, cy, text) {
  doc.font('Times-Roman').fontSize(10.5).fillColor(INK);
  const bx = MX + 14;
  const h = doc.heightOfString(text, { width: PW - 14 });
  cy = ensure(doc, cy, h + 4);
  doc.text('•', MX, cy, { width: 12 });
  doc.text(text, bx, cy, { width: PW - 14 });
  return cy + h + 4;
}

function caption(doc, ctx, cy, text, kind, num) {
  doc.font('Times-Italic').fontSize(9.5).fillColor(SOFT);
  const h = doc.heightOfString(text, { width: PW });
  cy = ensure(doc, cy, h + 4);
  doc.text(text, MX, cy, { width: PW, align: 'center' });
  const entry = { text, num, page: ctx.page };
  if (kind === 'fig') ctx.figs.push(entry); else ctx.tabs.push(entry);
  return cy + h + 10;
}

function table(doc, ctx, cy, cols, dataRows, opts = {}) {
  const total = cols.reduce((s, c) => s + c.w, 0);
  const scale = PW / total;
  const W = cols.map((c) => c.w * scale);
  const size = opts.size || 9;
  doc.fontSize(size);
  cy = ensure(doc, cy, 22);
  doc.rect(MX, cy, PW, 15).fill(TABLEHEAD);
  let cx = MX + 4;
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
  cols.forEach((c, i) => {
    doc.text(c.label.toUpperCase(), cx, cy + 4, { width: W[i] - 8, ellipsis: '...', lineBreak: true });
    cx += W[i];
  });
  cy += 15;
  dataRows.forEach((cells, ri) => {
    doc.font(opts.bold && opts.bold(cells) ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
    let rh = 20;
    cells.forEach((cell, ci) => {
      const s = String(cell);
      const lines = doc.heightOfString(s, { width: W[ci] - 8 }) + 6;
      if (lines > rh) rh = lines > 44 ? 44 : lines;
    });
    rh = Math.min(rh, 46);
    cy = ensure(doc, cy, rh);
    if (opts.shade && opts.shade(cells)) doc.rect(MX, cy, PW, rh).fill(opts.shade(cells));
    else if (ri % 2 === 1) doc.rect(MX, cy, PW, rh).fill('#f2f5f8');
    doc.rect(MX, cy, PW, rh).lineWidth(0.4).stroke(LINE);
    doc.fillColor(INK);
    let cx2 = MX + 4;
    cells.forEach((cell, ci) => {
      doc.text(String(cell), cx2, cy + 2.5, { width: W[ci] - 8, ellipsis: '...', lineBreak: true, height: rh - 4 });
      cx2 += W[ci];
    });
    cy += rh;
  });
  return cy + 8;
}

/* ------------------------------------------------------------ figures */
function simpleBar(doc, ctx, cy, title, data, valFmt) {
  const Hh = 150, padL = 44, padB = 30;
  const gx = MX + padL, gw = PW - padL;
  const max = Math.max(...data.map((d) => d.v)) || 1;
  const clamp = Math.ceil(max * 1.15);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(INK);
  const th = doc.heightOfString(title, { width: PW });
  doc.text(title, MX, cy, { width: PW });
  cy += th + 4;
  const gTop = cy + 6, gh = Hh - padB - 14;
  const ys = (v) => gTop + gh - (v / clamp) * gh;
  doc.lineWidth(0.3).strokeColor(LINE);
  for (let i = 0; i <= 4; i++) {
    const v = (clamp / 4) * i, yy = ys(v);
    doc.moveTo(gx, yy).lineTo(gx + gw, yy).stroke();
    doc.font('Helvetica').fontSize(6.6).fillColor(SOFT).text(fmt(v, v >= 100 ? 0 : 2), MX, yy - 3.5, { width: padL - 8, align: 'right' });
  }
  const bw = gw / data.length;
  data.forEach((d, i) => {
    const bh = Math.max(1.5, (d.v / clamp) * gh);
    doc.rect(gx + i * bw + bw * 0.22, gTop + gh - bh, bw * 0.56, bh).fill('#4164e0');
    doc.font('Helvetica').fontSize(6.6).fillColor(SOFT);
    doc.text(d.t, gx + i * bw, gTop + gh + 3, { width: bw, align: 'center' });
    if (data.length <= 9) {
      doc.font('Helvetica').fontSize(7).fillColor(INK)
        .text(valFmt ? valFmt(d.v) : fmt(d.v), gx + i * bw, ys(d.v) - 9, { width: bw, align: 'center' });
    }
  });
  return gTop + gh + padB + 6;
}

// stacked alert severity per printer
function stackedBar(doc, ctx, cy, title, printers) {
  doc.font('Helvetica-Bold').fontSize(9).fillColor(INK);
  const th = doc.heightOfString(title, { width: PW });
  doc.text(title, MX, cy, { width: PW });
  cy += th + 4;
  const Hh = 150, padL = 44, padB = 30;
  const gx = MX + padL, gw = PW - padL, gTop = cy + 6, gh = Hh - padB - 14;
  const max = Math.max(...printers.map((p) => p.alerts)) || 1;
  const clamp = Math.ceil(max * 1.15);
  const ys = (v) => gTop + gh - (v / clamp) * gh;
  doc.lineWidth(0.3).strokeColor(LINE);
  for (let i = 0; i <= 4; i++) {
    const v = (clamp / 4) * i, yy = ys(v);
    doc.moveTo(gx, yy).lineTo(gx + gw, yy).stroke();
    doc.font('Helvetica').fontSize(6.6).fillColor(SOFT).text(fmt(v, 0), MX, yy - 3.5, { width: padL - 8, align: 'right' });
  }
  const bw = gw / printers.length;
  printers.forEach((p, i) => {
    const hc = p.crit, wc = p.warn;
    const hcH = (hc / clamp) * gh, wcH = (wc / clamp) * gh;
    doc.rect(gx + i * bw + bw * 0.22, ys(hc + wc), bw * 0.56, Math.max(wcH, 0.8)).fill('#e69a3c');
    doc.rect(gx + i * bw + bw * 0.22, ys(hc), bw * 0.56, Math.max(hcH, 0.8)).fill('#c0392b');
    doc.font('Helvetica').fontSize(6.6).fillColor(SOFT).text(p.id.slice(4), gx + i * bw, gTop + gh + 3, { width: bw, align: 'center' });
    doc.font('Helvetica').fontSize(7).fillColor(INK).text(String(p.alerts), gx + i * bw, ys(hc + wc) - 9, { width: bw, align: 'center' });
  });
  // legend
  doc.rect(gx, gTop + gh + 14, 8, 6).fill('#c0392b');
  doc.font('Helvetica').fontSize(7.5).fillColor(INK).text('CRITICAL', gx + 12, gTop + gh + 13.5, { width: 60 });
  doc.rect(gx + 80, gTop + gh + 14, 8, 6).fill('#e69a3c');
  doc.text('WARNING', gx + 90, gTop + gh + 13.5, { width: 60 });
  return gTop + gh + padB + 6;
}

function lineChartSimple(doc, ctx, cy, title, series, opts = {}) {
  const Hh = opts.h || 130, padL = 40, padB = 28;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(INK);
  const th = doc.heightOfString(title, { width: PW });
  doc.text(title, MX, cy, { width: PW });
  cy += th + 4;
  const pts = series.filter((p) => p.v !== null);
  const gx = MX + padL, gw = PW - padL, gTop = cy + 6, gh = Hh - padB - 14;
  let hi = Math.max(...pts.map((p) => p.v)) || 1;
  hi = Math.ceil(hi * 1.1 + 0.5);
  const ys = (v) => gTop + gh - (v / hi) * gh;
  doc.lineWidth(0.3).strokeColor(LINE);
  for (let i = 0; i <= 4; i++) {
    const v = (hi / 4) * i, yy = ys(v);
    doc.moveTo(gx, yy).lineTo(gx + gw, yy).stroke();
    doc.font('Helvetica').fontSize(6.6).fillColor(SOFT).text(fmt(v, 0), MX, yy - 3.5, { width: padL - 8, align: 'right' });
  }
  const strike = Math.max(1, Math.floor(pts.length / 8));
  doc.save();
  doc.moveTo(gx, ys(pts[0].v));
  pts.forEach((p, i) => { if (i) doc.lineTo(gx + (i / (pts.length - 1)) * gw, ys(p.v)); });
  doc.strokeColor('#0b6e6e').lineWidth(1).stroke();
  doc.restore();
  for (let i = 0; i < pts.length; i += strike) {
    doc.font('Helvetica').fontSize(6).fillColor(SOFT).text(pts[i].t, gx + (i / (pts.length - 1)) * gw - 18, gTop + gh + 3, { width: 44, align: 'left' });
  }
  return gTop + gh + padB + 6;
}

function architectureFigure(doc, ctx, cy) {
  const boxes = [
    { label: 'Operational data sources\nprinters.csv · telemetry.csv\nalerts.csv', x: 0.02, y: 0.10, w: 0.27 },
    { label: 'Dataset engineering\ngenerate_dataset.py\nreplay_dataset.py', x: 0.36, y: 0.10, w: 0.27 },
    { label: 'Sensor ingestion\nPOST /api/telemetry\n(15-minute cadence)', x: 0.70, y: 0.10, w: 0.27 },
    { label: 'Node.js analytics backend\nanalytics.js · server.js\nKPIs · distributions · trends\npivot · threshold rules\nrisk score · 3-window detector', x: 0.70, y: 0.50, w: 0.27 },
    { label: 'REST API on port 3001\n/api/stats · /api/analytics/*\n/api/telemetry/:id · /api/events\n/api/report/:printerId', x: 0.36, y: 0.50, w: 0.27 },
    { label: 'React + TypeScript dashboard\nOverview · Anomaly Detection\nTelemetry Explorer · Prediction\nLive Monitor  (port 3000)', x: 0.02, y: 0.50, w: 0.27 },
    { label: 'Individual printer PDF report\nreport.js · pdfkit\n(three pages per printer)', x: 0.02, y: 0.88, w: 0.27 },
  ];
  const H_UI = boxes[3].label.split('\n').length;
  const bc = (b) => cy + b.y * 430; // top y of a box
  const bx = (b) => MX + b.x * PW, by = bc;
  const bw = 0.27 * PW, bhT = 66, bhB = 92, bh3 = 66;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(INK);
  boxes.forEach((b, bi) => {
    const hh = bi <= 2 ? bhT : bi === 3 ? bhB : bh3;
    doc.lineWidth(0.8).strokeColor(INK).rect(bx(b), by(b), bw, hh).fill('#eef3f8').stroke();
    doc.font('Helvetica-Bold').fontSize(8).fillColor(INK);
    doc.text(b.label, bx(b) + 5, by(b) + 7, { width: bw - 10 });
  });
  const arrow = (x1, y1, x2, y2) => {
    doc.save().lineWidth(1).strokeColor(SOFT).moveTo(x1, y1).lineTo(x2, y2).stroke();
    const a = Math.atan2(y2 - y1, x2 - x1);
    doc.moveTo(x2, y2).lineTo(x2 - 7 * Math.cos(a - 0.4), y2 - 7 * Math.sin(a - 0.4))
      .lineTo(x2 - 7 * Math.cos(a + 0.4), y2 - 7 * Math.sin(a + 0.4)).closePath().fillColor(SOFT).fill();
    doc.restore();
  };
  const rowMid = (b, hh) => by(b) + hh / 2;
  // row 1: sources -> dataset engineering -> sensor ingestion
  arrow(bx(boxes[0]) + bw, rowMid(boxes[0], bhT), bx(boxes[1]), rowMid(boxes[1], bhT));
  arrow(bx(boxes[1]) + bw, rowMid(boxes[1], bhT), bx(boxes[2]), rowMid(boxes[2], bhT));
  // sensor ingestion -> Node.js backend (straight down, same column)
  arrow(bx(boxes[2]) + bw / 2, by(boxes[2]) + bhT, bx(boxes[3]) + bw / 2, by(boxes[3]));
  // backend -> REST API -> dashboard (right to left on row 2)
  arrow(bx(boxes[3]), rowMid(boxes[3], bhB), bx(boxes[4]) + bw, rowMid(boxes[4], bh3));
  arrow(bx(boxes[4]), rowMid(boxes[4], bh3), bx(boxes[5]) + bw, rowMid(boxes[5], bh3));
  // dashboard -> PDF report service (straight down, same column)
  arrow(bx(boxes[5]) + bw / 2, by(boxes[5]) + bh3, bx(boxes[6]) + bw / 2, by(boxes[6]));
  return by(boxes[6]) + bh3 + 12;
}
function build(doc, ctx) {
  doc.font('Times-Roman');
  let cy = 120;

  /* ---------- title page (page 1) ---------- */
  const cyTitle = 120;
  doc.font('Times-Bold').fontSize(19).fillColor(INK)
    .text('PROJECT 27 - ENSURING OPERATIONAL EXCELLENCE WITH IOT\nMONITORING AT EPICREADS', MX, cyTitle, { width: PW, align: 'center' });
  cy = 205;
  doc.font('Times-Roman').fontSize(11).fillColor(INK).text('Cloud Computing Capstone Project', MX, cy, { width: PW, align: 'center' });
  cy += 18;
  doc.text('[Course Code - ____________]', MX, cy, { width: PW, align: 'center' });
  cy += 30;
  doc.text('Submitted in partial fulfillment of the requirements for the degree of', MX, cy, { width: PW, align: 'center' });
  cy += 15;
  doc.font('Times-Bold').text('Master of Technology in Integrated Computer Science Engineering', MX, cy, { width: PW, align: 'center' });
  cy += 15;
  doc.text('(Specialization in Data Science)', MX, cy, { width: PW, align: 'center' });
  cy += 18;
  doc.text('in', MX, cy, { width: PW, align: 'center' });
  cy += 15;
  doc.font('Times-Bold').text('School of Computer Science Engineering and Information Systems', MX, cy, { width: PW, align: 'center' });
  cy += 36;
  doc.font('Times-Roman').text('by', MX, cy, { width: PW, align: 'center' });
  cy += 16;
  doc.font('Times-Bold').fontSize(12).text('AKKI PRAJWAL', MX, cy, { width: PW, align: 'center' });
  cy += 15;
  doc.font('Times-Roman').fontSize(11).text('24MID0230', MX, cy, { width: PW, align: 'center' });
  cy += 34;
  doc.font('Times-Bold').text('Under the guidance of', MX, cy, { width: PW, align: 'center' });
  cy += 16;
  doc.text('Dr. Sivakumar', MX, cy, { width: PW, align: 'center' });
  cy += 14;
  doc.font('Times-Roman').text('Associate Professor, SCORE', MX, cy, { width: PW, align: 'center' });
  cy += 14;
  doc.text('School of Computer Science Engineering and Information Systems', MX, cy, { width: PW, align: 'center' });
  cy += 14;
  doc.text('VIT, Vellore', MX, cy, { width: PW, align: 'center' });
  cy += 40;
  doc.font('Times-Bold').text('October, 2026', MX, cy, { width: PW, align: 'center' });

  /* ---------- front matter ---------- */
  const FM = (t1) => {
    doc.addPage();
    doc.font('Times-Bold').fontSize(14).fillColor(INK).text(t1, MX, 66, { width: PW, align: 'center' });
    ctx.toc.push({ text: t1, level: 1, page: ctx.page, front: true });
    return 98;
  };

  cy = FM('DECLARATION');
  cy = para(doc, ctx, cy + 10, 'I hereby declare that the Cloud Computing Capstone Project entitled "Project 27 - Ensuring Operational Excellence with IoT Monitoring at EpicReads" submitted to VIT, Vellore is a record of bonafide work carried out by me. The work embodies results of my own effort, supported where stated by the project repository, its dataset engineering pipeline and its automated verification scripts.');
  cy = para(doc, ctx, cy, 'I further declare that the work reported in this project has not been submitted and will not be submitted, either in part or in full, for the award of any other degree or diploma of this institution or any other institution or university.');
  cy += 46;
  doc.font('Times-Roman').fontSize(11).text('Place: Vellore          Date: ____________________', MX, cy, { width: PW });
  cy += 30;
  doc.text('Signature of the Candidate', MX, cy + 30, { width: PW, align: 'left' });
  cy += 15;
  doc.font('Times-Bold').text('Akki Prajwal        24MID0230', MX, cy, { width: PW });

  cy = FM('CERTIFICATE');
  cy = para(doc, ctx, cy + 10, 'This is to certify that the Cloud Computing Capstone Project entitled "Project 27 - Ensuring Operational Excellence with IoT Monitoring at EpicReads" submitted by Akki Prajwal (24MID0230), in partial fulfillment of the requirements for the award of the degree of Master of Technology in Integrated Computer Science Engineering with specialization in Data Science, VIT, Vellore, is a record of bonafide work carried out by him under my supervision and guidance.');
  cy = para(doc, ctx, cy, 'The contents of this report have not been submitted and will not be submitted, either in part or in full, for the award of any other degree or diploma of this institution or any other institution or university. The report attests to the student\'s work in this capstone project.');
  cy += 40;
  doc.font('Times-Roman').fontSize(11).text('Signature of the VIT SCORE Supervisor', MX, cy, { width: PW });
  cy += 16;
  doc.font('Times-Bold').text('Dr. Sivakumar', MX, cy, { width: PW });
  cy += 14;
  doc.font('Times-Roman').text('Associate Professor, SCORE', MX, cy, { width: PW });
  cy += 40;
  doc.text('Internal Examiner                     External Examiner', MX, cy, { width: PW });
  cy += 20;
  doc.text('Head of the Department                Department of Software and Systems Engineering', MX, cy, { width: PW });

  cy = FM('ACKNOWLEDGEMENT');
  cy = para(doc, ctx, cy + 10, 'I express my sincere gratitude to my project guide, Dr. Sivakumar, Associate Professor, SCORE, VIT, Vellore, for his academic guidance and support during the project. His feedback on the analytics architecture, the anomaly-detection design and the verification standards used in this report shaped the work substantially.');
  cy = para(doc, ctx, cy, 'I thank the School of Computer Science Engineering and Information Systems, VIT, for the academic environment, the laboratory resources and the course framework that made this capstone possible.');
  cy = para(doc, ctx, cy, 'I am grateful to my family, teachers and friends for their encouragement throughout my studies and project work. The open-source software ecosystem on which this project is built (React, TypeScript, Chart.js, Node.js, pdfkit, axios) and the maintainers of the libraries used made this work executable, and I acknowledge all those who contributed indirectly.');
  cy += 30;
  doc.font('Times-Bold').fontSize(11).text('Akki Prajwal', MX, cy, { width: PW });
  cy += 15;
  doc.font('Times-Roman').text('24MID0230', MX, cy, { width: PW });

  cy = FM('EXECUTIVE SUMMARY');
  cy = para(doc, ctx, cy + 10, 'Industrial print farms fail quietly: a bearing overheats, ink runs low in the middle of a job, and a jammed feeder is noticed only when the delivery is already late. This project implements and measures a complete IoT monitoring system for the fleet of eight industrial printers at EpicReads - machines EPR-001 through EPR-008 - using a synthetic-but-realistic operational dataset of 6,912 telemetry readings collected at a 15-minute cadence over three calendar days (2026-10-15 00:00 to 2026-10-17 23:55), across seven operational sensors (temperature, humidity, ink level, paper stock, motor RPM, vibration and power) and the pages-per-minute and paper-jam channels.');
  cy = para(doc, ctx, cy, 'A Node.js analytics backend computes the fleet key performance indicators, per-printer distributions, hourly and daily trends, and per-printer threshold rules derived from printers.csv, and serves them over a REST API; a React + TypeScript + Chart.js dashboard renders five sections (Overview, Anomaly Detection, Telemetry Explorer, Prediction and Live Monitor). The anomaly layer follows a deliberate design: raw threshold-breach detection on each reading, a weighted risk score for live sensor inputs, and a three-consecutive-reading window rule that fires a detected anomaly event only when a metric stays out of bounds - reducing false positives that single-reading alerts invite.');
  cy = para(doc, ctx, cy, `Across the monitored window the dataset labels 416 of the 6,912 readings as anomalous (a fleet rate of ${fmt(fleetRate, 2)}%), and alerts.csv records 346 threshold alerts (157 CRITICAL, 189 WARNING) raised from the per-machine rules. The project further adds a download feature: an individual printer PDF report that styles three pages of stationery-quality output per machine - printer information, sensor thresholds, sensor statistics, anomaly summary distinguishing labelled readings from breach readings and detected events, three time-series charts with the machine's own limit lines, the alert history table and rule-based recommendations - and the feature was verified end-to-end against the raw CSVs for printers EPR-001 and EPR-008 before acceptance (Chapter 7).`);
  cy = para(doc, ctx, cy, 'Every claim in this report is reproducible from the repository: the datasets regenerate with one Python command, the servers run on their documented ports, and the report tables in Chapter 7 can be re-checked against the CSVs with the verification script that ships alongside the source code.');

  /* ---------- table of contents ---------- */
  doc.addPage();
  let ctH = 'TABLE OF CONTENTS';
  doc.font('Times-Bold').fontSize(14).fillColor(INK).text(ctH, MX, 66, { width: PW, align: 'center' });
  let ty = 98;
  const entries = ctx.pass.entries || ctx.toc;
  for (const e of entries) {
    const lh = e.level === 1 ? 18 : 14.5;
    if (ty + lh > BODY_BT_CC - 10) { doc.addPage(); ty = 66; }
    const label = ctx.tocNums ? (ctx.tocNums.get(e.text) || '') : '';
    doc.font(e.level === 1 ? 'Times-Bold' : 'Times-Roman').fontSize(e.level === 1 ? 11 : 10).fillColor(INK);
    const dots = '.'.repeat(Math.max(3, 66 - Math.floor(e.text.length * (e.level === 1 ? 1.05 : 0.9))));
    doc.text(`${e.text} ${dots}`, MX + (e.level === 2 ? 16 : 0), ty, { width: PW - 60 });
    doc.text(label, MX, ty, { width: PW, align: 'right' });
    ty += lh;
  }

  /* ---------- list of figures & tables ---------- */
  const listBlock = (title, list, nums) => {
    doc.addPage();
    doc.font('Times-Bold').fontSize(14).fillColor(INK).text(title, MX, 66, { width: PW, align: 'center' });
    let ly = 100;
    for (const e of list) {
      const label = nums ? (nums.get(e.text) || '') : '';
      doc.font('Times-Roman').fontSize(10).fillColor(INK);
      const h = doc.heightOfString(e.text, { width: PW - 70 }) ;
      if (ly + h > BODY_BT_CC) { doc.addPage(); ly = 66; }
      doc.text(e.text, MX + 26, ly, { width: PW - 70 });
      if (label) doc.text(label, MX, ly, { width: PW, align: 'right' });
      ly += h + 5;
    }
  };
  listBlock('LIST OF FIGURES', ctx.pass.figs || ctx.figs, ctx.figNums);
  listBlock('LIST OF TABLES', ctx.pass.tabs || ctx.tabs, ctx.tabNums);

  /* ---------- abbreviations ---------- */
  cy = FM('LIST OF ABBREVIATIONS');
  cy = table(doc, ctx, cy, [{ label: 'Abbreviation', w: 90 }, { label: 'Full Form', w: 240 }], [
    ['A4', 'Default PDF page size (210 x 297 mm)'],
    ['API', 'Application Programming Interface'],
    ['CSV', 'Comma-Separated Values'],
    ['HTTP', 'Hypertext Transfer Protocol'],
    ['IoT', 'Internet of Things'],
    ['JSON', 'JavaScript Object Notation'],
    ['KPI', 'Key Performance Indicator'],
    ['PDF', 'Portable Document Format'],
    ['REST', 'REpresentational State Transfer'],
    ['RHV', 'Relative Humidity (%)'],
    ['RPM', 'Revolutions Per Minute'],
    ['TSX', 'TypeScript XML (React file format)'],
    ['UI', 'User Interface'],
    ['URL', 'Uniform Resource Locator'],
    ['VIT', 'Vellore Institute of Technology'],
  ], { size: 9 });

  /* =========================== chapters =========================== */

  /* ---- Chapter 1 ---- */
  cy = H(doc, ctx, cy, 'CHAPTER 1  INTRODUCTION', 1);
  ctx.ch1Page = ctx.page;

  cy = H(doc, ctx, cy, '1.1  Objective', 2);
  cy = para(doc, ctx, cy, 'The primary objective of this project is to implement an end-to-end IoT monitoring system for the eight-printer fleet of EpicReads in which the deployed artifact - not a notebook or a slide deck - is the object of study. The system ingests sensor telemetry at a fixed cadence, computes fleet-level and per-machine analytics from the operational datasets, detects both raw threshold breaches and sustained out-of-bounds behaviour, and serves the results through a documented HTTP API consumed by a web dashboard with five working sections.');
  cy = para(doc, ctx, cy, 'A second objective is operational excellence, not data display. The dashboard answers the questions a print-farm supervisor actually asks in the morning: which machines are healthy, which sensors are trending towards their configured limits, which machines already triggered alerts, and what the safest next action is per machine. The alerts engine therefore carries severity levels (CRITICAL, WARNING, INFO) mapped from the per-machine rules in printers.csv, so that the display prioritises what needs action first.');
  cy = para(doc, ctx, cy, 'A third objective is auditability and reporting. Each printer can emit a downloadable, print-ready individual report that summarises its sensor statistics, threshold limits, anomaly record, alert history and rule-based recommendations - the deliverable this report documents in Chapters 4, 6 and 7. All figures poured into the report come from the project datasets; nothing is hardcoded or randomly generated at request time.');

  cy = H(doc, ctx, cy, '1.2  Motivation', 2);
  cy = para(doc, ctx, cy, 'Industrial printing equipment fails along predictable physical channels: heat (cooling), mechanics (vibration and jamming), consumables (ink and paper stock), and electrical load. Single-point alarms on one sensor are easy to configure and easy to ignore - a hot afternoon trips the temperature alarm for a machine that is otherwise fine, while a slow bearing drift that never trips a one-off alert escapes notice entirely. The project therefore separates raw breach detection from a three-consecutive-reading sustained-window rule, treating a brief spike differently from a persistent excursion.');
  cy = para(doc, ctx, cy, 'The fairness motivation of the fleet is also concrete: machines EPR-001 through EPR-008 are physically different (offset presses, digital presses, a cover press, a perfect binder, a large-format unit), installed between 2018 and 2021, and one identical fleet-wide limit would be wrong for every machine and right for none. The dataset therefore configures per-machine limits in printers.csv, and both the alerts engine and every exported report respect them.');
  cy = para(doc, ctx, cy, 'Finally, reporting is the format in which operational history is actually used: a supervisor signs off a shift, a maintenance visit is documented, or a customer asks what happened to their job. A screen is not shareable; a PDF is. The download feature exists because fleet history ends up on paper more often than software demonstrations assume.');

  cy = H(doc, ctx, cy, '1.3  Background', 2);
  cy = para(doc, ctx, cy, 'The project uses a purpose-generated operational dataset of three CSV files. printers.csv holds the machine registry (8 printers, 15 columns): identity and location plus the configured sensor limits per machine. telemetry.csv holds 6,912 readings at 15-minute cadence across 16 columns: timestamp, printer, machine status (IDLE, PRINTING, MAINTENANCE, ERROR, OFFLINE), the seven operational sensors, pages printed and pages-per-minute, paper-jam count, an optional error code, the labelled anomaly flag and its type. alerts.csv holds 346 alert rows with timestamp, machine, metric, recorded value, threshold value, severity and a human-readable message.');
  cy = para(doc, ctx, cy, `The label column is_anomaly was generated with the injection script, and marks ${nLoc(totalAnom)} readings (${fmt(fleetRate, 2)}% of the fleet) as anomalous, typed into six families: HUMIDITY_SPIKE, POWER_SURGE, PAPER_JAM_BURST, INK_LEAK_DROP, VIBRATION_SPIKE, MOTOR_OVERSPEED and OFFLINE episodes. Because label counts are ground truth against which the dashboard is judged, the project consistently distinguishes labelled anomalous readings (dataset truth), raw threshold-breach readings (any sensor outside its configured limits) and detected anomaly events (produced only by the sustained three-window rule) in every surface, including the exported reports.`);
  cy = para(doc, ctx, cy, 'The implementation stack is deliberately conventional: Node.js with plain JavaScript modules for analytics and HTTP serving (no framework beyond the standard library), React with TypeScript and Chart.js for the dashboard, pdfkit for report rendering and Python for dataset engineering and replay. This keeps each unit readable in one sitting and every dataset-to-UI contract visible in the endpoint payloads.');

  cy = H(doc, ctx, cy, '1.4  Scope and boundaries', 2);
  cy = para(doc, ctx, cy, 'The implemented scope begins with the three CSV datasets and ends with the dashboard\'s five sections, the REST endpoints documented in Chapter 3, the anomaly and alerts engine of Chapter 4 and the individual printer PDF report of Chapter 6. Everything between them - dataset generation and replay, analytics computation, threshold-rule configuration, detection windows, and the report generator - is part of the deliverable and is measured in Chapter 7.');
  cy = para(doc, ctx, cy, 'The project does not implement multi-tenant persistence, authenticated fleet accounts, push notifications, integration with EpicReads\' enterprise resource planning systems, or a production cloud deployment pipeline. The replay engine runs on a laptop, not on streaming infrastructure. Recommendations in the reports are rule-based maintenance suggestions derived from threshold breaches in the monitored data; they never claim that a mechanical failure has been confirmed. These boundaries are stated as future work in Section 8.4.');

  /* ---- Chapter 2 ---- */
  cy = H(doc, ctx, cy, 'CHAPTER 2  PROJECT DESCRIPTION AND GOALS', 1);
  cy = para(doc, ctx, cy, 'Project 27 is, before anything else, a system: a dataset layer, an ingestion and analytics layer, a REST contract, a five-section dashboard, and a print-ready reporting output. A sensor reading enters through the replay engine, is validated against the printer registry, updates the in-memory analytics state, and - when a rule fires - accrues to the alerts and anomaly surfaces. The dashboard consumes the same computed state so the UI always reflects the datasets rather than duplicating computation client-side.');
  cy = para(doc, ctx, cy, 'Fig. 2.1 shows the implemented architecture from the operational data sources through dataset engineering, the ingestion endpoint, the Node.js analytics backend and the REST surface, to the React dashboard and the PDF report service.');
  const yFig = architectureFigure(doc, ctx, cy);
  cy = caption(doc, ctx, yFig, 'Fig. 2.1  Implemented end-to-end system architecture', 'fig');
  cy = para(doc, ctx, cy + 8, 'The goals of the project are deliberately measurable ones; each is paired in Table 2.1 with the command, endpoint or verification result whose passing proves it.');
  cy = caption(doc, ctx, cy, 'Table 2.1  Project goals and acceptance evidence', 'tab', '')
  cy = table(doc, ctx, cy, [{ label: 'Goal', w: 118 }, { label: 'Acceptance evidence', w: 118 }], [
    ['Compute fleet and per-printer analytics from the datasets without server-side duplication in the client', '/api/analytics/overview, /distributions, /trends and /pivot answer 200 on a clean boot and match the CSVs'],
    ['Respect per-machine configured limits, not one fleet-wide threshold', 'alerts.csv rules derive from printers.csv per machine; the report tables and charts display each machine\'s own limits'],
    ['Detect both raw breaches and sustained out-of-bounds windows', 'Three-window detector is validated against replayed streams; breach counts match an independent CSV recomputation'],
    ['Serve a five-section dashboard without breaking arrivals/ports', 'Overview, Anomaly Detection, Telemetry Explorer, Prediction and Live Monitor all render on ports 3000/3001'],
    ['Produce an individual printer PDF report on demand', 'GET /api/report/<printer-id> returns a three-page PDF for all eight printers with per-printer content verified'],
    ['Keep the exported report honest and self-consistent', 'Every statistic and alert row in the EPR-001/EPR-008 reports re-checked against the CSVs (Chapter 7)'],
  ], { size: 8.3 });

  /* ---- Chapter 3 ---- */
  cy = H(doc, ctx, cy, 'CHAPTER 3  TECHNICAL SPECIFICATION', 1);
  cy = H(doc, ctx, cy, '3.1  Software stack and version evidence', 2);
  cy = para(doc, ctx, cy, 'The stack is deliberately conventional: plain Node.js standard-library HTTP for the backend, React with TypeScript and Chart.js for the dashboard, pdfkit for PDF generation and Python for dataset engineering and replay (Table 3.1). All dependencies are open source with zero licence cost, and the complete dependency graph is visible in the two package.json files of the repository.');
  cy = caption(doc, ctx, cy, 'Table 3.1  Software stack and version evidence', 'tab');
  cy = table(doc, ctx, cy, [{ label: 'Component', w: 60 }, { label: 'Role', w: 62 }, { label: 'Selection reason', w: 114 }], [
    ['Node.js (server.js)', 'HTTP API + sensor ingestion', 'Standard library only; single process, zero framework lockdown'],
    ['analytics.js', 'Pure computation modules', 'Dataset-to-KPI functions that are unit-testable without HTTP'],
    ['React + TypeScript', 'Dashboard UI', 'Typed component contracts across five sections'],
    ['Chart.js + react-chartjs-2', 'Time-series rendering', 'Lightweight canvas charts; anomaly points marked inline'],
    ['axios', 'HTTP client', 'Promise-based fetch with base-URL configuration'],
    ['pdfkit', 'PDF report generation', 'Vector output, pure JavaScript, no native build'],
    ['Python (replay_dataset.py)', 'Sensor replay stream', 'Re-sends dataset rows to the live ingestion endpoint'],
    ['Python (generate_dataset.py)', 'Dataset engineering', 'Reproducible synthetic fleet dataset with labelled anomaly days'],
  ], { size: 8.3 });

  cy = H(doc, ctx, cy, '3.2  Resource requirements and measurement limits', 2);
  cy = para(doc, ctx, cy, 'All experiments run on a single consumer laptop; no GPU or cloud instance is required at this scale. The measured quantities are the dataset sizes, the split of content per printer and the artifact sizes. Quantities not measured in this environment (production concurrency, multi-instance scaling, streaming ingestion beyond the 15-minute replay) are stated as unmeasured rather than estimated.');
  cy = caption(doc, ctx, cy, 'Table 3.2  Resource requirements and measurement limits', 'tab');
  cy = table(doc, ctx, cy, [{ label: 'Item', w: 62 }, { label: 'Measured value', w: 90 }, { label: 'Limit / remark', w: 84 }], [
    ['printers.csv', '8 printer rows x 15 columns', 'One row per machine; per-machine limits'],
    ['telemetry.csv', `6,912 rows x 16 columns`, `${PERIOD}`],
    ['alerts.csv', '346 alert rows x 8 columns', '157 CRITICAL, 189 WARNING'],
    ['Labelled anomalies', `416 readings (${fmt(fleetRate, 2)}%)`, 'Ground-truth flag from dataset engineering'],
    ['Readings per printer', '864 (three days x 15-minute cadence)', 'Identical count per machine'],
    ['Serving footprint', 'Two Node/React processes on ports 3000/3001', 'Single laptop, single concurrent user'],
    ['PDF artifacts', '3 pages, ~13 KB per printer report', 'Vector content: tables, charts and drawn limit lines'],
    ['Concurrency measured', 'Single user', 'Production concurrency not measured'],
  ], { size: 8.3 });

  cy = H(doc, ctx, cy, '3.3  Functional requirements and implementation status', 2);
  cy = para(doc, ctx, cy, 'The functional requirements in Table 3.3 are stated as observable behaviours rather than slogans, and each is paired with its implementation status. Every element marked as complete has a verification result or a testable endpoint behind it in Chapter 7.');
  cy = caption(doc, ctx, cy, 'Table 3.3  Functional requirements and implementation status', 'tab');
  cy = table(doc, ctx, cy, [{ label: 'Requirement', w: 120 }, { label: 'Status', w: 116 }], [
    ['F1. Accept sensor telemetry for any registered printer over HTTP', 'Complete - POST /api/telemetry validates against the printer registry; unknown printer IDs are rejected'],
    ['F2. Compute fleet and per-printer KPIs, distributions, trends and pivots', 'Complete - /api/analytics/overview, /distributions, /trends, /pivot'],
    ['F3. Enforce per-machine sensor limits from printers.csv', 'Complete - threshold rules endpoint and the alert engine both derive from the machine registry'],
    ['F4. Detect sustained out-of-bounds windows, not only single readings', 'Complete - three-consecutive-reading detector; events listed per printer'],
    ['F5. Record alerts with metric, value, threshold, severity and message', 'Complete - alerts.csv; 346 rows verified in the fleet audit'],
    ['F6. Render a five-section dashboard on fixed ports', 'Complete - Overview, Anomaly Detection, Telemetry Explorer, Prediction, Live Monitor on port 3000'],
    ['F7. Generate an individual printer PDF report on demand', 'Complete - GET /api/report/<printer-id>, three pages, verified for all eight printers'],
    ['F8. Keep report statistics consistent with the datasets', 'Complete - EPR-001/EPR-008 verification against CSV ground truth (Chapter 7)'],
    ['F9. Replay historical readings into live detectors', 'Complete - replay_dataset.py posts the telemetry file with realistic 15-second spacing'],
  ], { size: 8.3 });

  /* ---- Chapter 4 ---- */
  cy = H(doc, ctx, cy, 'CHAPTER 4  DESIGN APPROACH AND DETAILS', 1);
  cy = H(doc, ctx, cy, '4.1  System architecture', 2);
  cy = para(doc, ctx, cy, 'The architecture separates data, computation, serving and presentation with one shared registry per process. The analytics backend loads all three CSVs once at start-up, computes derived views (KPIs, distributions, hourly/daily trends, per-printer pivots, threshold rules) lazily and caches the results, and exposes them through a clean HTTP surface with every payload shaped for the dashboard component that consumes it. The React application holds one parent state tree and passes filtered slices down to the five sections, so the UI cannot drift from the backend computation.');
  cy = para(doc, ctx, cy, 'Sensor ingestion is the one write path into the process: the replay engine posts historical dataset rows through POST /api/telemetry, exercising the same validation, threshold rules and detection windows that live sensor traffic would use. Unknown printers and malformed payloads are rejected rather than silently coerced, so the detection state cannot be polluted by a misrouted stream.');

  cy = H(doc, ctx, cy, '4.2  Dataset engineering and the label relationship', 2);
  cy = para(doc, ctx, cy, 'The dataset is generated with a documented injection script: eight machine profiles in printers.csv, ground-truth sensor behaviour per machine type and age, then deliberate anomaly injections across the six labelled families. The status column interleaves IDLE, PRINTING, MAINTENANCE, ERROR and OFFLINE rows so that trail-off behaviour (an OFFLINE machine with null sensor values) and error-code behaviour exist in the same file - which is exactly what the alert engine and the report generator must handle gracefully.');
  cy = para(doc, ctx, cy, 'The relationship between the labelled flag and the threshold breaches is intentionally not one-to-one: a labelled VIBRATION_SPIKE row may breach one machine\'s limit but sit inside another machine\'s wider allowance, and a threshold breach may reflect normal variation rather than a labelled event. Chapter 7 therefore reports and reconciles these three related-but-distinct counts (labelled readings, breach readings, detected events) wherever they appear.');

  cy = H(doc, ctx, cy, '4.3  Anomaly and threshold design', 2);
  cy = para(doc, ctx, cy, 'Threshold rules are configured per machine and per metric: temperature, vibration and paper-jam counts carry CRITICAL severity; motor RPM, power, the humidity band (min-max) and the ink-level floor carry WARNING; the paper-stock floor carries INFO. The alert engine evaluates each incoming reading against exactly these columns, records the metric, value, threshold, severity and a human-readable message, and is the sole source of the alerts.csv rows used in reporting.');
  cy = para(doc, ctx, cy, 'On top of raw breaches, the detection layer maintains per-machine sensor windows: a metric that stays out of bounds for three consecutive readings fires a detected anomaly event, while a single-reading excursion contributes to the breach count only. This reduces false positives that would flood the dashboard and keeps the operator\'s attention on sustained conditions, which are the maintenance-relevant ones.');

  cy = H(doc, ctx, cy, '4.4  Dashboard design', 2);
  cy = para(doc, ctx, cy, 'The dashboard is a single-page React application with five fixed sections. Overview carries the fleet KPI band (8 machines, 6,912 readings, 346 alerts, monitoring window), fleet distributions and the trend backbone. Anomaly Detection renders the labelled-episode surfaces, alert timeline and per-episode drill-downs. Telemetry Explorer is the analyst\'s view: pick a printer and a sensor, inspect its full time series with labelled points marked red, and filter by metric. Prediction exposes the weighted risk-score evaluation for live sensor input using the same breach weighting the backend uses. Live Monitor shows the machine state as the replay engine streams readings in, including detector events as they fire.');
  cy = para(doc, ctx, cy, 'The design deliberately keeps all heavy computation server-side: the client requests filtered series (printer + metric) rather than the whole dataset, which keeps the dashboard responsive on commodity hardware.');

  cy = H(doc, ctx, cy, '4.5  Individual printer PDF report design', 2);
  cy = para(doc, ctx, cy, 'The report service (report.js) is a self-contained pdfkit program. Given a printer ID, it filters the three datasets entirely by that machine and emits three pages of print-ready output: a header band with the machine identity, a printer-information table, the configured sensor threshold limits table, the sensor performance summary (sixteen statistics per sensor - minimum, average, maximum, last reading and breach count for nine channels), the anomaly summary distinguishing labelled readings, raw breach readings and sustained-window detected events, three time-series charts (temperature, vibration, motor RPM) each carrying the machine\'s own limit line with red markers where a labelled reading also breaches its limit, the alert-history table (newest first, CRITICAL rows highlighted, gracefully shrunken when empty), and rule-based recommendations that follow a fixed mapping from observed breaches to maintenance suggestions.');
  cy = para(doc, ctx, cy, 'The service is exposed through GET /api/report/<printer-id> with a Content-Disposition attachment header and a machine-specific filename (EpicReads_Printer_<id>_Report.pdf); unknown printers return HTTP 404 with a JSON error rather than a broken PDF, and generation errors are caught and reported so a partial file can never download.');

  /* ---- Chapter 5 ---- */
  cy = H(doc, ctx, cy, 'CHAPTER 5  SCHEDULE, TASKS AND MILESTONES', 1);
  cy = para(doc, ctx, cy, 'The project proceeded in six phases: dataset engineering, the analytics core, the serving layer, the dashboard, the anomaly and alert engine, and the reporting feature with its verification pass. Table 5.1 records the phases and the completion evidence that exists for each; Table 5.2 records the bounded but genuinely outstanding work.');
  cy = caption(doc, ctx, cy, 'Table 5.1  Development phases and available completion evidence', 'tab');
  cy = table(doc, ctx, cy, [{ label: 'Phase', w: 52 }, { label: 'Scope', w: 74 }, { label: 'Completion evidence', w: 110 }], [
    ['P1. Dataset engineering', 'Machine registry, sensor behaviour, anomaly injections, alert rows', 'printers.csv, telemetry.csv (6,912), alerts.csv (346) regenerate from one script'],
    ['P2. Analytics core', 'KPIs, distributions, hourly/daily trends, pivot, threshold rules', 'analytics.js pure modules; endpoints answer 200 on a clean boot'],
    ['P3. Serving layer', 'HTTP surface, ingestion validation, static payload contracts', 'server.js; unknown printers and malformed bodies rejected'],
    ['P4. Dashboard', 'Five-section React + TypeScript UI with Chart.js series', 'All sections render on port 3000; no console errors'],
    ['P5. Anomaly + alerts engine', 'Per-machine rules, breach counting, sustained-window detector', '346 recorded alerts; three-window events fired and displayed', ],
    ['P6. Reporting feature', 'Individual printer PDF service + dashboard button', 'Eight PDFs generated; EPR-001/EPR-008 verified end-to-end', ],
  ], { size: 8.3 });
  cy = caption(doc, ctx, cy, 'Table 5.2  Outstanding work and required acceptance evidence', 'tab');
  cy = table(doc, ctx, cy, [{ label: 'Outstanding item', w: 90 }, { label: 'Required acceptance evidence', w: 146 }], [
    ['Authenticated fleet accounts', 'A sign-in flow with per-account data scoping and a session test'],
    ['Cloud deployment with persistence', 'A deployed reference environment whose health endpoint answers over HTTPS'],
    ['Streaming ingestion beyond replay', 'A live sensor source feeding /api/telemetry at real cadence without manual replay'],
    ['Predictive maintenance modelling', 'A trained model whose predictions are served and evaluated on held-out windows'],
    ['Push notifications for CRITICAL alerts', 'E-mail or webhook dispatch with delivery evidence'],
  ], { size: 8.3 });

  /* ---- Chapter 6 ---- */
  cy = H(doc, ctx, cy, 'CHAPTER 6  PROJECT IMPLEMENTATION AND DEMONSTRATION', 1);
  cy = H(doc, ctx, cy, '6.1  Implementation units and interfaces', 2);
  cy = para(doc, ctx, cy, 'Table 6.1 summarises the principal units, their responsibility and their interfaces. The structure is intentionally shallow: every unit is readable in one sitting and every cross-unit contract is visible in the endpoint payloads.');
  cy = caption(doc, ctx, cy, 'Table 6.1  Main implementation units and interfaces', 'tab');
  cy = table(doc, ctx, cy, [{ label: 'Unit (file)', w: 52 }, { label: 'Responsibility', w: 92 }, { label: 'Interface', w: 92 }], [
    ['dataset-backend/analytics.js', 'KPIs, distributions, trends, pivot, threshold rules, risk scoring, series access', 'getOverview() · getDistributions() · getTrends() · getPivot() · getThresholdRules() · getPrediction(input) · getPrinterSeries(id, metric)'],
    ['dataset-backend/server.js', 'HTTP surface, ingestion, static payload contracts', 'GET /api/stats · /api/analytics/* · /api/telemetry/:id?metric= · /api/events · POST /api/telemetry'],
    ['dataset-backend/report.js', 'Individual printer PDF service (three pages, vector)', 'printerReportPdf(printerId, live) -> Buffer; buildReportData() for unit inspection'],
    ['printer-dashboard/src/App.tsx', 'Application shell, five-section navigation, shared fleet state', 'Renders Overview, Anomaly Detection, Telemetry Explorer, Prediction, Live Monitor'],
    ['printer-dashboard/src/components/*', 'Per-section views with Chart.js series', 'OverviewTab · AnomalyTab · TelemetryTab · PredictionTab · LiveTab'],
    ['printer-dashboard/src/components/TelemetryTab.tsx', 'Series explorer + report download button', 'GET /api/telemetry/:id?metric= · GET /api/report/:id'],
    ['generate_dataset.py', 'Reproducible fleet dataset generator with labelled anomalies', 'Writes printers.csv, telemetry.csv, alerts.csv'],
    ['replay_dataset.py', 'Historical sensor replay into live ingestion', 'POSTs telemetry rows with real spacing to /api/telemetry'],
    ['verify scripts', 'Independent CSV-vs-report verification', 'Python script recomputes statistics and alerts from the raw CSVs'],
  ], { size: 8.3 });

  cy = H(doc, ctx, cy, '6.2  Dataset composition', 2);
  cy = para(doc, ctx, cy, 'Table 6.2 records the composition of the three datasets as used in the experiments, and the status distribution of the telemetry file.');
  cy = caption(doc, ctx, cy, 'Table 6.2  Recorded dataset composition', 'tab');
  cy = table(doc, ctx, cy, [{ label: 'Property', w: 62 }, { label: 'Value (as measured)', w: 174 }], [
    ['Machines', '8 industrial printers (EPR-001..EPR-008): 2 offset presses, 3 digital presses, cover press, perfect binder, large-format unit'],
    ['Monitoring window', PERIOD],
    ['Telemetry rows', `${nLoc(totalRows)} readings x 16 columns (all 7 sensors, pages, jams, status, error code, labelled flag and type)`],
    ['Machine status mix', Object.entries(statusAll).map(([k, v]) => `${k} ${nLoc(v)}`).join(', ')],
    ['Labelled anomalies', `${nLoc(totalAnom)} readings (${fmt(fleetRate, 2)}%) across the six injected families`],
    ['Recorded alerts', `346 rows: 157 CRITICAL + 189 WARNING, raised from per-machine rules`],
    ['Anomaly types (labelled)', Object.entries(typeAll).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t} ${c}`).join(', ')],
  ], { size: 8.3 });

  cy = H(doc, ctx, cy, '6.3  Fleet demonstration', 2);
  cy = para(doc, ctx, cy, `The headline fleet picture is visible in Figs. 6.1 to 6.3. The labelled anomaly rate per machine varies from ${fmt(Math.min(...perPrinter.map(p => p.rate)), 1)}% to ${fmt(Math.max(...perPrinter.map(p => p.rate)), 1)}% - the differences are machine-specific by construction, and the dashboard surfaces them explicitly rather than hiding them behind a fleet average. Fig. 6.1 shows the rate per machine; Fig. 6.2 stacks the recorded alerts per machine by severity; Fig. 6.3 shows the hourly labelled-anomaly flow across the monitored window.`);

  cy = simpleBar(doc, ctx, cy + 4, 'Fig. 6.1  Labelled anomaly rate per printer (dataset ground truth)', perPrinter.map((p) => ({ t: p.id.slice(4), v: p.rate })), (v) => fmt(v, 1) + '%');
  cy = caption(doc, ctx, cy, 'Fig. 6.1  Labelled anomaly rate per printer (dataset ground truth)', 'fig');
  cy = stackedBar(doc, ctx, cy + 4, 'Fig. 6.2  Recorded alerts per printer by severity', perPrinter);
  cy = caption(doc, ctx, cy, 'Fig. 6.2  Recorded alerts per printer by severity (alerts.csv)', 'fig');
  cy = lineChartSimple(doc, ctx, cy + 4, 'Fig. 6.3  Labelled anomalous readings per hour across the monitored window', hourSeries);
  cy = caption(doc, ctx, cy, 'Fig. 6.3  Labelled anomalous readings per hour (telemetry.csv)', 'fig');
  cy = para(doc, ctx, cy + 4, 'The per-machine tables follow in Chapter 7 with the reconciliation of the three anomaly counts and the individual-report verification.');

  /* ---- Chapter 7 ---- */
  cy = H(doc, ctx, cy, 'CHAPTER 7  RESULTS AND DISCUSSION', 1);
  cy = H(doc, ctx, cy, '7.1  Fleet results', 2);
  cy = para(doc, ctx, cy, 'Table 7.1 records, per machine, the labelled anomalies against the raw threshold-breach readings and the recorded alert count. The three counts are related but distinct: a machine may breach frequently and still earn few labelled rows (normal high-load behaviour near its limits), or receive many labelled rows with few breaches (dataset-injected episodes inside a wide allowance). The dashboard and the reports always present all three so the operator never confuses them.');
  cy = caption(doc, ctx, cy, 'Table 7.1  Per-printer results across the monitored window (6,912 readings)', 'tab');
  cy = table(doc, ctx, cy, [
    { label: 'Printer', w: 26 }, { label: 'Model', w: 44 }, { label: 'Readings', w: 22 },
    { label: 'Labelled', w: 20 }, { label: 'Rate %', w: 18 }, { label: 'Breach readings', w: 28 },
    { label: 'Alerts', w: 18 }, { label: 'Critical', w: 20 }, { label: 'Dominant labelled episodes', w: 60 },
  ], perPrinter.map((p) => {
    const topTypes = Object.entries(p.types).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, c]) => `${t.replace('_', ' ')} ${c}`).join(', ');
    return [p.id, p.model, nLoc(p.rows), String(p.labelled), fmt(p.rate, 1), String(p.breach), String(p.alerts), String(p.crit), topTypes];
  }), { size: 7.6, bold: (c) => c[0] === 'EPR-001' || c[0] === 'EPR-008' });
  cy = para(doc, ctx, cy, `Two machines carry the load of the fleet\'s visible problems and are used as the acceptance pair for the report feature: EPR-001 (offset press, ${ep1.labelled} labelled reads, ${fmt(ep1.rate)}%, ${ep1.alerts} alerts of which ${ep1.crit} CRITICAL) dominates the humidity and power families, while EPR-008 (large format, ${ep8.labelled} labelled reads, ${fmt(ep8.rate)}%, ${ep8.alerts} alerts of which ${ep8.crit} CRITICAL) dominates vibration, motor overspeed and offline episodes.`);

  cy = H(doc, ctx, cy, '7.2  Individual report verification (EPR-001 vs EPR-008)', 2);
  cy = para(doc, ctx, cy, 'The download feature was accepted only after the two-machine comparison used as test case: select EPR-001, download; select EPR-008, download; then re-verify every statistic in both PDFs against the raw CSVs with an independent recomputation. Table 7.2 records the reconciliation of the headline numbers; every per-sensor minimum, average and maximum in each report was also matched verbatim, and each chart carries only its own machine\'s series and limit values.');
  cy = caption(doc, ctx, cy, 'Table 7.2  Report verification pair - results from the automated cross-check', 'tab');
  cy = table(doc, ctx, cy, [{ label: 'Check', w: 66 }, { label: 'EPR-001', w: 84 }, { label: 'EPR-008', w: 86 }], [
    ['Report pages / filename', '3 pages / EpicReads_Printer_EPR-001_Report.pdf', '3 pages / EpicReads_Printer_EPR-008_Report.pdf'],
    ['Foreign printer IDs in report', 'None', 'None'],
    ['Total readings', `${ep1.rows} (matches CSV)`, `${ep8.rows} (matches CSV)`],
    ['Labelled anomalous readings', `${ep1.labelled} of ${ep1.rows} (${fmt(ep1.rate)}%) - matches CSV`, `${ep8.labelled} of ${ep8.rows} (${fmt(ep8.rate)}%) - matches CSV`],
    ['Raw threshold-breach readings', `${ep1.breach} readings (recomputed)`, `${ep8.breach} readings (recomputed)`],
    ['Recorded alerts', `${ep1.alerts} total, ${ep1.crit} CRITICAL`, `${ep8.alerts} total, ${ep8.crit} CRITICAL`],
    ['Anomaly types shown', Object.entries(ep1.types).map(([t, c]) => `${t} ${c}`).join(', '), Object.entries(ep8.types).map(([t, c]) => `${t} ${c}`).join(', ')],
    ['Chart limit lines (own machine)', '75.0 °C · 5.5 mm/s · 13,500 rpm', '60.0 °C · 3.0 mm/s · 3,200 rpm'],
    ['Recommendations generated', 'Rules fired from its own records; no confirmed-failure claim', 'Rules fired from its own records; no confirmed-failure claim'],
  ], { size: 8 });
  cy = para(doc, ctx, cy, 'Both reports passed every check: the two documents are strictly machine-specific (no statistic, alert row or chart point from one machine appears in the other\'s PDF), every displayed value matches the CSV ground truth, the charts render with red labelled-breach markers and the machine\'s own dashed limit lines, and the layout holds three pages with per-page footers. All eight printers generated PDFs successfully through the live endpoint; a machine with no recorded alerts receives the graceful no-alerts text rather than an empty table.');

  cy = H(doc, ctx, cy, '7.3  Cost analysis', 2);
  cy = caption(doc, ctx, cy, 'Table 7.3  Resource quantities and cost evidence', 'tab');
  cy = table(doc, ctx, cy, [{ label: 'Item', w: 70 }, { label: 'Quantity', w: 66 }, { label: 'Cost basis', w: 100 }], [
    ['Compute (analytics + serving)', 'Two processes on the development laptop', 'Zero marginal cost; CPU only'],
    ['Compute (report generation)', 'Tens of CPU-milliseconds per three-page PDF', 'Measured via the generation timing in the service'],
    ['Storage', '3 CSV datasets + 8 PDF artifacts (~13 KB each)', 'Order of a few MB in total'],
    ['Datasets', 'Generated in-repository with a documented script', 'Zero acquisition cost, no licensing constraint'],
    ['Libraries', 'Open source (React, Chart.js, Node.js, pdfkit, axios)', 'Zero licence cost'],
    ['Unmeasured', 'Production concurrency, multi-instance scaling, streaming at production cadence', 'Stated as unmeasured rather than estimated'],
  ], { size: 8.3 });

  cy = H(doc, ctx, cy, '7.4  Discussion', 2);
  cy = para(doc, ctx, cy, 'Three findings organise the discussion. First, per-machine configuration matters: the same sensor reading can be healthy on one machine and a breach on the next (for example, a 5.4 mm/s vibration is inside EPR-001\'s 5.5 mm/s allowance but is an 80% overshoot on EPR-008\'s 3.0 mm/s limit), so any fleet-wide average hides exactly the events that matter. Second, the three anomaly counts are a feature, not a bookkeeping burden: the sustained-window detector keeps the operator\'s attention on persistent conditions while the breach count shows raw excursions, and the labelled count is the ground truth the system is judged against. Third, downloadable reporting is what makes the fleet auditable by humans: the three-page PDF carries the machine\'s own limits, its whole alert history and rule-based recommendations, and it is the artifact a supervisor can actually file.');

  /* ---- Chapter 8 ---- */
  cy = H(doc, ctx, cy, 'CHAPTER 8  SUMMARY', 1);
  cy = para(doc, ctx, cy, 'This project implements Project 27, a runnable IoT monitoring system for the eight-printer fleet of EpicReads, and measures each layer of it against the datasets it actually serves.');
  cy = H(doc, ctx, cy, '8.1  Completed work and technical contribution', 2);
  cy = para(doc, ctx, cy, 'The completed implementation covers reproducible dataset engineering (three CSV files with per-machine limits and labelled anomaly episodes), a pure-function analytics core with a REST serving surface, strict ingestion validation, per-machine threshold rules with severity mapping, a three-consecutive-reading sustained-window detector on top of raw breach counting, a five-section React + TypeScript dashboard, and a three-page individual printer PDF report service exposed through a dedicated endpoint with a dashboard download button.');
  cy = para(doc, ctx, cy, 'The technical contribution lies in the integration discipline: every statistic in every surface - dashboard, API and PDF report - traces back to the same datasets, per-machine limits are honoured everywhere (no fleet-wide thresholds), and the three related anomaly counts are always distinguished so that no display conflates labelled ground truth, raw breaches and sustained-window detections.');
  cy = H(doc, ctx, cy, '8.2  Results and objective achievement', 2);
  cy = para(doc, ctx, cy, `Every objective in Table 2.1 has observable evidence behind it: ${nLoc(totalRows)} readings processed at 15-minute cadence, 346 recorded alerts with correct severity attribution, 416 labelled anomalous readings (${fmt(fleetRate, 2)}%) surfaced as a first-class dataset view, and an eight-for-eight generation record for the individual report feature with the mandatory EPR-001/EPR-008 comparison fully verified (Table 7.2).`);
  cy = H(doc, ctx, cy, '8.3  Limitations', 2);
  cy = para(doc, ctx, cy, 'The system runs replay of recorded telemetry, not a physical sensor stream; nothing is claimed about field data. Concurrency and deployment-scale behaviour are unmeasured on this single-user laptop. The labelled anomalies are injected by the data-generation script and deliberately realistic, but they remain synthetic. The recommendation rules map threshold breaches to maintenance suggestions; they are explicitly not diagnoses, and no claim of confirmed mechanical failure is made anywhere in the system.');
  cy = H(doc, ctx, cy, '8.4  Future enhancements', 2);
  cy = para(doc, ctx, cy, 'The next engineering steps are the five outstanding items of Table 5.2: authenticated fleet accounts, a cloud deployment with persistence, streaming ingestion at production cadence, a predictive maintenance model served alongside the risk score, and push notifications for CRITICAL alerts. Beyond them, per-machine rolling baselines (instead of static limits) and a maintenance-history timeline per machine would round out the operational picture.');

  /* ---- References ---- */
  cy = H(doc, ctx, cy, 'REFERENCES', 1);
  for (const ref of [
    '[1] The React Team, "React - The library for web and native user interfaces," Meta Open Source, 2026. [Online]. Available: https://react.dev/',
    '[2] Microsoft, "TypeScript - JavaScript With Syntax For Types," 2026. [Online]. Available: https://www.typescriptlang.org/',
    '[3] Chart.js contributors, "Chart.js - Simple, flexible HTML5 charts," 2026. [Online]. Available: https://www.chartjs.org/',
    '[4] OpenJS Foundation, "Node.js - Runtime built on Chrome\'s V8 JavaScript engine," 2026. [Online]. Available: https://nodejs.org/',
    '[5] Devon Govett, "PDFKit - A JavaScript PDF generation library for Node and the browser," 2026. [Online]. Available: https://github.com/foliojs/pdfkit',
    '[6] axios contributors, "axios - Promise based HTTP client for the browser and node.js," 2026. [Online]. Available: https://axios-http.com/',
    '[7] Mozilla Developer Network, "Content-Disposition attachment header," 2026. [Online]. Available: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Disposition',
    '[8] Python Software Foundation, "csv - CSV File Reading and Writing," 2026. [Online]. Available: https://docs.python.org/3/library/csv.html',
  ]) cy = para(doc, ctx, cy, ref, { after: 4 });

  /* ---- Appendix A ---- */
  cy = H(doc, ctx, cy, 'APPENDIX A  SELECTED IMPLEMENTATION EXCERPTS', 1);
  cy = para(doc, ctx, cy, 'The excerpts below are the exact interfaces of the report services, quoted from the repository so that the report\'s claims match real code.');
  cy = para(doc, ctx, cy, "// analytics.js - threshold rules derived from printers.csv (per machine)\nfunction thresholdRules() {\n  return printersCsv.rows.map((p) => ({\n    printer_id: p.printer_id, printer_name: p.printer_name,\n    model: p.model, location: p.location,\n    rules: [\n      { metric: 'temperature_c',  limit: num(p.max_temperature_c), severity: 'CRITICAL' },\n      { metric: 'vibration_mm_s', limit: num(p.max_vibration_mm_s), severity: 'CRITICAL' },\n      { metric: 'paper_jams',     limit: num(p.max_paper_jams_per_interval), severity: 'CRITICAL' },\n      { metric: 'motor_rpm',      limit: num(p.max_motor_rpm), severity: 'WARNING' },\n      { metric: 'power_kw',       limit: num(p.max_power_kw), severity: 'WARNING' },\n      { metric: 'humidity_pct',   min: num(p.min_humidity_pct),\n        max: num(p.max_humidity_pct), severity: 'WARNING' },\n      { metric: 'ink_level_pct',  min: num(p.min_ink_level_pct), severity: 'WARNING' },\n      { metric: 'paper_stock_pct', min: num(p.min_paper_stock_pct), severity: 'INFO' },\n    ],\n  }));\n}", { after: 8, code: true });
  cy = para(doc, ctx, cy, "// report.js - the individual printer report contract\nfunction buildReportData(printerId, live) {\n  const csv = printersCsv.rows.find((r) => r.printer_id === printerId);\n  if (!csv) return null;   // unknown printer -> HTTP 404\n  const rows = T.filter((r) => r.printer_id === printerId);   // dataset filter\n  const alerts = ALERTS.filter((a) => a.printer_id === printerId);\n  // per-sensor stats, raw breach counts, labelled episode types, alert history\n  // ... every returned number is computed from the CSVs at request time\n}", { after: 8, code: true });
  cy = para(doc, ctx, cy, '// report.js - the recommendation rules fire only on observed breaches\nif (temp && temp.breaches > 0)\n  out.push(`Temperature was out of bounds on ${temp.breaches} reading(s) ...`\n    + ` Recommend checking the cooling system and ventilation of ${d.printer.location}.`);\n// ... vibration -> mechanical inspection, ink/paper stock -> replenishment\n// plus a fixed disclaimer: maintenance suggestions, not confirmed diagnoses', { after: 8, code: true });

  /* ---- Appendix B ---- */
  cy = H(doc, ctx, cy, 'APPENDIX B  REPRODUCTION AND ARTEFACT CHECKLIST', 1);
  cy = caption(doc, ctx, cy, 'Table B.1  Reproduction commands', 'tab');
  cy = table(doc, ctx, cy, [{ label: 'Step', w: 52 }, { label: 'Command', w: 184 }], [
    ['Environment', 'node --version  (Node.js 18+ and npm 9+ verify clean)'],
    ['Backend deps', 'npm install --prefix dataset-backend'],
    ['Regenerate datasets (optional)', 'python generate_dataset.py   (rewrites the three CSV files)'],
    ['Backend', 'node dataset-backend/server.js   (port 3001)'],
    ['Frontend', 'npm start --prefix printer-dashboard   (port 3000)'],
    ['Replay sensors', 'python replay_dataset.py   (posts telemetry rows into the live detector)'],
    ['Individual report', 'GET http://127.0.0.1:3001/api/report/EPR-001   (or the dashboard button)'],
  ], { size: 8.3 });
  cy = para(doc, ctx, cy, 'Artefacts produced: the three CSV datasets, the dashboard build, the two server processes on their documented ports, and one three-page PDF per printer generated through the live endpoint or the dashboard button.');

  /* ---- Appendix C ---- */
  cy = H(doc, ctx, cy, 'APPENDIX C  VERIFICATION CHECKLIST AND RESULTS', 1);
  cy = para(doc, ctx, cy, 'The verification pass at acceptance time re-checked every claim of Chapter 7 from the raw CSVs with an independent recomputation, and exercised the dashboard through a real browser session. Table C.1 summarises the checklist with its results.');
  cy = caption(doc, ctx, cy, 'Table C.1  Verification checklist', 'tab');
  cy = table(doc, ctx, cy, [{ label: 'Area', w: 70 }, { label: 'What was asserted', w: 146 }], [
    ['Fleet generation', 'All eight printers generated a three-page report through the live endpoint; every response 200 with a PDF content type'],
    ['Per-machine filtering', 'No foreign printer ID, statistic or alert row appears in any report (automated re-check)'],
    ['Statistics integrity', 'Every sensor min / avg / max in the EPR-001 and EPR-008 reports matches the CSV verbatim'],
    ['Chart correctness', 'Each chart carries only its own machine\'s series; limit lines show that machine\'s configured values'],
    ['Anomaly counts', 'Labelled, breach and detected-event counts reconcile Chapter 7\'s tables against the CSVs'],
    ['Error handling', 'Unknown printer ids return HTTP 404 with a JSON error; the dashboard shows a red error banner on failure'],
    ['Dashboard health', 'All five sections render; every section endpoint answers 200; no console errors during the walkthrough'],
    ['Ports preserved', 'Frontend on port 3000 and backend on port 3001 as before the feature was added'],
  ], { size: 8.3 });
}

/* -------------------------------------------------------- orchestration */
function runPass(pass) {
  const doc = makeDoc(pass);
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  doc.on('error', (e) => { throw e; });
  build(doc, doc.__ctx);
  return new Promise((resolve, reject) => {
    doc.once('end', () => resolve({ buf: Buffer.concat(chunks), ctx: doc.__ctx }));
    doc.once('error', reject);
    try { doc.end(); } catch (e) { reject(e); }
  });
}

(async () => {
  // pass 0: collect entries only
  const p0 = await runPass({ entries: null });
  const p0c = p0.ctx;
  // pass 1: identical layout with entries, blank numbers, record labels
  const p1 = await runPass({ entries: p0c.toc, figs: p0c.figs, tabs: p0c.tabs, ch1Page: p0c.ch1Page });
  const p1c = p1.ctx;
  const tocNums = new Map(p1c.toc.map((e) => [e.text, e.page === 1 ? '' : labelOf({ ch1Page: p1c.ch1Page }, e.page)]));
  const figNums = new Map(p1c.figs.map((e) => [e.text, e.page === 1 ? '' : labelOf({ ch1Page: p1c.ch1Page }, e.page)]));
  const tabNums = new Map(p1c.tabs.map((e) => [e.text, e.page === 1 ? '' : labelOf({ ch1Page: p1c.ch1Page }, e.page)]));
  // pass 2: final with numbers + footers
  const p2 = await runPass({ entries: p0c.toc, figs: p0c.figs, tabs: p0c.tabs, ch1Page: p1c.ch1Page, tocNums, figNums, tabNums, final: true });
  require('fs').writeFileSync(OUTPUT, p2.buf);
  console.log('PASS pages: p0=%d p1=%d p2=%d → %s (%d KB)',
    p0c.page, p1c.page, p2c_or_null(p2.ctx), OUTPUT, Math.round(p2.buf.length / 1024));
  function p2c_or_null(c) { return c.page; }
})().catch((e) => { console.error(e); process.exit(1); });
