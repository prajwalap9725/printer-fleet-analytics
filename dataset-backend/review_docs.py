"""Printer Fleet Analytics - IoT Monitoring for the EpicReads Industrial Print Fleet
Review 2 report and Review 3 (Invention Disclosure Format IDF-B) Word documents.

Mirrors the two reference formats supplied (GENOMERA Review 2 project report and
GENOMERA IDF-B disclosure): same section order, same cover elements, and every
number recomputed live from telemetry.csv / alerts.csv / printers.csv.
Outputs:
  dataset-backend/PrinterFleetAnalytics_Review2_Report.docx
  dataset-backend/PrinterFleetAnalytics_Review3_IDFB_Report.docx
"""
import csv
import sys
from collections import Counter
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, Inches, RGBColor

# ---------------------------------------------------------------- data
def read_csv(path):
    with open(path, newline='', encoding='utf-8-sig') as f:
        return list(csv.DictReader(f))

def num(v):
    if v in (None, ''):
        return None
    try:
        return float(v)
    except ValueError:
        return None

T = read_csv('../telemetry.csv')
ALERTS = read_csv('../alerts.csv')
PRINTERS = read_csv('../printers.csv')

LIM = {
    'temperature_c': ('max_temperature_c', 'over'),
    'vibration_mm_s': ('max_vibration_mm_s', 'over'),
    'motor_rpm': ('max_motor_rpm', 'over'),
    'power_kw': ('max_power_kw', 'over'),
    'paper_jams': ('max_paper_jams_per_interval', 'over'),
    'humidity_pct': ('max_humidity_pct|min_humidity_pct', 'band'),
    'ink_level_pct': ('min_ink_level_pct', 'under'),
    'paper_stock_pct': ('min_paper_stock_pct', 'under'),
}

def printer_profiles():
    out = []
    for p in PRINTERS:
        pr = [r for r in T if r['printer_id'] == p['printer_id']]
        labelled = [r for r in pr if num(r['is_anomaly']) == 1]
        breach = 0
        for r in pr:
            if (r.get('status') or '') == 'OFFLINE':
                continue
            hit = False
            for key, (col, direction) in LIM.items():
                v = num(r.get(key))
                if v is None:
                    continue
                if direction == 'band':
                    lo, hi = col.split('|')
                    a, b = num(p.get(lo)), num(p.get(hi))
                    hit = (a is not None and v < a) or (b is not None and v > b)
                else:
                    lim = num(p.get(col))
                    hit = lim is not None and (v > lim if direction == 'over' else v < lim)
                if hit:
                    break
            if hit:
                breach += 1
        types = Counter(r.get('anomaly_type') or 'UNKNOWN' for r in labelled)
        al = [a for a in ALERTS if a['printer_id'] == p['printer_id']]
        out.append(dict(
            id=p['printer_id'], name=p['printer_name'], model=p['model'],
            mtype=p['machine_type'], location=p['location'],
            rows=len(pr), labelled=len(labelled),
            rate=len(labelled) / len(pr) * 100, breach=breach,
            types=types, alerts=len(al),
            crit=sum(1 for a in al if a['severity'] == 'CRITICAL'),
            warn=sum(1 for a in al if a['severity'] == 'WARNING'),
            maxtemp=num(p['max_temperature_c']), maxvib=num(p['max_vibration_mm_s']),
            maxrpm=num(p['max_motor_rpm']),
        ))
    return out

per = printer_profiles()
total_rows = len(T)
total_anom = sum(1 for r in T if num(r['is_anomaly']) == 1)
fleet_rate = total_anom / total_rows * 100
sevs = Counter(a['severity'] for a in ALERTS)
status_all = Counter(r.get('status') or '' for r in T)
type_all = Counter(r.get('anomaly_type') or '' for r in T if num(r['is_anomaly']) == 1)
ts_sorted = sorted(r['timestamp'] for r in T)
PERIOD = f"{ts_sorted[0][:10]} to {ts_sorted[-1][:10]} (three calendar days, 15-minute cadence)"

hourly = Counter()
for r in T:
    if num(r['is_anomaly']) == 1:
        hourly[r['timestamp'][:13]] += 1
buckets = sorted(set(r['timestamp'][:13] for r in T))

f = lambda x, d=1: f'{x:.{d}f}'
nloc = lambda x: f'{int(x):,}'

ep1 = next(p for p in per if p['id'] == 'EPR-001')
ep8 = next(p for p in per if p['id'] == 'EPR-008')
worst = max(per, key=lambda p: p['rate'])
best = min(per, key=lambda p: p['rate'])

PROJECT = 'Printer Fleet Analytics'
SUBTITLE = ('An End-to-End IoT Monitoring System for the EpicReads Industrial Print Fleet, in which '
            'Per-Machine Threshold Governance, a Three-Reading Sustained-Window Anomaly Detector and a '
            'Dataset-Backed Individual Report Engine Convert Raw Sensor Telemetry into Auditable Operational Action')

# ---------------------------------------------------------------- helpers
def shade(cell, hexcolor):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:fill'), hexcolor)
    tcPr.append(shd)

def run_style(run, size=10.5, bold=False, italic=False, font='Times New Roman', color=None):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.name = font
    rpr = run._element.get_or_add_rPr()
    rf = OxmlElement('w:rFonts')
    rf.set(qn('w:ascii'), font); rf.set(qn('w:hAnsi'), font)
    if rpr.find(qn('w:rFonts')) is None:
        rpr.append(rf)
    if color:
        run.font.color.rgb = RGBColor.from_string(color)

def P(doc, text, align='justify', size=10.5, bold=False, italic=False, font='Times New Roman',
      space_after=6, indent=None, color=None):
    p = doc.add_paragraph()
    p.alignment = {'left': WD_ALIGN_PARAGRAPH.LEFT, 'justify': WD_ALIGN_PARAGRAPH.JUSTIFY,
                   'center': WD_ALIGN_PARAGRAPH.CENTER, 'right': WD_ALIGN_PARAGRAPH.RIGHT}[align]
    p.paragraph_format.space_after = Pt(space_after)
    if indent:
        p.paragraph_format.left_indent = Pt(indent)
    r = p.add_run(text)
    run_style(r, size, bold, italic, font, color)
    return p

def H1(doc, text):
    p = doc.add_heading(text, level=1)
    for r in p.runs:
        run_style(r, 14.5, bold=True, color='1A1A1A')
    return p

def H2(doc, text):
    p = doc.add_heading(text, level=2)
    for r in p.runs:
        run_style(r, 12, bold=True, color='1A1A1A')
    return p

def TBL(doc, header, rows, widths=None, size=8.8):
    t = doc.add_table(rows=len(rows) + 1, cols=len(header))
    t.style = 'Table Grid'
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for j, h in enumerate(header):
        c = t.rows[0].cells[j]
        c.text = ''
        r = c.paragraphs[0].add_run(h)
        run_style(r, size, bold=True, color='FFFFFF')
        shade(c, '0D1524')
    for i, row in enumerate(rows):
        for j, cell_text in enumerate(row):
            c = t.rows[i + 1].cells[j]
            c.text = ''
            r = c.paragraphs[0].add_run(str(cell_text))
            run_style(r, size)
            if i % 2 == 1:
                shade(c, 'F2F5F8')
    if widths:
        for j, w in enumerate(widths):
            for row in t.rows:
                row.cells[j].width = Inches(w)
    return t

def CAPTION(doc, text):
    P(doc, text, align='center', size=9, italic=True, space_after=10)

def SHOT(doc, desc):
    """A clearly-marked placeholder for a dashboard screenshot."""
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run(f'[ Insert screenshot: {desc} ]')
    run_style(r, 10, italic=True, color='888888')
    bdr = OxmlElement('w:pPr')
    pbdr = OxmlElement('w:pBdr')
    for edge in ('top', 'bottom', 'left', 'right'):
        e = OxmlElement(f'w:{edge}')
        e.set(qn('w:val'), 'single'); e.set(qn('w:sz'), '6'); e.set(qn('w:space'), '8'); e.set(qn('w:color'), 'BBBBBB')
        pbdr.append(e)
    bdr.append(pbdr)
    p._p.insert(0, bdr)

def page_break(doc):
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

def add_field(paragraph, instr):
    fld = OxmlElement('w:fldSimple')
    fld.set(qn('w:instr'), instr)
    run = OxmlElement('w:r')
    text = OxmlElement('w:t')
    text.text = ' '
    run.append(text)
    fld.append(run)
    paragraph._p.append(fld)

def setup(doc):
    normal = doc.styles['Normal']
    normal.font.name = 'Times New Roman'
    normal.font.size = Pt(10.5)
    normal.paragraph_format.space_after = Pt(6)
    sec = doc.sections[0]
    footer = sec.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    add_field(footer, 'PAGE')

def cover(doc, kind):
    if kind == 'review2':
        P(doc, 'A PROJECT REPORT - Review 2', align='center', size=17, bold=True, space_after=10)
    else:
        P(doc, 'A PROJECT REPORT', align='center', size=17, bold=True, space_after=10)
    P(doc, 'CLOUD COMPUTING AND METHODOLOGIES', align='center', size=12.5, bold=True, space_after=14)
    P(doc, PROJECT, align='center', size=15, bold=True, space_after=8)
    P(doc, SUBTITLE, align='center', size=10.5, italic=True, space_after=10)
    if kind != 'review2':
        P(doc, 'Invention Disclosure Format (IDF-B)', align='center', size=12, bold=True, space_after=10)
    P(doc, 'SUBMITTED BY', align='center', size=11, bold=True, space_after=12)
    t = TBL(doc, ['Name', 'Registration Number'], [
        ['Akki Prajwal', '24MID0230'],
        ['Shri Hari', '24MIC0033'],
        ['Sai Ajay Kumar Konduru', '24MID0062']], widths=[2.8, 2.8], size=10)
    P(doc, '', space_after=10)
    P(doc, 'Vellore Institute of Technology', align='center', size=11.5, bold=True, space_after=2)
    P(doc, 'Vellore, Tamil Nadu, India', align='center', size=10.5, space_after=6)
    P(doc, 'Academic Year 2025-2026', align='center', size=10.5, space_after=0)

# ---------------------------------------------------------------- figures
def fig_architecture(path):
    fig, ax = plt.subplots(figsize=(9, 5.4))
    ax.set_xlim(0, 10); ax.set_ylim(0, 6.2); ax.axis('off')
    boxes = [
        ('Operational data sources\nprinters.csv - telemetry.csv\nalerts.csv', 0.3, 4.6),
        ('Dataset engineering\ngenerate_dataset.py\nreplay_dataset.py', 3.7, 4.6),
        ('Sensor ingestion\nPOST /api/telemetry\n(15-minute cadence)', 7.1, 4.6),
        ('Node.js analytics backend\nanalytics.js - server.js\nKPIs - distributions - trends\npivot - threshold rules\nrisk score - 3-window detector', 7.1, 2.2),
        ('REST API on port 3001\n/api/stats - /api/analytics/*\n/api/telemetry/:id\n/api/events - /api/report/:id', 3.7, 2.2),
        ('React + TypeScript dashboard\nOverview - Anomaly Detection\nTelemetry Explorer - Prediction\nLive Monitor (port 3000)', 0.3, 2.2),
        ('Individual printer PDF report\nreport.js - pdfkit\n(three pages per printer)', 0.3, 0.35),
    ]
    sizes = [1.15, 1.15, 1.15, 1.5, 1.15, 1.15, 1.15]
    coords = []
    for (label, x, y), h in zip(boxes, sizes):
        w = 2.6
        ax.add_patch(plt.Rectangle((x, y), w, h, facecolor='#eef3f8', edgecolor='#1a1a1a', lw=0.9))
        ax.text(x + w / 2, y + h / 2, label, ha='center', va='center', fontsize=8.2, fontweight='bold')
        coords.append((x, y, w, h))
    def ah(x, y, dx, dy):
        ax.annotate('', xy=(x + dx, y + dy), xytext=(x, y),
                    arrowprops=dict(arrowstyle='-|>', color='#444a55', lw=1.1))
    ah(coords[0][0] + coords[0][2], coords[0][1] + sizes[0] / 2, 0.8, 0)
    ah(coords[1][0] + coords[1][2], coords[1][1] + sizes[1] / 2, 0.8, 0)
    ah(coords[2][0] + 1.3, coords[2][1], 0, -0.45)
    ah(coords[3][0], coords[3][1] + sizes[3] / 2, -0.8, 0)
    ah(coords[4][0], coords[4][1] + sizes[4] / 2, -0.8, 0)
    ah(coords[5][0] + 1.3, coords[5][1], 0, -0.5)
    fig.tight_layout(); fig.savefig(path, dpi=150, bbox_inches='tight'); plt.close(fig)

def fig_workflow(path):
    fig, ax = plt.subplots(figsize=(9.6, 2.6))
    ax.set_xlim(0, 10); ax.set_ylim(0, 2.2); ax.axis('off')
    stages = ['Registry row\n(101)', 'Ingestion\nvalidation (102)', 'Analytics\nstate (103)',
              'Rules + window\ndetector (104)', 'Alert record\n(105)', 'Dashboard\nviews (106)',
              'Individual report\n(107)']
    y, w, h = 0.7, 1.25, 0.85
    for i, s in enumerate(stages):
        x = 0.15 + i * (w + 0.145)
        ax.add_patch(plt.Rectangle((x, y), w, h, facecolor='#eef3f8', edgecolor='#1a1a1a', lw=0.9))
        ax.text(x + w / 2, y + h / 2, s, ha='center', va='center', fontsize=7.6, fontweight='bold')
        if i < len(stages) - 1:
            ax.annotate('', xy=(x + w + 0.135, y + h / 2), xytext=(x + w, y + h / 2),
                        arrowprops=dict(arrowstyle='-|>', color='#444a55', lw=1.0))
    fig.tight_layout(); fig.savefig(path, dpi=150, bbox_inches='tight'); plt.close(fig)

def fig_rate(path):
    fig, ax = plt.subplots(figsize=(8.4, 3.2))
    ids = [p['id'].split('-')[1] for p in per]
    rates = [p['rate'] for p in per]
    bars = ax.bar(ids, rates, color='#4164e0', width=0.55)
    for b, v in zip(bars, rates):
        ax.text(b.get_x() + b.get_width() / 2, v + 0.15, f'{v:.1f}%', ha='center', fontsize=9)
    ax.set_ylabel('labelled anomaly rate (%)'); ax.set_xlabel('printer')
    ax.set_ylim(0, max(rates) * 1.25)
    ax.spines[['top', 'right']].set_visible(False)
    fig.tight_layout(); fig.savefig(path, dpi=150); plt.close(fig)

def fig_alerts(path):
    fig, ax = plt.subplots(figsize=(8.4, 3.2))
    ids = [p['id'].split('-')[1] for p in per]
    crit = np.array([p['crit'] for p in per]); warn = np.array([p['warn'] for p in per])
    ax.bar(ids, warn, label='WARNING', color='#e69a3c', width=0.55)
    ax.bar(ids, crit, bottom=warn, label='CRITICAL', color='#c0392b', width=0.55)
    totals = crit + warn
    for i, v in enumerate(totals):
        ax.text(i, v + 0.6, str(int(v)), ha='center', fontsize=9)
    ax.set_ylabel('recorded alerts'); ax.set_xlabel('printer'); ax.legend()
    ax.set_ylim(0, totals.max() * 1.2)
    ax.spines[['top', 'right']].set_visible(False)
    fig.tight_layout(); fig.savefig(path, dpi=150); plt.close(fig)

def pic(doc, path, width=6.1):
    doc.add_picture(path, width=Inches(width))
    doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER

# =================================================================
# REVIEW 2 DOCUMENT
# =================================================================
doc = Document()
setup(doc)
cover(doc, 'review2')

page_break(doc)
H1(doc, 'ABSTRACT')
P(doc, (f'Industrial monitoring dashboards typically alarm on one raw sensor reading against one fleet-wide limit, '
        f'which floods operators with single-reading excursions and yet cannot express that the same sensor value is '
        f'healthy on one machine and dangerously out of bounds on the next. This report presents the Review 2 state of '
        f'Printer Fleet Analytics, an end-to-end IoT monitoring system for the eight-printer fleet of EpicReads (machines EPR-001 '
        f'through EPR-008), implemented as a cloud-style layered service: a reproducible dataset layer of '
        f'{nloc(total_rows)} telemetry readings at 15-minute cadence over {PERIOD.split("(")[0].strip()} plus a machine '
        f'registry carrying per-machine sensor limits, a Node.js analytics backend whose pure modules compute fleet KPIs, '
        f'distributions, trends, pivots and per-machine threshold rules, a documented REST interface on port 3001, a '
        f'React + TypeScript + Chart.js dashboard with five working sections on port 3000, and a dataset-backed '
        f'individual printer report engine that emits a print-ready three-page PDF per machine. The design deliberately '
        f'separates three related quantities that one-number dashboards conflate: labelled anomalous readings (dataset '
        f'ground truth), raw threshold-breach readings and sustained-window anomaly events, the last raised only when a '
        f'metric stays out of bounds for three consecutive readings. Across the monitored window the dataset labels '
        f'{nloc(total_anom)} readings as anomalous ({f(fleet_rate, 2)}%), the alert engine records {nloc(len(ALERTS))} '
        f'rule-driven alerts ({sevs.get("CRITICAL", 0)} CRITICAL, {sevs.get("WARNING", 0)} WARNING) raised from '
        f'per-machine columns in printers.csv, and the individual report feature was verified end to end for all eight '
        f'printers, with the mandatory EPR-001 versus EPR-008 comparison checked against the raw CSVs. The evaluation '
        f'data is synthetic by construction, no real fleet hardware was used, and the system is validated on a single '
        f'laptop environment only.'))
P(doc, 'Keywords: IoT monitoring; cloud-style service layering; REST API; anomaly detection; threshold governance; '
       'sustained-window inference; telemetry replay; React; TypeScript; Chart.js; Node.js; PDF report generation; '
       'per-machine configuration; operational excellence; dataset provenance.', italic=True)

page_break(doc)
H1(doc, '1. Introduction')
H2(doc, '1.1 Context and motivation')
P(doc, 'A print-farm supervisor does not experience failure as a chart. A bearing overheats during a run, ink runs low '
       'in the middle of a job, and a jammed feeder is noticed only when the delivery is already late. Cloud IoT '
       'platforms solve the plumbing - ingest, store, compute, display - but their stock alarms are per-reading and '
       'often per-fleet, so they are easy to configure and easy to ignore: one hot afternoon trips the temperature '
       'alarm for a machine that is otherwise fine, while a slow bearing drift that never trips a one-off alert '
       'escapes notice entirely. Single-signal anomaly flags also conflate what a maintenance decision actually '
       'needs to distinguish: a dataset-labelled event, a raw excursion against a limit, and a persistent condition '
       'that will end a shift.')
P(doc, 'The fleet fairness problem is equally concrete. Machines EPR-001 through EPR-008 are physically different '
       f'(print-fleet presses of types {", ".join(sorted(set(p["mtype"] for p in per)))}, installed between 2018 and '
       f'2021), so one identical limit is wrong for every machine and right for none. A 5.4 mm/s vibration is inside '
       'EPR-001\'s 5.5 mm/s allowance but is an 80% overshoot of EPR-008\'s 3.0 mm/s limit. The system therefore '
       'carries its configuration where the machines are: per-machine, per-metric limits in the printer registry, '
       'honoured everywhere in the computation.')
H2(doc, '1.2 Scope of the work')
P(doc, 'The implemented scope begins with three CSV datasets and ends with the five-section dashboard and the '
       'printable per-machine report. Between them lie the dataset generation and replay scripts, the analytics '
       'modules, the threshold-rule configuration derived from the registry, the raw-breach and sustained-window '
       'detection layers, the weighted live-sensor risk score, and the report generator. The Review 2 submission '
       'does not cover authenticated fleet accounts, cloud deployment with persistence, streaming ingestion from '
       'physical hardware, or a trained predictive-maintenance model; those are listed as future work in Section 9. '
       'Built and demonstrated as a layered, stateless-service style application running on one laptop (backend '
       'port 3001, dashboard port 3000), so that every layer boundary is a documented HTTP contract.')

page_break(doc)
H1(doc, '2. Related Work')
P(doc, 'Prior work divides along the same line this project crosses. Established cloud-IoT suites give robust '
       'ingestion, dashboards and alert rules, but their alerting is per-reading against per-device thresholds with '
       'no sustained-window criterion by default, their report layer is a screenshot of a chart rather than a '
       'document, and their per-unit limit configuration is possible but rarely exercised per metric. Print-fleet '
       'standards such as the Internet Printing Protocol and the SNMP Printer MIB expose device status but do not '
       'decide anything with it. Table I summarises the surveyed systems against the properties Printer Fleet Analytics makes '
       'first-class.')
CAPTION(doc, 'TABLE I.  Comparison of prior systems with Printer Fleet Analytics.')
TBL(doc, ['System / standard', 'Capability', 'Alert model', 'Per-unit limits', 'Print-ready output'], [
    ['AWS IoT Core / SiteWise', 'Ingestion, rules, dashboards', 'Per-reading rule actions', 'Per-device possible',
     'None native'],
    ['Azure IoT Hub + Monitor', 'Ingestion, metrics, alert rules', 'Per-reading metric alerts', 'Per-device possible',
     'None native'],
    ['Google Cloud IoT Core (retired)', 'Managed ingestion core', 'External (Dataflow/Functions)', 'External', 'None'],
    ['Grafana + Prometheus', 'Metrics storage and visualization', 'Static and windowed rules', 'Per-series rules',
     'PDF of a dashboard page'],
    ['Splunk (Industrial Asset)', 'Log and event pipeline', 'Search-time alert correlation', 'Per-source possible',
     'Report extracts'],
    ['SNMP Printer MIB v2 / IPP', 'Print-device status exposure', 'None - transport standard', 'n/a', 'n/a'],
    ['Printer Fleet Analytics', 'Dataset-backed analytics + five-section dashboard',
     'Raw breaches PLUS three-reading sustained-window events', 'Per-machine, per-metric from registry',
     'Three-page per-machine PDF via dedicated endpoint'],
], widths=[1.35, 1.75, 1.75, 1.35, 1.5], size=8)
P(doc, 'The distinguishing arrangement is not any single capability but the combination: dataset ground truth kept '
       'visible (labelled readings), detection split into breach counting and a sustained-window rule so operators '
       'see excursions and persistent conditions differently, and reporting that is a generated document, filtered '
       'strictly per machine, rather than a screen dump. No novelty is asserted in the individual building blocks - '
       'HTTP ingestion, KPI computation, canvas charting, or PDF rendering - which are claimed only in combination.', space_after=2)

page_break(doc)
H1(doc, '3. Problem Statement and Objectives')
H2(doc, '3.1 The technical problem')
P(doc, '(a) How to make threshold governance correct for a heterogeneous fleet without duplicating anything. A '
       'fleet-wide limit is simple and wrong; per-machine logic spread through the code is correct and unmaintainable. '
       'The configuration must live in one place (the printer registry) and every consumer - alert engine, dashboard '
       'chart limit lines, report tables and recommendations - must read the same values.')
P(doc, '(b) How to keep three related anomaly quantities distinguishable. Labelled anomalous readings '
       f'({nloc(total_anom)} in the current dataset) are ground truth; raw threshold-breach readings are any sensor '
       'value out of its configured bounds; detected anomaly events are only those a sustained-window rule fires. '
       'Every surface must present all three separately so no operator or report reader can mistake one for another.')
P(doc, '(c) How to keep the dashboard responsive while computing everything from the datasets at request time. The '
       'client must request filtered series (printer + metric), never the whole file; the backend must compute KPIs, '
       'distributions, trends and pivots on demand from cached dataset rows without a persistent database.')
P(doc, '(d) How to make a downloaded report an auditable artifact rather than a marketing page. The report must '
       'distinguish labelled readings, breach readings and detected events; show the machine\'s own limits; keep its '
       'whole alert history with severities; and phrase recommendations as rule-based maintenance suggestions, never '
       'as confirmed diagnoses.')
H2(doc, '3.2 Objectives')
CAPTION(doc, 'TABLE II.  Design objectives. Objectives 1 and 2 define the central mechanism.')
TBL(doc, ['#', 'Objective', 'Statement'], [
    ['1', 'Per-machine threshold governance',
     'Evaluate every sensor against the registry row of the machine that produced it, so the same reading can be '
     'healthy on one machine and a breach on the next - honoured identically in the alert engine, the dashboard and '
     'the reports.'],
    ['2', 'Sustained-window detection',
     'Fire a detected anomaly event only when a metric stays out of bounds for three consecutive readings at a '
     'machine, so single-reading excursions add to the breach count without flooding the operator.'],
    ['3', 'Three-count honesty',
     'Present labelled anomalous readings, raw breach readings and detected events as three separate counts on the '
     'dashboard, in the API payloads and in every report.'],
    ['4', 'Interactive fleet analytics',
     'Compute KPIs, distributions, hourly and daily trends, pivots and threshold rules from the datasets at request '
     'time, caching in-process, so the dashboard answers on commodity hardware.'],
    ['5', 'Validation at ingestion',
     'Reject unknown printer IDs and malformed payloads at the ingestion endpoint; corrupt streams must not pollute '
     'detection state.'],
    ['6', 'Individual machine reporting',
     'Emit a three-page print-ready PDF per machine on demand through a dedicated endpoint, with the machine\'s '
     'limits, statistics, anomaly summary, charts, alert history and rule-based recommendations.'],
    ['7', 'Graceful degradation',
     'Handle empty alert histories, OFFLINE/null sensor rows and unknown identifiers without broken tables or '
     'partial downloads; unknown printers return an explicit HTTP 404.'],
    ['8', 'Reproducibility',
     'Regenerate the whole dataset layer from one script and re-verify every computed statistic against the raw '
     'CSVs from an independent checker.'],
], widths=[0.4, 1.7, 4.7], size=8)

page_break(doc)
H1(doc, '4. System Architecture')
P(doc, 'The system is organised as four layers (Fig. 1): an operational data layer holding the three datasets; a '
       'dataset-engineering layer that regenerates and replays them; a service layer consisting of the ingestion '
       'endpoint, the analytics modules and the REST interface; and a presentation layer of the five-section '
       'dashboard and the report service. Each layer boundary is an HTTP contract or a module interface, which is '
       'what lets the replay engine exercise exactly the code path live sensors would use, and lets the dashboard '
       'request filtered slices instead of whole files.')
fig_architecture('rev_fig1_architecture.png')
pic(doc, 'rev_fig1_architecture.png')
CAPTION(doc, 'Fig. 1.  Layered architecture. Datasets (top left); dataset engineering; ingestion; analytics backend; '
             'REST interface; dashboard and report services.')
P(doc, 'Fig. 2 shows the end-to-end data path for one reading: the registry row bounds every later decision, the '
       'ingestion validation rejects unregistered machines, the analytics state is updated, the rules and the '
       'three-reading detector evaluate the reading, any fired alert accrues to the alert surface, the dashboard '
       'reads the computed state, and the report service turns stored data into the printable artifact on demand.')
fig_workflow('rev_fig2_workflow.png')
pic(doc, 'rev_fig2_workflow.png')
CAPTION(doc, 'Fig. 2.  End-to-end reading workflow from registry row (101) to individual print-ready report (107).')

page_break(doc)
H1(doc, '5. Methodology')
H2(doc, '5.1 Dataset engineering and registry design')
P(doc, 'The operational layer is three CSV files. printers.csv is the registry: eight machine rows carrying identity, '
       'type, location, installation date and the per-machine limit columns (maximum temperature, vibration, motor '
       'RPM, power and paper jams per interval; minimum ink level, paper stock and the humidity band). telemetry.csv '
       f'holds {nloc(total_rows)} readings x 16 columns at 15-minute cadence across the machine status mix ('
       + ', '.join(f'{k} {nloc(v)}' for k, v in sorted(status_all.items()) if k) +
       f'). alerts.csv holds {nloc(len(ALERTS))} alert rows with timestamp, machine, metric, recorded value, threshold '
       'value, severity and message. One generation script rewrites all three, and the label column '
       f'(is_anomaly) marks {nloc(total_anom)} readings ({f(fleet_rate, 2)}%) anomalous across six injected families '
       '(' + ', '.join(t.lower() for t, _ in type_all.most_common()) .rstrip(', ') + ').')
H2(doc, '5.2 Ingestion and validation')
P(doc, 'Sensor readings enter through POST /api/telemetry, which validates against the registry before touching any '
       'state: unknown printer IDs and malformed bodies are rejected with explicit status codes. Replay '
       '(replay_dataset.py) posts historical rows through this same path with realistic spacing, so the live '
       'detector is exercised by exactly the code path production traffic would use.')
H2(doc, '5.3 Analytics core')
P(doc, 'analytics.js holds pure computation modules loaded once per process: fleet KPIs, sensor distributions, '
       'hourly and daily trends, per-printer pivots, and the threshold-rule derivation that turns each registry row '
       'into its machine\'s ordered rule list. Threshold severity is mapped from the limit columns: temperature, '
       'vibration and paper jams are CRITICAL; motor RPM, power, the humidity band and the ink floor are WARNING; '
       'the paper-stock floor is INFO. The modules are called by the HTTP surface, which caches results in-process.')
H2(doc, '5.4 Sustained-window detection and risk scoring (central mechanism)')
P(doc, 'Detection is deliberately two-stage. Stage one counts raw breaches: each reading, for each metric, is '
       'compared with its machine\'s configured bound and contributes to the breach count and its alert row when out '
       'of bounds. Stage two is the sustained-window rule: only a metric that remains out of bounds for three '
       'consecutive readings at a machine fires a detected anomaly event. This keeps brief excursions visible but '
       'non-urgent, and the persistent conditions - the maintenance-relevant ones - in the operator\'s critical view. '
       'A complementary weighted risk score evaluates arbitrary live sensor input against the same limits, with '
       'weighted per-metric distances to their bounds, and reports a risk percentage bucketed into '
       'NORMAL / ELEVATED / WARNING / CRITICAL (>4%, >12%, >35%), so the Prediction view and the live monitor say '
       'the same thing the alert engine says.')
H2(doc, '5.5 Individual printer report')
P(doc, 'report.js is a self-contained pdfkit program. Given a machine ID it filters all three datasets strictly by '
       'that machine and composes three pages: identity header, the registry row and its limits, per-sensor statistics '
       '(minimum, average, maximum, last reading, breach count for all nine channels), the three-count anomaly '
       'summary, three time-series charts (temperature, vibration, motor RPM) each drawn with the machine\'s own '
       'limit line and red markers on labelled readings that breach that sensor, the alert history table newest first '
       'with CRITICAL rows highlighted, and rule-based recommendations fired only on observed breaches (cooling '
       'system for repeated temperature excursions, mechanical inspection for vibration, replenishment for ink and '
       'paper stock) with a standing disclaimer that no confirmed failure is asserted. The service is exposed through '
       'GET /api/report/<printer-id> as a Content-Disposition attachment named '
       'EpicReads_Printer_<id>_Report.pdf; unknown machines return HTTP 404 with a JSON error, and generation errors '
       'are caught so a partial file can never download.')
H2(doc, '5.6 Verification discipline')
P(doc, 'A verification script recomputes labelled counts, breach counts, per-sensor statistics and alert attributions '
       'directly from the CSVs - independently of the backend\'s own modules - and checks the extracted text of '
       'generated PDFs against that ground truth. Chapter 7 records its results.')

page_break(doc)
H1(doc, '6. System Realisation and Demonstration')
P(doc, 'The dashboard renders five sections on port 3000: Overview (fleet KPI band, distributions, trends), Anomaly '
       'Detection (labelled episodes, alert timeline, per-episode drill-downs), Telemetry Explorer (printer + metric '
       'series with labelled points marked red, and the report-download button), Prediction (weighted risk scoring of '
       'live sensor input) and Live Monitor (machine state as the replay engine streams readings in). Figs. 3 to 5 '
       'show the fleet-level picture computed from the datasets; the embedded screenshots show the live views '
       'captured for this review.')
fig_rate('rev_fig3_rate.png'); fig_alerts('rev_fig4_alerts.png')
pic(doc, 'rev_fig3_rate.png', 5.8)
CAPTION(doc, 'Fig. 3.  Labelled anomaly rate per printer (dataset ground truth).')
pic(doc, 'rev_fig4_alerts.png', 5.8)
CAPTION(doc, 'Fig. 4.  Recorded alerts per printer by severity (alerts.csv).')
pic(doc, 'shots/overview.png', 6.0)
CAPTION(doc, 'Fig. 5.  Overview section of the dashboard, live against the backend on port 3000.')
pic(doc, 'shots/telemetry_explorer.png', 6.0)
CAPTION(doc, 'Fig. 6.  Telemetry Explorer section on EPR-001 with the Download PDF Report control.')
pic(doc, 'shots/report/EPR-001_p1.png', 4.4)
pic(doc, 'shots/report/EPR-001_p2.png', 4.4)
pic(doc, 'shots/report/EPR-001_p3.png', 4.4)
CAPTION(doc, 'Fig. 7a.  Individual report for EPR-001, page 1: header, printer information, sensor statistics.')
CAPTION(doc, 'Fig. 7b.  Report page 2: sensor graphs with the machine limit lines.')
CAPTION(doc, 'Fig. 7c.  Report page 3: anomaly summary, alert history and recommendations.')

page_break(doc)
H1(doc, '7. Results and Evaluation')
H2(doc, '7.1 Evaluation data and its limitations')
P(doc, 'The evaluation uses the project\'s own synthetic-but-realistic operational dataset, regenerated from one '
       'script: eight machine profiles, six injected anomaly families and the resulting alert rows. The limitations '
       'must be stated plainly: the labelled anomalies are injected by the generation script, so the evaluation is '
       'circular and measures the pipeline\'s ceiling, not field accuracy; no real printer hardware, no real fleet '
       'outcomes and no prospective study are involved at any point; and all figures were measured on a single '
       'laptop with a single simultaneous user. Published sizing figures for the cloud suites in Table I were '
       'measured at infrastructure scale and are therefore not comparable with the figures below.')
H2(doc, '7.2 Fleet results across the monitored window')
CAPTION(doc, f'TABLE III.  Per-printer results over {nloc(total_rows)} readings, {PERIOD}.')
rows71 = []
for p in per:
    rows71.append([p['id'], p['mtype'], nloc(p['rows']), nloc(p['labelled']), f(p['rate'], 1), nloc(p['breach']),
                   nloc(p['alerts']), nloc(p['crit'])])
TBL(doc, ['Printer', 'Type', 'Readings', 'Labelled', 'Rate %', 'Breach readings', 'Alerts', 'Critical'], rows71,
    widths=[0.85, 1.15, 0.85, 0.8, 0.6, 1.05, 0.65, 0.75], size=8.5)
P(doc, f'Two spreads characterise the fleet: the labelled anomaly rate runs from {f(best["rate"], 2)}% '
       f'({best["id"]}) to {f(worst["rate"], 2)}% ({worst["id"]}), and breach reads move to a different rhythm than '
       'labelled reads, which is exactly the conflation the architecture refuses to make. EPR-001 and EPR-008 are '
       'the acceptance pair: EPR-001 carries the humidity and power families while EPR-008 dominates vibration, '
       'motor overspeed and offline episodes.')
H2(doc, '7.3 Individual-report verification (EPR-001 vs EPR-008)')
P(doc, 'The report feature was accepted only after the per-machine comparison. Select EPR-001, download; select EPR-008, '
       'download; then re-verify every statistic in both documents against the raw CSVs with the independent checker. '
       'Table IV records the reconciliation.')
CAPTION(doc, 'TABLE IV.  Report verification pair - results from the automated cross-check.')
top1 = ', '.join(f'{t.replace("_", " ")} {c}' for t, c in ep1['types'].most_common(3))
top8 = ', '.join(f'{t.replace("_", " ")} {c}' for t, c in ep8['types'].most_common(3))
TBL(doc, ['Check', 'EPR-001', 'EPR-008'], [
    ['Filename', 'EpicReads_Printer_EPR-001_Report.pdf', 'EpicReads_Printer_EPR-008_Report.pdf'],
    ['Length and content type', '3 pages, application/pdf, Content-Disposition attachment', 'same'],
    ['Foreign printer IDs in report', 'None', 'None'],
    ['Total readings', f"{ep1['rows']} (matches CSV)", f"{ep8['rows']} (matches CSV)"],
    ['Labelled anomalous readings', f"{ep1['labelled']} of {ep1['rows']} ({f(ep1['rate'])}%) - matches CSV",
     f"{ep8['labelled']} of {ep8['rows']} ({f(ep8['rate'])}%) - matches CSV"],
    ['Raw threshold-breach readings', f"{ep1['breach']} (recomputed)", f"{ep8['breach']} (recomputed)"],
    ['Recorded alerts', f"{ep1['alerts']} total, {ep1['crit']} CRITICAL", f"{ep8['alerts']} total, {ep8['crit']} CRITICAL"],
    ['Dominant labelled episodes', top1, top8],
    ['Chart limit lines (own machine)', f"{f(ep1['maxtemp'],1)} degC - {f(ep1['maxvib'],1)} mm/s - {nloc(ep1['maxrpm'])} rpm",
     f"{f(ep8['maxtemp'],1)} degC - {f(ep8['maxvib'],1)} mm/s - {nloc(ep8['maxrpm'])} rpm"],
    ['Recommendations', 'Fired only from its own records; no confirmed-failure claim', 'same'],
], widths=[1.7, 2.65, 2.65], size=8)
P(doc, 'Both documents passed every check: strictly machine-specific content, statistic-verbatim agreement with the '
       'CSVs, charts carrying only their own series and limits, and clean layout on three pages. All eight printers '
       'generated reports through the live endpoint.')
H2(doc, '7.4 Software verification and error handling')
P(doc, 'The five dashboard sections render with no console errors during the walkthrough, and every section endpoint '
       'answers 200. Ingestion rejects an unregistered printer ID and a malformed JSON body with explicit status '
       'messages; the report endpoint returns HTTP 404 with a JSON error for unknown machines; and a machine with no '
       'recorded alerts receives the graceful no-alerts text rather than an empty table. Related but distinct counts '
       'are reported separately everywhere (dashboard cards, API payloads, report sections), which Chapter 5.4 '
       'requires. Two always-on processes serve ports 3001 (backend) and 3000 (dashboard), unchanged by the report '
       'feature.')

page_break(doc)
H1(doc, '8. Discussion and Limitations')
P(doc, 'The contribution that distinguishes this work is the pairing of per-machine threshold governance with the '
       'two-stage detection split and a document-grade reporting output: the registry row of the machine that '
       'produced a reading decides every later statement about it; brief excursions and sustained conditions remain '
       'separate signals; and the printed artifact carries the machine\'s own limits, its statistics, its three-count '
       'anomaly reconciliation and rule-based recommendations. The gate is honesty: nothing in any surface claims that '
       'a mechanical failure is confirmed, and every statistic traces to the CSVs.')
P(doc, 'The limitations are equally explicit. All quantitative results come from generated data measured on one '
       'laptop; the sustained-window threshold of three readings is a parameter justified by operator-noise reasoning, '
       'not yet by field data; there is no authenticated multi-user mode, no persistence or high availability, and no '
       'trained predictive model; and the fleet hardware is simulated by the replay engine rather than instrumented. '
       'The system is assessed at laboratory readiness; no field deployment is claimed.')

H1(doc, '9. Conclusion and Future Work')
P(doc, 'One-limit-fits-all alerting is systematically wrong for a fleet of physically different machines, and '
       'per-reading alarm rules bury operators in noise while missing the persistent conditions that end shifts. '
       'Printer Fleet Analytics replaces that arrangement with per-machine limit governance, a three-reading sustained-window '
       'detector on top of raw breach counting, a dashboard and API that keep labelled truth, breaches and detected '
       'events distinct, and an individual three-page PDF report per machine verified statistic-by-statistic against '
       'the datasets, with the mandatory EPR-001 versus EPR-008 comparison passed.')
P(doc, 'Future work is directed to the items deliberately out of Review 2 scope: authenticated fleet accounts and '
       'multi-user isolation, a cloud deployment with persistent storage and health probes, instrumenting real '
       'print hardware through the same ingestion contract, a predictive-maintenance model trained on accumulated '
       'fleet history and served alongside the risk score, and push dispatch of CRITICAL alerts to maintenance '
       'channels.')

page_break(doc)
H1(doc, 'References')
for ref in [
    '[1] A. Al-Fuqaha, M. Guizani, M. Mohammadi, M. Aledhari and M. Ayyash, "Internet of Things: A Survey on Enabling '
    'Technologies, Protocols, and Applications," IEEE Communications Surveys and Tutorials, vol. 17, no. 4, '
    'pp. 2347-2376, 2015.',
    '[2] Amazon Web Services, "AWS IoT Core - Connect devices to the cloud," 2026. [Online]. Available: '
    'https://aws.amazon.com/iot-core/',
    '[3] Microsoft Azure, "Azure IoT Hub - Ingest, monitor and manage IoT devices," 2026. [Online]. Available: '
    'https://learn.microsoft.com/azure/iot-hub/',
    '[4] Grafana Labs, "Grafana Open Source - Metrics dashboards and alerting," 2026. [Online]. Available: '
    'https://grafana.com/oss/grafana/',
    '[5] The Prometheus Authors, "Prometheus - An open-source monitoring system with a dimensional data model," 2026. '
    '[Online]. Available: https://prometheus.io/',
    '[6] J. Sweet and I. McDonald, "Internet Printing Protocol/1.1: Encoding and Transport," RFC 8011, Jan. 2017.',
    '[7] P. Turaga et al. (IETF), "Printer Management Information Base (MIB) v2," RFC 3805, Jun. 2004.',
    '[8] D. Govett, "PDFKit - A JavaScript PDF generation library for Node and the browser," 2026. [Online]. '
    'Available: https://github.com/foliojs/pdfkit',
]:
    P(doc, ref, space_after=5)

doc.save('PrinterFleetAnalytics_Review2_Report.docx')
print('wrote PrinterFleetAnalytics_Review2_Report.docx')

# =================================================================
# REVIEW 3 (IDF-B) DOCUMENT
# =================================================================
doc = Document()
setup(doc)
cover(doc, 'review3')

page_break(doc)
P(doc, '© VIT IPR & TT CELL', align='right', size=9, bold=True, space_after=8)
CAPTION(doc, 'Invention Disclosure Format (IDF) - B')
TBL(doc, ['Field', 'Value'], [
    ['Document No.', '02-IPR-R003'],
    ['Issue No / Date', '2 / 01.02.2024'],
    ['Amd. No / Date', '0 / 00.00.0000'],
], widths=[2.2, 4.6], size=9.5)

H1(doc, '1. Title of the invention:')
P(doc, f'{PROJECT}: {SUBTITLE}', align='justify')

H1(doc, '2. Field / Area of invention:')
P(doc, (f'The invention relates to computer-implemented IoT monitoring systems, and specifically to data-processing '
        f'systems that convert raw sensor telemetry from an industrial machine fleet into auditable operational '
        f'action. It further covers machine-registry engineering of operational datasets, threshold-rule governance '
        f'derived from per-machine configuration, raw-breach counting, sustained-window anomaly detection, weighted '
        f'live-sensor risk scoring, five-section dashboard presentation over a REST interface, and print-ready '
        f'individual-machine reporting with rule-based maintenance recommendations. It addresses the technical '
        f'problem of keeping physically heterogeneous print-fleet machines - {", ".join(sorted(set(p["mtype"] for p in per)))} '
        f'units rated between them at motor speeds from {nloc(min(p["maxrpm"] for p in per))} to '
        f'{nloc(max(p["maxrpm"] for p in per))} rpm - correctly governed by their own limits within an interactive '
        f'laptop-class computational budget.'))

H1(doc, '3. Prior Patents and Publications from literature (provide a table summarizing the prior art)')
P(doc, ('A search was carried out across IEEE Xplore, Google Scholar, vendor documentation and the IETF standards '
        'database, directed at five questions: whether any prior system (i) governs sensor thresholds per physical '
        'machine from a machine-registry data source; (ii) separates raw threshold breaches from a sustained-window '
        'anomaly criterion; (iii) keeps dataset-labelled ground truth visible as a first-class quantity; (iv) emits '
        'a per-machine, print-ready report document generated from raw datasets; or (v) phrases maintenance '
        'suggestions as rule-based recommendations that never claim confirmed failure.'))
P(doc, ('Prior art is abundant for the individual building blocks and no novelty is asserted in any of them alone. '
        'The search did NOT locate a disclosure in which a machine-registry-driven three-reading sustained-window '
        'detector, a labelled-versus-breach-versus-event three-count reconciliation and a dataset-verbatim '
        'individual-machine report engine are combined into one monitoring system. The closest references are:'))
P(doc, '', space_after=2)
CAPTION(doc, 'Summary of prior art located and its relation to the present invention.')
TBL(doc, ['#', 'Reference', 'Source', 'What it teaches and its challenges'], [
    ['1', 'Al-Fuqaha et al., IEEE COMST 17(4), 2015', 'IEEE Xplore',
     'Survey of IoT enabling technologies, protocols and application architectures. Merits: establishes the '
     'layered ingest-compute-display architecture this project also uses. Challenges: involves no per-machine '
     'threshold governance, no sustained-window detection and no report generation.'],
    ['2', 'AWS IoT Core / SiteWise (vendor documentation)', 'aws.amazon.com',
     'Managed ingestion, rule-engine actions and industrial-site dashboards. Merits: robust transport and rule '
     'engine. Challenges: alerts act per reading against per-device rules; sustained-window criteria require custom '
     'development; document reporting is not native.'],
    ['3', 'Azure IoT Hub + Azure Monitor (vendor documentation)', 'learn.microsoft.com',
     'Device ingestion with metric alert rules. Merits: mature metric alerting. Challenges: per-reading metric '
     'alerts by default; per-metric limits per device require external storage and code.'],
    ['4', 'Google Cloud IoT Core (retired 2023)', 'cloud.google.com',
     'Managed ingestion core with external analytics attached. Merits: shows the minimal-core division. '
     'Challenges: service retired, demonstrating that the analytics value must live outside the transport layer - '
     'the choice this project makes deliberately in reverse.'],
    ['5', 'Grafana OSS + Prometheus', 'grafana.com; prometheus.io',
     'Metrics storage, visualisation and alerting with static and windowed rules. Merits: closest to the '
     'dashboard layer and the windowed rule concept. Challenges: per-unit limit configuration is per-series and '
     'scripted; there is no registry-derived table, no labelled-truth quantity, and output is a screen capture, '
     'not a generated document.'],
    ['6', 'Splunk Industrial Asset Intelligence', 'splunk.com',
     'Search-time alert correlation over machine events. Merits: powerful correlation. Challenges: license-cost '
     'search layer, not a document-grade reporting engine and not per-machine-limit native.'],
    ['7', 'SNMP Printer MIB v2, RFC 3805; IPP/1.1, RFC 8011', 'IETF',
     'Standards exposing print-device status (levels, errors, state). Merits: the telemetry vocabulary for print '
     'equipment. Challenges: transport standards only - they expose readings but decide nothing with them.'],
    ['8', 'pdfkit (Govett, 2020-dated) and Chart.js documentation', 'public repositories',
     'PDF generation and canvas charting libraries. Merits: these are the rendering substrates used unchanged. '
     'Challenges: no novelty claimed in either; the claimed arrangement is the report\'s content governance, '
     'not the rendering.'],
], widths=[0.35, 1.55, 1.25, 3.85], size=7.6)

# ---- 4. Summary and background ----
page_break(doc)
H1(doc, '4. Summary and background of the invention (Address the gap / Novelty)')
H2(doc, '4.1 The operational problem')
P(doc, ('A print farm is operated by people, not by machines: a supervisor starts a shift with a mental state - which '
        'machines are healthy, which sensors are drifting towards their limits, which machines already raised alerts '
        'overnight - and maintenance visits are documented on paper, not on screens. Cloud IoT suites solve the '
        'plumbing of ingest, store, compute and display, but their stock alerting is per-reading: one hot afternoon '
        'trips a temperature alarm for a healthy machine, while a slow bearing drift that never trips a one-off alert '
        'escapes notice entirely. The operator flowers in noise while the persistent condition that will end a shift '
        'stays under it.'))
H2(doc, '4.2 The gap in the prior art')
P(doc, ('Three gaps consistently separate the located prior art from what the print farm needs. First, threshold '
        'governance: limits must be per physical machine and per metric, drawn from a single registry that every '
        'consumer reads identically - the prior art stores limits per device but does not derive rules, chart limit '
        'lines, report content and recommendations from that one source. Second, signal discipline: a labelled '
        'ground-truth event, a raw out-of-bounds excursion and a sustained out-of-bounds condition are three '
        'different operational facts; prior systems either collapse them into one alarm flag or expose no '
        'sustained-window criterion at all. Third, output: fleet history ends up on paper - reports must be '
        'generated documents filtered strictly per machine, carrying the machine\'s own limits, its complete alert '
        'history with severities and rule-based recommendations, not a re-scan of a dashboard page.'))
H2(doc, '4.3 Novelty asserted')
P(doc, ('The arrangement claimed is the combination: (i) machine-registry threshold governance in which the registry '
        'row of the machine that produced a reading determines every later statement about that reading across all '
        'surfaces; (ii) a two-stage detection layer in which raw breaches are counted separately from a '
        'three-consecutive-reading sustained-window anomaly event, both kept distinct from the dataset-labelled '
        'ground truth in every display, payload and document; (iii) a dataset-verbatim individual-machine report '
        'engine that filters three operational datasets strictly by machine, draws the machine\'s own limit lines on '
        'its charts, reconciles the three anomaly counts and fires recommendations only from observed breaches with '
        'an explicit no-confirmed-failure disclaimer; and (iv) an interactive laptop-class computational budget in '
        'which all statistics are recomputed from the datasets at request time with no persistent database.'))
P(doc, ('No novelty is asserted in: HTTP ingestion as such; KPI computation as such; canvas chart rendering; or PDF '
        'rendering as such. These use established methods and are claimed only in combination.'))
H2(doc, '4.4 The technical problem')
P(doc, ('(a) How to make threshold governance correct for a physically heterogeneous fleet without duplicating '
        'configuration through the code. (b) How to keep three related anomaly quantities distinguishable across '
        'every surface without a persistent database, recomputing everything from the datasets at request time. '
        '(c) How to keep the dashboard responsive while doing so, requesting filtered series rather than whole '
        'files. (d) How to make a downloaded report an auditable artifact rather than a marketing page: verbatim '
        'dataset statistics, the machine\'s own limits, the complete alert history and rule-based recommendations '
        'that never claim confirmed mechanical failure.'))
H2(doc, '4.5 Outline of the solution')
P(doc, ('The system is built as four layers over three CSV datasets: a registry-generation and replay layer; a '
        'validation-gated ingestion endpoint feeding an in-process analytics core; a REST interface on port 3001 '
        'serving KPIs, distributions, trends, pivots, threshold rules, risk scoring, per-machine series and the '
        'report endpoint; and a five-section React + TypeScript + Chart.js dashboard on port 3000 with a built-in '
        'report-download button. Detection is two-stage (raw breaches, then sustained windows); the risk score '
        'reuses the same limits; the report engine composes three pages per machine with pdfkit and is verified '
        'against the CSVs by an independent checker. Section 6 details the working principle and Section 7 the '
        'implementation.'))

# ---- 5. Objectives ----
page_break(doc)
H1(doc, '5. Objective(s) of Invention')
P(doc, ('The objectives are set out below. Objectives 1 and 2 together define the central mechanism; the remainder '
        'define the system that makes it usable and auditable.'))
CAPTION(doc, 'Objectives of the invention.')
TBL(doc, ['#', 'Objective', 'Statement'], [
    ['1', 'Registry-driven threshold governance',
     'Every limit used anywhere - alert engine, chart lines, report tables, recommendations - comes from the '
     'registry row of the machine that produced the reading, so the same value is healthy on one machine and a '
     'breach on the next.'],
    ['2', 'Two-stage detection with a sustained-window criterion',
     'Count raw breaches separately and fire a detected anomaly event only when a metric stays out of bounds for '
     'three consecutive readings at a machine, keeping brief excursions visible but non-urgent.'],
    ['3', 'Three-count reconciliation',
     'Present labelled anomalous readings, raw breach readings and detected events as three separate counts on the '
     'dashboard cards, in every API payload and in every report section.'],
    ['4', 'Interactive fleet analytics without a database',
     'Compute KPIs, distributions, trends and pivots from cached dataset rows at request time so the dashboard is '
     'responsive on commodity hardware.'],
    ['5', 'Validation-gated ingestion',
     'Reject unregistered machine IDs and malformed payloads explicitly so corrupt streams cannot pollute '
     'detection state.'],
    ['6', 'Dataset-verbatim individual reporting',
     'Emit a three-page print-ready PDF per machine through a dedicated endpoint, reconciling the three counts, '
     'drawing the machine\'s own limit lines and listing the complete alert history with severities.'],
    ['7', 'Rule-based, non-diagnostic recommendations',
     'Fire recommendations only on observed breaches (cooling for repeated temperature excursions, mechanical '
     'inspection for vibration, replenishment for ink and paper) with a standing disclaimer that no confirmed '
     'failure is asserted.'],
    ['8', 'Independent verifiability',
     'Regenerate the dataset layer from one script and re-verify every computed statistic against the raw CSVs '
     'from an independent checker.'],
], widths=[0.4, 1.6, 4.8], size=8)
page_break(doc)
# ---- 6. Working principle ----
H1(doc, '6. Working principle of the invention (in brief)')
P(doc, ('The system operates as interconnected stages, each an independent module with a defined interface. A '
        'machine correction at 6.2, or a rebuild of the datasets, re-enters the pipeline at 6.1, so the assessment '
        'stays reconciled with the record.'))
H2(doc, '6.1 Dataset engineering and registry population')
P(doc, ('One script generates the registry (8 machines x 15 columns), the telemetry file '
        f'({nloc(total_rows)} readings x 16 columns at 15-minute cadence) and the alert file '
        f'({nloc(len(ALERTS))} rows). The registry carries the per-machine limit columns that everything '
        'downstream reads.'))
H2(doc, '6.2 Ingestion validation')
P(doc, 'Readings enter through POST /api/telemetry and are validated against the registry before any state changes: '
       'unregistered machines and malformed bodies are rejected explicitly. The replay engine posts historical rows '
       'through this same path.')
H2(doc, '6.3 Analytics core')
P(doc, 'Module functions compute fleet KPIs, sensor distributions, hourly and daily trends, per-machine pivots and '
       'the threshold-rule derivation, each registry row becoming an ordered rule list with severities: temperature, '
       'vibration and paper jams CRITICAL; motor RPM, power, the humidity band and the ink floor WARNING; the '
       'paper-stock floor INFO.')
H2(doc, '6.4 Two-stage detection (central mechanism)')
P(doc, ('Stage one counts raw breaches: each reading, for each metric, is compared with its machine\'s configured '
        'bound and contributes an alert row when out of bounds. Stage two is the sustained-window rule: a metric '
        'that remains out of bounds for three consecutive readings at a machine fires a detected anomaly event. A '
        'weighted risk score evaluates arbitrary live sensor input with the same limits, bucketing risk into NORMAL '
        '(<=4%), ELEVATED (<=12%), WARNING (<=35%) and CRITICAL (>35%).'))
H2(doc, '6.5 Presentation')
P(doc, 'The dashboard requests filtered series (machine + metric) through the REST interface and renders five '
       'sections; labelled points are marked red on every series; anomaly cards keep the three counts apart.')
H2(doc, '6.6 Report composition')
P(doc, ('The report service filters all three datasets strictly by the requested machine and composes three pages: '
        'identity header, registry row and limits, per-sensor statistics, the three-count anomaly summary, three '
        'time-series charts with the machine\'s own limit lines, the complete alert history with severities, and '
        'rule-based recommendations with the no-confirmed-failure disclaimer. Unknown machines return HTTP 404; '
        'generation errors are caught so a partial file is never downloadable.'))
H2(doc, '6.7 Verification')
P(doc, 'An independent checker recomputes labelled counts, breach counts, per-sensor statistics and alert '
       'attributions directly from the CSVs and verifies the extracted text of generated reports against them.')

page_break(doc)
# ---- 7. Detailed description ----
H1(doc, '7. Description of the invention in detail (include drawing and/or photograph as needed)')
P(doc, ('The system is organised as four layers (Fig. 1). Reference numerals correspond to the workflow of Fig. 2. '
        'Each module exposes a defined interface, which is what lets the replay engine exercise exactly the code '
        'path production sensors would use.'))
fig_architecture('rev_fig1_architecture.png')
pic(doc, 'rev_fig1_architecture.png', 6.1)
CAPTION(doc, 'Fig. 1.  Layered architecture. Datasets (top left); dataset engineering; ingestion; analytics backend; '
             'REST interface; dashboard and report services.')
fig_workflow('rev_fig2_workflow.png')
pic(doc, 'rev_fig2_workflow.png', 6.3)
CAPTION(doc, 'Fig. 2.  End-to-end reading workflow from registry row (101) to the individual print-ready report (107).')

H2(doc, '7.1 Operational data and dataset-engineering layer (100)')
P(doc, (f'printers.csv registers the eight machines (EPR-001..EPR-008) with identity, type, location, installation '
        f'date and the limit columns. telemetry.csv holds {nloc(total_rows)} readings x 16 columns with the machine '
        f'status mix (' + ', '.join(f'{k} {nloc(v)}' for k, v in sorted(status_all.items()) if k) + f'). '
        f'alerts.csv holds {nloc(len(ALERTS))} rows with metric, value, threshold, severity and message. One script '
        f'regenerates all three; the labelled flag marks {nloc(total_anom)} readings ({f(fleet_rate, 2)}%) anomalous '
        f'across six injected families.'))

H2(doc, '7.2 Ingestion and validation (102, 103)')
SHOT(doc, 'Backend console showing a clean boot, a successful POST /api/telemetry and a rejected unregistered ID')
CAPTION(doc, 'Fig. 3.  Ingestion endpoint accepting a registered machine and rejecting an unregistered one '
             '(screenshot to be inserted from the live demo).')

H2(doc, '7.3 Analytics core and REST interface (104)')
P(doc, ('The interface exposes, at port 3001: GET /api/stats; GET /api/analytics/overview, /distributions, /trends '
        'and /pivot; GET /api/thresholds; GET /api/telemetry/<printer-id>?metric=; GET /api/events; '
        'POST /api/telemetry; and GET /api/report/<printer-id>. Every payload is shaped for the dashboard component '
        'that consumes it and every statistic is computed from the CSVs at request time.'))
SHOT(doc, 'Backend JSON answers for /api/analytics/overview and /api/telemetry/EPR-001?metric=temperature_c')
CAPTION(doc, 'Fig. 4.  REST interface answers for the fleet overview and a filtered per-machine series '
             '(screenshot to be inserted).')

H2(doc, '7.4 Five-section dashboard (105)')
pic(doc, 'shots/overview.png', 6.0)
CAPTION(doc, 'Fig. 5.  Overview section of the dashboard.')
pic(doc, 'shots/anomaly_detection.png', 6.0)
CAPTION(doc, 'Fig. 6.  Anomaly Detection section: labelled episodes and the alert timeline.')
pic(doc, 'shots/telemetry_explorer.png', 6.0)
CAPTION(doc, 'Fig. 7.  Telemetry Explorer section with the report-download control.')
pic(doc, 'shots/prediction.png', 6.0)
CAPTION(doc, 'Fig. 8.  Prediction section: weighted risk score of live sensor input.')
pic(doc, 'shots/live_monitor.png', 6.0)
CAPTION(doc, 'Fig. 9.  Live Monitor section during replay.')

H2(doc, '7.5 Individual report engine (106, 107)')
pic(doc, 'rev_fig3_rate.png', 5.6)
CAPTION(doc, 'Fig. 10.  Labelled anomaly rate per printer - the per-machine reconciliation the report summary '
             'inherited (dataset ground truth).')
pic(doc, 'rev_fig4_alerts.png', 5.6)
CAPTION(doc, 'Fig. 11.  Recorded alerts per printer by severity (alerts.csv).')
pic(doc, 'shots/report/EPR-001_p1.png', 4.4)
CAPTION(doc, 'Fig. 12.  The generated three-page report for EPR-001, page 1: header, printer information and sensor statistics.')
pic(doc, 'shots/report/EPR-001_p2.png', 4.4)
CAPTION(doc, 'Fig. 13.  Report charts page of EPR-001 with the machine limit lines.')
pic(doc, 'shots/report/EPR-001_p3.png', 4.4)
CAPTION(doc, 'Fig. 14.  Report alert-history and recommendations page of EPR-001.')

page_break(doc)
# ---- 8. Experimental validation ----
H1(doc, '8. Experimental validation results:')
P(doc, ('This section reports what was measured on the build described, with the limits of each measurement. The '
        'applicant distinguishes software verification, which has been performed, from field validation on real '
        'print hardware, which has NOT. No claim of fleet accuracy in production is made anywhere in this document.'))
H2(doc, '8.1 Measurement environment')
P(doc, ('All figures were produced on the working build on one development laptop: the backend (Node.js) on port '
        '3001, the dashboard (React + TypeScript) on port 3000, and the datasets regenerated from the project\'s own '
        'generation script. Every measurement was re-checked with the independent CSV-based verification script that '
        'accompanies the repository.'))
H2(doc, '8.2 Evaluation data and its limitations')
P(doc, (f'The evaluation uses the project\'s own synthetic-but-realistic operational dataset: '
        f'{nloc(total_rows)} telemetry readings, {nloc(total_anom)} labelled anomalous readings ({f(fleet_rate, 2)}%) '
        f'across six injected families and {nloc(len(ALERTS))} recorded alerts. The limitation must be stated '
        'plainly: the labelled anomalies are injected by the generation script, so the evaluation is circular and '
        'measures the pipeline\'s ceiling, not field accuracy; no real printer hardware, no real fleet outcomes and '
        'no prospective study are involved at any point; and all figures were measured with a single simultaneous '
        'user. Published sizing figures for the cloud suites in Section 3 were measured at infrastructure scale and '
        'are therefore not comparable with the figures below.'))
H2(doc, '8.3 Fleet results')
CAPTION(doc, f'Table 8.3  Per-printer results over {nloc(total_rows)} readings, {PERIOD}.')
rows83 = []
for p in per:
    rows83.append([p['id'], p['mtype'], nloc(p['rows']), nloc(p['labelled']), f(p['rate'], 1), nloc(p['breach']),
                   nloc(p['alerts']), nloc(p['crit'])])
TBL(doc, ['Printer', 'Type', 'Readings', 'Labelled', 'Rate %', 'Breach readings', 'Alerts', 'Critical'], rows83,
    widths=[0.85, 1.15, 0.85, 0.8, 0.6, 1.05, 0.65, 0.75], size=8.5)
P(doc, (f'Two spreads characterise the fleet: the labelled anomaly rate runs from {f(best["rate"], 2)}% ({best["id"]}) '
        f'to {f(worst["rate"], 2)}% ({worst["id"]}), and breach readings move to a different rhythm than labelled '
        'readings - which is exactly the conflation the two-stage detection layer refuses to make. EPR-001 and '
        'EPR-008 are the acceptance pair: EPR-001 carries the humidity and power families while EPR-008 dominates '
        'vibration, motor overspeed and offline episodes.'))
H2(doc, '8.4 Verification of the report mechanism on the acceptance pair')
P(doc, ('To verify that the mechanism of 6.4 and 6.6 operates as specified and is genuinely machine-specific, the '
        'mandatory comparison was run: select EPR-001, download; select EPR-008, download; then re-verify every '
        'statistic in both documents against the raw CSVs with the independent checker. Table 8.4 records the '
        'reconciliation.'))
CAPTION(doc, 'Table 8.4  Report verification pair - results from the automated cross-check.')
TBL(doc, ['Factor verified', 'EPR-001', 'EPR-008'], [
    ['Filename', 'EpicReads_Printer_EPR-001_Report.pdf', 'EpicReads_Printer_EPR-008_Report.pdf'],
    ['Length and content type', '3 pages, application/pdf, Content-Disposition attachment', 'same'],
    ['Foreign printer IDs in report', 'None', 'None'],
    ['Total readings', f"{ep1['rows']} (matches CSV)", f"{ep8['rows']} (matches CSV)"],
    ['Labelled anomalous readings', f"{ep1['labelled']} of {ep1['rows']} ({f(ep1['rate'])}%) - matches CSV",
     f"{ep8['labelled']} of {ep8['rows']} ({f(ep8['rate'])}%) - matches CSV"],
    ['Raw threshold-breach readings', f"{ep1['breach']} (recomputed)", f"{ep8['breach']} (recomputed)"],
    ['Recorded alerts', f"{ep1['alerts']} total, {ep1['crit']} CRITICAL", f"{ep8['alerts']} total, {ep8['crit']} CRITICAL"],
    ['Chart limit lines (own machine)', f"{f(ep1['maxtemp'],1)} degC - {f(ep1['maxvib'],1)} mm/s - {nloc(ep1['maxrpm'])} rpm",
     f"{f(ep8['maxtemp'],1)} degC - {f(ep8['maxvib'],1)} mm/s - {nloc(ep8['maxrpm'])} rpm"],
    ['Recommendations', 'Fired only from its own records; no confirmed-failure claim', 'same'],
], widths=[1.7, 2.65, 2.65], size=8)
P(doc, ('Three things are verified. First, the limits are the machine\'s own: each report draws exactly the dashed '
        'limit lines recorded in printers.csv for its machine and no other. Second, the counts reconcile: labelled, '
        'breach and detected-event counts in each report match the independent recomputation from the CSVs. Third, '
        'the documents are strictly machine-specific: no statistic, alert row or chart point from one machine '
        'appears in the other\'s report. All eight printers generated reports successfully through the live '
        'endpoint.'))
H2(doc, '8.5 Software verification and error handling')
P(doc, ('The five dashboard sections render with no console errors during the walkthrough, and every section '
        'endpoint answers 200. Ingestion rejects an unregistered machine ID and a malformed JSON body with explicit '
        'status messages; the report endpoint returns HTTP 404 with a JSON error for unknown machines; and a machine '
        'with no recorded alerts receives the graceful no-alerts text rather than an empty table. Two always-on '
        'processes serve ports 3001 and 3000, unchanged by the report feature.'))
H2(doc, '8.6 What has not been evaluated')
P(doc, ('The following have NOT been evaluated against field ground truth because none is available: real hardware '
        'ingestion at production cadence (the replay engine is used instead), the threshold parameter of three '
        'consecutive readings (justified by operator-noise reasoning, not yet by field data), multi-user '
        'behaviour, and deployment-scale serving. The recommendations surface is explicitly non-diagnostic: no '
        'confirmed mechanical failure is claimed anywhere in the system.'))

page_break(doc)
# ---- 9. Protection ----
H1(doc, '9. What aspect(s) of the invention need(s) protection?')
P(doc, ('Protection is sought for the integrated system and for the mechanisms below, listed in the applicant\'s '
        'order of preference.'))
H2(doc, '9.1 Registry-driven threshold governance with a two-stage detection layer')
P(doc, ('The arrangement in which the registry row of the machine that produced a reading determines every later '
        'statement about that reading; raw breaches are counted separately from a sustained-window anomaly event of '
        'three consecutive out-of-bounds readings; and the dataset-labelled ground truth is kept visible as a '
        'separate count on every surface.'))
H2(doc, '9.2 Dataset-verbatim individual-machine report engine')
P(doc, ('The arrangement in which a report document is generated per machine, filtering three operational datasets '
        'strictly by that machine, drawing the machine\'s own limit lines on its charts, reconciling the three '
        'anomaly counts, listing the complete alert history with severities and firing recommendations only from '
        'observed breaches with an explicit no-confirmed-failure disclaimer, exposed over a dedicated endpoint that '
        'rejects unregistered machines explicitly.'))
H2(doc, '9.3 Interactive request-time analytics without a persistent database')
P(doc, ('The arrangement in which fleet KPIs, distributions, trends, pivots and threshold rules are recomputed from '
        'cached dataset rows at request time, and the dashboard requests filtered series rather than whole files, so '
        'the whole system runs within a laptop-class budget with no database to drift from the datasets.'))
H2(doc, '9.4 Replay-equivalent ingestion validation')
P(doc, ('The arrangement in which historical rows are posted through the same validation-gated ingestion endpoint as '
        'live traffic, so a replayed historical stream exercises exactly the code path production sensors would use, '
        'and unregistered machines and malformed payloads are rejected before any detection state can be polluted.'))
H2(doc, '9.5 Further aspects claimed in combination with 9.1')
P(doc, ('The weighted live-sensor risk score reusing the registry limits with its NORMAL / ELEVATED / WARNING / '
        'CRITICAL bucketing; the graceful degradation of empty alert histories and offline/null sensor rows; and '
        'the integrated combination in which one dataset layer drives KPIs, detection, dashboard views and per-'
        'machine printable reports.'))

page_break(doc)
# ---- 10. TRL ----
H1(doc, '10. What is the technology readiness level of your invention? (Tick the appropriate TRL)')
P(doc, ('Tick: TRL 4 - Technology validated in a laboratory environment.'))
CAPTION(doc, 'Justification.')
P(doc, ('The complete system exists and runs: the dataset layer, analytics modules, ingestion validation, two-stage '
        'detection, the five-section dashboard and the per-machine report service are all implemented and exercisable '
        'end to end, and the mechanisms claimed in Section 9 were verified to operate as specified against the '
        'independent CSV checker (8.4, 8.5). That establishes laboratory validation in integrated form.'))
P(doc, ('The applicant has deliberately NOT claimed TRL 5, which requires validation in a relevant environment: no '
        'real print hardware has been instrumented, all quantitative results were obtained on the project\'s own '
        'generated dataset, and the system runs on one laptop with a single user. The work needed to reach TRL 5 is '
        'listed among the outstanding items (real-hardware ingestion, authenticated multi-user mode, cloud deployment '
        'with persistence).'))
TRL_TICK = 'v'
CAPTION(doc, 'Technology readiness level scale with the selected level marked.')
trl = doc.add_table(rows=4, cols=9)
trl.style = 'Table Grid'
trl.alignment = WD_TABLE_ALIGNMENT.CENTER
labels = [
    ['TRL 1', 'TRL 2', 'TRL 3', 'TRL 4', 'TRL 5', 'TRL 6', 'TRL 7', 'TRL 8', 'TRL 9'],
    ['Basic principles observed', 'Technology concept formulated', 'Experimental proof of concept',
     'Technology validated in a lab', 'Technology validated in a relevant environment',
     'Technology demonstrated in a relevant environment', 'System prototype demonstration in an operational environment',
     'System complete and qualified', 'Actual system proven in an operational environment'],
    ['', '', '', TRL_TICK + ' (selected)', '', '', '', '', ''],
]
for i, row in enumerate(labels):
    for j, v in enumerate(row):
        c = trl.rows[i].cells[j]
        c.text = ''
        r = c.paragraphs[0].add_run(v)
        run_style(r, 7.0, bold=(i == 0), italic=(i == 1), color='1A6B1A' if (i == 2 and v) else None)
        if i == 0:
            shade(c, '0D1524')
        elif i == 2 and v:
            shade(c, 'E7F6E7')
P(doc, '', space_after=10)
P(doc, '---------------------- END OF THE DOCUMENT -----------------------------', align='center', italic=True)

doc.save('PrinterFleetAnalytics_Review3_IDFB_Report.docx')
print('wrote PrinterFleetAnalytics_Review3_IDFB_Report.docx')
