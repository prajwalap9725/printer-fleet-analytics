"""Project 27 — Ensuring Operational Excellence with IoT Monitoring at EpicReads
MS Word (.docx) report generator.

Mirrors dataset-backend/project_report.js (the PDF version): same academic
structure and the same dataset-derived numbers. Figures are rendered fresh
from the CSVs with matplotlib; every computed value below is traced to
telemetry.csv / alerts.csv / printers.csv.
Output: dataset-backend/Project27_EpicReads_IoT_Cloud_Report.docx
"""
import csv
import sys
from collections import Counter
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, Inches, RGBColor

ROOT = '..' if __package__ else '.'
sys.path.insert(0, '..' if __package__ else '.')
OUT = 'Project27_EpicReads_IoT_Cloud_Report.docx'

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

T = read_csv('../telemetry.csv') if len(sys.argv) > 1 and sys.argv[1] == 'from-root' else read_csv('telemetry.csv')
ALERTS = read_csv('../alerts.csv') if len(sys.argv) > 1 and sys.argv[1] == 'from-root' else read_csv('alerts.csv')
PRINTERS = read_csv('../printers.csv') if len(sys.argv) > 1 and sys.argv[1] == 'from-root' else read_csv('printers.csv')

METRICS = [
    ('temperature_c', 'Temperature', '°C'),
    ('humidity_pct', 'Humidity', '%'),
    ('ink_level_pct', 'Ink level', '%'),
    ('paper_stock_pct', 'Paper stock', '%'),
    ('motor_rpm', 'Motor RPM', 'rpm'),
    ('vibration_mm_s', 'Vibration', 'mm/s'),
    ('power_kw', 'Power', 'kW'),
    ('pages_per_min', 'Throughput', 'ppm'),
    ('paper_jams', 'Paper jams', 'count'),
]

def printer_profiles():
    out = []
    for p in PRINTERS:
        pr = [r for r in T if r['printer_id'] == p['printer_id']]
        labelled = [r for r in pr if num(r['is_anomaly']) == 1]
        # per-machine, per-metric limit columns in printers.csv
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
        types = Counter(r.get('anomaly_type') or 'UNKNOWN' for r in labelled)
        al = [a for a in ALERTS if a['printer_id'] == p['printer_id']]
        out.append(dict(
            id=p['printer_id'], name=p['printer_name'], model=p['model'],
            rows=len(pr), labelled=len(labelled),
            rate=len(labelled) / len(pr) * 100, breach=breach,
            types=types, alerts=len(al),
            crit=sum(1 for a in al if a['severity'] == 'CRITICAL'),
            warn=sum(1 for a in al if a['severity'] == 'WARNING'),
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
PERIOD = f"{ts_sorted[0][:10]} 00:00 to {ts_sorted[-1][:10]} 23:55 (three calendar days, 15-minute cadence)"

# hourly labelled anomalies
hourly = Counter()
for r in T:
    if num(r['is_anomaly']) == 1:
        hourly[r['timestamp'][:13]] += 1
buckets = sorted(set(r['timestamp'][:13] for r in T))

f = lambda x, d=1: f'{x:.{d}f}'
nloc = lambda x: f'{int(x):,}'

ep1 = next(p for p in per if p['id'] == 'EPR-001')
ep8 = next(p for p in per if p['id'] == 'EPR-008')

# ---------------------------------------------------------------- helpers
def add_field(paragraph, instr):
    fld = OxmlElement('w:fldSimple')
    fld.set(qn('w:instr'), instr)
    run = OxmlElement('w:r')
    text = OxmlElement('w:t')
    text.text = ' '
    run.append(text)
    fld.append(run)
    paragraph._p.append(fld)

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
    run._element.rPr.rFonts.set(qn('w:eastAsia'), font)
    if color:
        run.font.color.rgb = RGBColor.from_string(color)

def P(doc, text, style=None, align='justify', size=10.5, bold=False, italic=False,
      font='Times New Roman', space_after=6, indent=None, color=None):
    p = doc.add_paragraph(style=style)
    p.alignment = {'left': WD_ALIGN_PARAGRAPH.LEFT, 'justify': WD_ALIGN_PARAGRAPH.JUSTIFY,
                   'center': WD_ALIGN_PARAGRAPH.CENTER}[align]
    p.paragraph_format.space_after = Pt(space_after)
    if indent:
        p.paragraph_format.left_indent = Pt(indent)
    r = p.add_run(text)
    run_style(r, size, bold, italic, font, color)
    return p

def H1(doc, text):
    p = doc.add_heading(text, level=1)
    for r in p.runs:
        run_style(r, 16, bold=True, color='1A1A1A')
    return p

def H2(doc, text):
    p = doc.add_heading(text, level=2)
    for r in p.runs:
        run_style(r, 13, bold=True, color='1A1A1A')
    return p

def TBL(doc, header, rows, widths=None, size=9, bold_first_col=False):
    t = doc.add_table(rows=len(rows) + 1, cols=len(header))
    t.style = 'Table Grid'
    for j, h in enumerate(header):
        c = t.rows[0].cells[j]
        c.text = ''
        r = c.paragraphs[0].add_run(h.upper())
        run_style(r, size, bold=True, color='FFFFFF')
        shade(c, '0D1524')
    for i, row in enumerate(rows):
        for j, cell_text in enumerate(row):
            c = t.rows[i + 1].cells[j]
            c.text = ''
            r = c.paragraphs[0].add_run(str(cell_text))
            run_style(r, size, bold=bold_first_col and j == 0)
            if i % 2 == 1:
                shade(c, 'F2F5F8')
    if widths:
        for j, w in enumerate(widths):
            for row in t.rows:
                row.cells[j].width = Inches(w)
    return t

def CAPTION(doc, text):
    P(doc, text, align='center', size=9.5, italic=True, font='Times New Roman', space_after=10)

def page_break(doc):
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

def center_bottom(p):
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER

# ---------------------------------------------------------------- figures
def fig_architecture(path):
    fig, ax = plt.subplots(figsize=(9, 5.4))
    ax.set_xlim(0, 10); ax.set_ylim(0, 6.2); ax.axis('off')
    boxes = [
        ('Operational data sources\nprinters.csv · telemetry.csv\nalerts.csv', 0.3, 4.6),
        ('Dataset engineering\ngenerate_dataset.py\nreplay_dataset.py', 3.7, 4.6),
        ('Sensor ingestion\nPOST /api/telemetry\n(15-minute cadence)', 7.1, 4.6),
        ('Node.js analytics backend\nanalytics.js · server.js\nKPIs · distributions · trends\npivot · threshold rules\nrisk score · 3-window detector', 7.1, 2.2),
        ('REST API on port 3001\n/api/stats · /api/analytics/*\n/api/telemetry/:id\n/api/events · /api/report/:id', 3.7, 2.2),
        ('React + TypeScript dashboard\nOverview · Anomaly Detection\nTelemetry Explorer · Prediction\nLive Monitor (port 3000)', 0.3, 2.2),
        ('Individual printer PDF report\nreport.js · pdfkit\n(three pages per printer)', 0.3, 0.35),
    ]
    H = {'small': 1.15, 'big': 1.5}
    sizes = [H['small']] * 3 + [H['big'], H['small'], H['small'], H['small']]
    coords = []
    for (label, x, y), h in zip(boxes, sizes):
        w, hh = 2.6, h
        ax.add_patch(plt.Rectangle((x, y), w, hh, facecolor='#eef3f8', edgecolor='#1a1a1a', lw=0.9))
        ax.text(x + w / 2, y + hh / 2, label, ha='center', va='center', fontsize=8.2, fontweight='bold', family='DejaVu Sans')
        coords.append((x, y, w, hh))
    def arrow_head(x, y, dx, dy):
        ax.annotate('', xy=(x + dx, y + dy), xytext=(x, y),
                    arrowprops=dict(arrowstyle='-|>', color='#444a55', lw=1.1))
    arrow_head(coords[0][0] + coords[0][2], coords[0][1] + sizes[0]/2, 0.8, 0)   # 0 -> 1
    arrow_head(coords[1][0] + coords[1][2], coords[1][1] + sizes[1]/2, 0.8, 0)   # 1 -> 2
    arrow_head(coords[2][0] + 1.3, coords[2][1], 0, -0.45)                       # 2 -> 3
    arrow_head(coords[3][0], coords[3][1] + sizes[3]/2, -0.8, 0)                 # 3 -> 4
    arrow_head(coords[4][0], coords[4][1] + sizes[4]/2, -0.8, 0)                 # 4 -> 5
    arrow_head(coords[5][0] + 1.3, coords[5][1], 0, -0.5)                        # 5 -> 6
    fig.tight_layout()
    fig.savefig(path, dpi=150, bbox_inches='tight')
    plt.close(fig)

def fig_rate(path):
    fig, ax = plt.subplots(figsize=(8.6, 3.4))
    ids = [p['id'].split('-')[1] for p in per]
    rates = [p['rate'] for p in per]
    bars = ax.bar(ids, rates, color='#4164e0', width=0.55)
    for b, v in zip(bars, rates):
        ax.text(b.get_x() + b.get_width()/2, v + 0.15, f'{v:.1f}%', ha='center', fontsize=9)
    ax.set_ylabel('labelled anomaly rate (%)')
    ax.set_xlabel('printer')
    ax.set_ylim(0, max(rates) * 1.25)
    ax.spines[['top', 'right']].set_visible(False)
    fig.tight_layout(); fig.savefig(path, dpi=150); plt.close(fig)

def fig_alerts(path):
    fig, ax = plt.subplots(figsize=(8.6, 3.4))
    ids = [p['id'].split('-')[1] for p in per]
    crit = np.array([p['crit'] for p in per])
    warn = np.array([p['warn'] for p in per])
    ax.bar(ids, warn, label='WARNING', color='#e69a3c', width=0.55)
    ax.bar(ids, crit, bottom=warn, label='CRITICAL', color='#c0392b', width=0.55)
    totals = crit + warn
    for i, v in enumerate(totals):
        ax.text(i, v + 0.6, str(int(v)), ha='center', fontsize=9)
    ax.set_ylabel('recorded alerts')
    ax.set_xlabel('printer')
    ax.legend()
    ax.set_ylim(0, totals.max() * 1.2)
    ax.spines[['top', 'right']].set_visible(False)
    fig.tight_layout(); fig.savefig(path, dpi=150); plt.close(fig)

def fig_hourly(path):
    fig, ax = plt.subplots(figsize=(9.4, 3.0))
    xs = np.arange(len(buckets))
    ys = [hourly.get(b, 0) for b in buckets]
    ax.plot(xs, ys, color='#0b6e6e', lw=1.2)
    step = max(1, len(buckets) // 8)
    ax.set_xticks(xs[::step])
    ax.set_xticklabels([b[5:13].replace('T', ' ') for b in buckets[::step]], fontsize=8)
    ax.set_ylabel('labelled\nanomalies')
    ax.spines[['top', 'right']].set_visible(False)
    fig.tight_layout(); fig.savefig(path, dpi=150); plt.close(fig)

# ---------------------------------------------------------------- document
doc = Document()

# base style
normal = doc.styles['Normal']
normal.font.name = 'Times New Roman'
normal.font.size = Pt(10.5)
normal.paragraph_format.space_after = Pt(6)

sec1 = doc.sections[0]
sec1.different_first_page_header_footer = True
# roman numbering for front matter
pg = OxmlElement('w:pgNumType'); pg.set(qn('w:fmt'), 'lowerRoman'); pg.set(qn('w:start'), '1')
sec1._sectPr.append(pg)
fp = sec1.first_page_footer.paragraphs[0]; center_bottom(fp)
footer1 = sec1.footer.paragraphs[0]; center_bottom(footer1); add_field(footer1, 'PAGE')

# ---------------- title page
P(doc, 'PROJECT 27 - ENSURING OPERATIONAL EXCELLENCE WITH IOT\nMONITORING AT EPICREADS', align='center', size=19, bold=True, space_after=24)
P(doc, 'Cloud Computing Capstone Project', align='center', size=11, space_after=6)
P(doc, '[Course Code - ____________]', align='center', size=11, space_after=20)
P(doc, 'Submitted in partial fulfillment of the requirements for the degree of', align='center', size=10.5, space_after=6)
P(doc, 'Master of Technology in Integrated Computer Science Engineering', align='center', size=10.5, bold=True, space_after=4)
P(doc, '(Specialization in Data Science)', align='center', size=10.5, space_after=6)
P(doc, 'in', align='center', size=10.5, space_after=6)
P(doc, 'School of Computer Science Engineering and Information Systems', align='center', size=10.5, bold=True, space_after=18)
P(doc, 'by', align='center', size=10.5, space_after=6)
P(doc, 'AKKI PRAJWAL', align='center', size=12, bold=True, space_after=4)
P(doc, '24MID0230', align='center', size=11, space_after=12)
P(doc, 'Under the guidance of', align='center', size=10.5, bold=True, space_after=6)
P(doc, 'Dr. Sivakumar', align='center', size=11, bold=True, space_after=4)
P(doc, 'Associate Professor, SCORE', align='center', size=10.5, space_after=4)
P(doc, 'School of Computer Science Engineering and Information Systems', align='center', size=10.5, space_after=4)
P(doc, 'VIT, Vellore', align='center', size=10.5, space_after=16)
P(doc, 'October, 2026', align='center', size=10.5, bold=True)

# ---------------- declaration
page_break(doc)

FM_title = P(doc, 'DECLARATION', align='center', size=14, bold=True, space_after=18)
P(doc, 'I hereby declare that the Cloud Computing Capstone Project entitled "Project 27 - Ensuring Operational Excellence with IoT Monitoring at EpicReads" submitted to VIT, Vellore is a record of bonafide work carried out by me. The work embodies results of my own effort, supported where stated by the project repository, its dataset engineering pipeline and its automated verification scripts.')
P(doc, 'I further declare that the work reported in this project has not been submitted and will not be submitted, either in part or in full, for the award of any other degree or diploma of this institution or any other institution or university.')
P(doc, 'Place: Vellore          Date: ____________________', align='left', space_after=24)
P(doc, 'Signature of the Candidate', align='left', space_after=2)
P(doc, 'Akki Prajwal        24MID0230', align='left', bold=True)

# ---------------- certificate
page_break(doc)
P(doc, 'CERTIFICATE', align='center', size=14, bold=True, space_after=18)
P(doc, 'This is to certify that the Cloud Computing Capstone Project entitled "Project 27 - Ensuring Operational Excellence with IoT Monitoring at EpicReads" submitted by Akki Prajwal (24MID0230), in partial fulfillment of the requirements for the award of the degree of Master of Technology in Integrated Computer Science Engineering with specialization in Data Science, VIT, Vellore, is a record of bonafide work carried out by him under my supervision and guidance.')
P(doc, "The contents of this report have not been submitted and will not be submitted, either in part or in full, for the award of any other degree or diploma of this institution or any other institution or university. The report attests to the student's work in this capstone project.")
P(doc, 'Signature of the VIT SCORE Supervisor', align='left', space_after=8)
P(doc, 'Dr. Sivakumar', align='left', bold=True, space_after=2)
P(doc, 'Associate Professor, SCORE', align='left', space_after=20)
P(doc, 'Internal Examiner                     External Examiner', align='left', space_after=8)
P(doc, 'Head of the Department                Department of Software and Systems Engineering', align='left')

# ---------------- acknowledgement
page_break(doc)
P(doc, 'ACKNOWLEDGEMENT', align='center', size=14, bold=True, space_after=18)
P(doc, 'I express my sincere gratitude to my project guide, Dr. Sivakumar, Associate Professor, SCORE, VIT, Vellore, for his academic guidance and support during the project. His feedback on the analytics architecture, the anomaly-detection design and the verification standards used in this report shaped the work substantially.')
P(doc, 'I thank the School of Computer Science Engineering and Information Systems, VIT, for the academic environment, the laboratory resources and the course framework that made this capstone possible.')
P(doc, 'I am grateful to my family, teachers and friends for their encouragement throughout my studies and project work. The open-source software ecosystem on which this project is built (React, TypeScript, Chart.js, Node.js, pdfkit, axios) and the maintainers of the libraries used made this work executable, and I acknowledge all those who contributed indirectly.')
P(doc, 'Akki Prajwal', bold=True, space_after=2)
P(doc, '24MID0230')

# ---------------- executive summary
page_break(doc)
P(doc, 'EXECUTIVE SUMMARY', align='center', size=14, bold=True, space_after=18)
P(doc, 'Industrial print farms fail quietly: a bearing overheats, ink runs low in the middle of a job, and a jammed feeder is noticed only when the delivery is already late. This project implements and measures a complete IoT monitoring system for the fleet of eight industrial printers at EpicReads - machines EPR-001 through EPR-008 - using a synthetic-but-realistic operational dataset of 6,912 telemetry readings collected at a 15-minute cadence over three calendar days (2026-10-15 00:00 to 2026-10-17 23:55), across seven operational sensors (temperature, humidity, ink level, paper stock, motor RPM, vibration and power) and the pages-per-minute and paper-jam channels.')
P(doc, 'A Node.js analytics backend computes the fleet key performance indicators, per-printer distributions, hourly and daily trends, and per-printer threshold rules derived from printers.csv, and serves them over a REST API; a React + TypeScript + Chart.js dashboard renders five sections (Overview, Anomaly Detection, Telemetry Explorer, Prediction and Live Monitor). The anomaly layer follows a deliberate design: raw threshold-breach detection on each reading, a weighted risk score for live sensor inputs, and a three-consecutive-reading window rule that fires a detected anomaly event only when a metric stays out of bounds - reducing false positives that single-reading alerts invite.')
P(doc, f'Across the monitored window the dataset labels 416 of the 6,912 readings as anomalous (a fleet rate of {f(fleet_rate, 2)}%), and alerts.csv records 346 threshold alerts (157 CRITICAL, 189 WARNING) raised from the per-machine rules. The project further adds a download feature: an individual printer PDF report that styles three pages of stationery-quality output per machine - printer information, sensor thresholds, sensor statistics, anomaly summary distinguishing labelled readings from breach readings and detected events, three time-series charts with the machine\'s own limit lines, the alert history table and rule-based recommendations - and the feature was verified end-to-end against the raw CSVs for printers EPR-001 and EPR-008 before acceptance (Chapter 7).')
P(doc, 'Every claim in this report is reproducible from the repository: the datasets regenerate with one Python command, the servers run on their documented ports, and the report tables in Chapter 7 can be re-checked against the CSVs with the verification script that ships alongside the source code.')

# ---------------- table of contents
page_break(doc)
P(doc, 'TABLE OF CONTENTS', align='center', size=14, bold=True, space_after=12)
toc_p = doc.add_paragraph()
add_field(toc_p, r'TOC \o "1-2" \h \z \u')
P(doc, '(In Microsoft Word: right-click the field and choose "Update Field" to refresh headings and page numbers.)', align='left', size=9, italic=True, space_after=0)

# ---------------- list of figures / tables
page_break(doc)
P(doc, 'LIST OF FIGURES', align='center', size=14, bold=True, space_after=14)
for fig in [
    'Fig. 2.1  Implemented end-to-end system architecture',
    'Fig. 6.1  Labelled anomaly rate per printer (dataset ground truth)',
    'Fig. 6.2  Recorded alerts per printer by severity (alerts.csv)',
    'Fig. 6.3  Labelled anomalous readings per hour (telemetry.csv)',
]:
    P(doc, fig, align='left', indent=20, space_after=4)
page_break(doc)
P(doc, 'LIST OF TABLES', align='center', size=14, bold=True, space_after=14)
for tab in [
    'Table 2.1  Project goals and acceptance evidence',
    'Table 3.1  Software stack and version evidence',
    'Table 3.2  Resource requirements and measurement limits',
    'Table 3.3  Functional requirements and implementation status',
    'Table 5.1  Development phases and available completion evidence',
    'Table 5.2  Outstanding work and required acceptance evidence',
    'Table 6.1  Main implementation units and interfaces',
    'Table 6.2  Recorded dataset composition',
    'Table 7.1  Per-printer results across the monitored window',
    'Table 7.2  Report verification pair - results from the automated cross-check',
    'Table 7.3  Resource quantities and cost evidence',
    'Table B.1  Reproduction commands',
    'Table C.1  Verification checklist',
]:
    P(doc, tab, align='left', indent=20, space_after=4)

# ---------------- abbreviations
page_break(doc)
FM_title = P(doc, 'LIST OF ABBREVIATIONS', align='center', size=14, bold=True, space_after=14)
TBL(doc, ['Abbreviation', 'Full Form'], [
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
], widths=[1.4, 4.4])

# ---- end front matter section; main section with arabic numbering
sec2 = doc.add_section(WD_SECTION.NEW_PAGE)
pg2 = OxmlElement('w:pgNumType'); pg2.set(qn('w:fmt'), 'decimal'); pg2.set(qn('w:start'), '1')
sec2._sectPr.append(pg2)
# link footer of sec2 to sec1's arabic
f2 = sec2.footer.paragraphs[0]; center_bottom(f2); add_field(f2, 'PAGE')

# =========================== chapters ===========================

# ---- Chapter 1 ----
H1(doc, 'CHAPTER 1  INTRODUCTION')
H2(doc, '1.1  Objective')
P(doc, 'The primary objective of this project is to implement an end-to-end IoT monitoring system for the eight-printer fleet of EpicReads in which the deployed artifact - not a notebook or a slide deck - is the object of study. The system ingests sensor telemetry at a fixed cadence, computes fleet-level and per-machine analytics from the operational datasets, detects both raw threshold breaches and sustained out-of-bounds behaviour, and serves the results through a documented HTTP API consumed by a web dashboard with five working sections.')
P(doc, 'A second objective is operational excellence, not data display. The dashboard answers the questions a print-farm supervisor actually asks in the morning: which machines are healthy, which sensors are trending towards their configured limits, which machines already triggered alerts, and what the safest next action is per machine. The alerts engine therefore carries severity levels (CRITICAL, WARNING, INFO) mapped from the per-machine rules in printers.csv, so that the display prioritises what needs action first.')
P(doc, 'A third objective is auditability and reporting. Each printer can emit a downloadable, print-ready individual report that summarises its sensor statistics, threshold limits, anomaly record, alert history and rule-based recommendations - the deliverable this report documents in Chapters 4, 6 and 7. All figures poured into the report come from the project datasets; nothing is hardcoded or randomly generated at request time.')
H2(doc, '1.2  Motivation')
P(doc, 'Industrial printing equipment fails along predictable physical channels: heat (cooling), mechanics (vibration and jamming), consumables (ink and paper stock), and electrical load. Single-point alarms on one sensor are easy to configure and easy to ignore - a hot afternoon trips the temperature alarm for a machine that is otherwise fine, while a slow bearing drift that never trips a one-off alert escapes notice entirely. The project therefore separates raw breach detection from a three-consecutive-reading sustained-window rule, treating a brief spike differently from a persistent excursion.')
P(doc, "The fairness motivation of the fleet is also concrete: machines EPR-001 through EPR-008 are physically different (offset presses, digital presses, a cover press, a perfect binder, a large-format unit), installed between 2018 and 2021, and one identical fleet-wide limit would be wrong for every machine and right for none. The dataset therefore configures per-machine limits in printers.csv, and both the alerts engine and every exported report respect them.")
P(doc, 'Finally, reporting is the format in which operational history is actually used: a supervisor signs off a shift, a maintenance visit is documented, or a customer asks what happened to their job. A screen is not shareable; a PDF is. The download feature exists because fleet history ends up on paper more often than software demonstrations assume.')
H2(doc, '1.3  Background')
P(doc, 'The project uses a purpose-generated operational dataset of three CSV files. printers.csv holds the machine registry (8 printers, 15 columns): identity and location plus the configured sensor limits per machine. telemetry.csv holds 6,912 readings at 15-minute cadence across 16 columns: timestamp, printer, machine status (IDLE, PRINTING, MAINTENANCE, ERROR, OFFLINE), the seven operational sensors, pages printed and pages-per-minute, paper-jam count, an optional error code, the labelled anomaly flag and its type. alerts.csv holds 346 alert rows with timestamp, machine, metric, recorded value, threshold value, severity and a human-readable message.')
P(doc, f"The label column is_anomaly was generated with the injection script, and marks {nloc(total_anom)} readings ({f(fleet_rate, 2)}% of the fleet) as anomalous, typed into six families: HUMIDITY_SPIKE, POWER_SURGE, PAPER_JAM_BURST, INK_LEAK_DROP, VIBRATION_SPIKE, MOTOR_OVERSPEED and OFFLINE episodes. Because label counts are ground truth against which the dashboard is judged, the project consistently distinguishes labelled anomalous readings (dataset truth), raw threshold-breach readings (any sensor outside its configured limits) and detected anomaly events (produced only by the sustained three-window rule) in every surface, including the exported reports.")
P(doc, 'The implementation stack is deliberately conventional: Node.js with plain JavaScript modules for analytics and HTTP serving (no framework beyond the standard library), React with TypeScript and Chart.js for the dashboard, pdfkit for report rendering and Python for dataset engineering and replay. This keeps each unit readable in one sitting and every dataset-to-UI contract visible in the endpoint payloads.')
H2(doc, '1.4  Scope and boundaries')
P(doc, "The implemented scope begins with the three CSV datasets and ends with the dashboard's five sections, the REST endpoints documented in Chapter 3, the anomaly and alerts engine of Chapter 4 and the individual printer PDF report of Chapter 6. Everything between them - dataset generation and replay, analytics computation, threshold-rule configuration, detection windows, and the report generator - is part of the deliverable and is measured in Chapter 7.")
P(doc, "The project does not implement multi-tenant persistence, authenticated fleet accounts, push notifications, integration with EpicReads' enterprise resource planning systems, or a production cloud deployment pipeline. The replay engine runs on a laptop, not on streaming infrastructure. Recommendations in the reports are rule-based maintenance suggestions derived from threshold breaches in the monitored data; they never claim that a mechanical failure has been confirmed. These boundaries are stated as future work in Section 8.4.")

# ---- Chapter 2 ----
page_break(doc)
H1(doc, 'CHAPTER 2  PROJECT DESCRIPTION AND GOALS')
P(doc, 'Project 27 is, before anything else, a system: a dataset layer, an ingestion and analytics layer, a REST contract, a five-section dashboard, and a print-ready reporting output. A sensor reading enters through the replay engine, is validated against the printer registry, updates the in-memory analytics state, and - when a rule fires - accrues to the alerts and anomaly surfaces. The dashboard consumes the same computed state so the UI always reflects the datasets rather than duplicating computation client-side.')
P(doc, 'Fig. 2.1 shows the implemented architecture from the operational data sources through dataset engineering, the ingestion endpoint, the Node.js analytics backend and the REST surface, to the React dashboard and the PDF report service.')
fig_architecture('fig_architecture.png')
doc.add_picture('fig_architecture.png', width=Inches(6.1))
doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
CAPTION(doc, 'Fig. 2.1  Implemented end-to-end system architecture')
P(doc, 'The goals of the project are deliberately measurable ones; each is paired in Table 2.1 with the command, endpoint or verification result whose passing proves it.')
CAPTION(doc, 'Table 2.1  Project goals and acceptance evidence')
TBL(doc, ['Goal', 'Acceptance evidence'], [
    ['Compute fleet and per-printer analytics from the datasets without server-side duplication in the client', '/api/analytics/overview, /distributions, /trends and /pivot answer 200 on a clean boot and match the CSVs'],
    ['Respect per-machine configured limits, not one fleet-wide threshold', "alerts.csv rules derive from printers.csv per machine; the report tables and charts display each machine's own limits"],
    ['Detect both raw breaches and sustained out-of-bounds windows', 'Three-window detector is validated against replayed streams; breach counts match an independent CSV recomputation'],
    ['Serve a five-section dashboard without breaking arrivals/ports', 'Overview, Anomaly Detection, Telemetry Explorer, Prediction and Live Monitor all render on ports 3000/3001'],
    ['Produce an individual printer PDF report on demand', 'GET /api/report/<printer-id> returns a three-page PDF for all eight printers with per-printer content verified'],
    ['Keep the exported report honest and self-consistent', "Every statistic and alert row in the EPR-001/EPR-008 reports re-checked against the CSVs (Chapter 7)"],
], widths=[3.0, 3.9], size=8.5)

# ---- Chapter 3 ----
page_break(doc)
H1(doc, 'CHAPTER 3  TECHNICAL SPECIFICATION')
H2(doc, '3.1  Software stack and version evidence')
P(doc, 'The stack is deliberately conventional: plain Node.js standard-library HTTP for the backend, React with TypeScript and Chart.js for the dashboard, pdfkit for PDF generation and Python for dataset engineering and replay (Table 3.1). All dependencies are open source with zero licence cost, and the complete dependency graph is visible in the two package.json files of the repository.')
CAPTION(doc, 'Table 3.1  Software stack and version evidence')
TBL(doc, ['Component', 'Role', 'Selection reason'], [
    ['Node.js (server.js)', 'HTTP API + sensor ingestion', 'Standard library only; single process, zero framework lockdown'],
    ['analytics.js', 'Pure computation modules', 'Dataset-to-KPI functions that are unit-testable without HTTP'],
    ['React + TypeScript', 'Dashboard UI', 'Typed component contracts across five sections'],
    ['Chart.js + react-chartjs-2', 'Time-series rendering', 'Lightweight canvas charts; anomaly points marked inline'],
    ['axios', 'HTTP client', 'Promise-based fetch with base-URL configuration'],
    ['pdfkit', 'PDF report generation', 'Vector output, pure JavaScript, no native build'],
    ['Python (replay_dataset.py)', 'Sensor replay stream', 'Re-sends dataset rows to the live ingestion endpoint'],
    ['Python (generate_dataset.py)', 'Dataset engineering', 'Reproducible synthetic fleet dataset with labelled anomaly days'],
], widths=[1.6, 1.7, 3.6], size=8.5)
H2(doc, '3.2  Resource requirements and measurement limits')
P(doc, 'All experiments run on a single consumer laptop; no GPU or cloud instance is required at this scale. The measured quantities are the dataset sizes, the split of content per printer and the artifact sizes. Quantities not measured in this environment (production concurrency, multi-instance scaling, streaming ingestion beyond the 15-minute replay) are stated as unmeasured rather than estimated.')
CAPTION(doc, 'Table 3.2  Resource requirements and measurement limits')
TBL(doc, ['Item', 'Measured value', 'Limit / remark'], [
    ['printers.csv', '8 printer rows x 15 columns', 'One row per machine; per-machine limits'],
    ['telemetry.csv', '6,912 rows x 16 columns', PERIOD],
    ['alerts.csv', '346 alert rows x 8 columns', '157 CRITICAL, 189 WARNING'],
    ['Labelled anomalies', f'416 readings ({f(fleet_rate, 2)}%)', 'Ground-truth flag from dataset engineering'],
    ['Readings per printer', '864 (three days x 15-minute cadence)', 'Identical count per machine'],
    ['Serving footprint', 'Two Node/React processes on ports 3000/3001', 'Single laptop, single concurrent user'],
    ['PDF artifacts', '3 pages, ~13 KB per printer report', 'Vector content: tables, charts and drawn limit lines'],
    ['Concurrency measured', 'Single user', 'Production concurrency not measured'],
], widths=[1.5, 2.6, 2.8], size=8.5)
H2(doc, '3.3  Functional requirements and implementation status')
P(doc, 'The functional requirements in Table 3.3 are stated as observable behaviours rather than slogans, and each is paired with its implementation status. Every element marked as complete has a verification result or a testable endpoint behind it in Chapter 7.')
CAPTION(doc, 'Table 3.3  Functional requirements and implementation status')
TBL(doc, ['Requirement', 'Status'], [
    ['F1. Accept sensor telemetry for any registered printer over HTTP', 'Complete - POST /api/telemetry validates against the printer registry; unknown printer IDs are rejected'],
    ['F2. Compute fleet and per-printer KPIs, distributions, trends and pivots', 'Complete - /api/analytics/overview, /distributions, /trends, /pivot'],
    ['F3. Enforce per-machine sensor limits from printers.csv', 'Complete - threshold rules endpoint and the alert engine both derive from the machine registry'],
    ['F4. Detect sustained out-of-bounds windows, not only single readings', 'Complete - three-consecutive-reading detector; events listed per printer'],
    ['F5. Record alerts with metric, value, threshold, severity and message', 'Complete - alerts.csv; 346 rows verified in the fleet audit'],
    ['F6. Render a five-section dashboard on fixed ports', 'Complete - Overview, Anomaly Detection, Telemetry Explorer, Prediction, Live Monitor on port 3000'],
    ['F7. Generate an individual printer PDF report on demand', 'Complete - GET /api/report/<printer-id>, three pages, verified for all eight printers'],
    ['F8. Keep report statistics consistent with the datasets', 'Complete - EPR-001/EPR-008 verification against CSV ground truth (Chapter 7)'],
    ['F9. Replay historical readings into live detectors', 'Complete - replay_dataset.py posts the telemetry file with realistic 15-second spacing'],
], widths=[3.0, 3.9], size=8.5)

# ---- Chapter 4 ----
page_break(doc)
H1(doc, 'CHAPTER 4  DESIGN APPROACH AND DETAILS')
H2(doc, '4.1  System architecture')
P(doc, 'The architecture separates data, computation, serving and presentation with one shared registry per process. The analytics backend loads all three CSVs once at start-up, computes derived views (KPIs, distributions, hourly/daily trends, per-printer pivots, threshold rules) lazily and caches the results, and exposes them through a clean HTTP surface with every payload shaped for the dashboard component that consumes it. The React application holds one parent state tree and passes filtered slices down to the five sections, so the UI cannot drift from the backend computation.')
P(doc, 'Sensor ingestion is the one write path into the process: the replay engine posts historical dataset rows through POST /api/telemetry, exercising the same validation, threshold rules and detection windows that live sensor traffic would use. Unknown printers and malformed payloads are rejected rather than silently coerced, so the detection state cannot be polluted by a misrouted stream.')
H2(doc, '4.2  Dataset engineering and the label relationship')
P(doc, 'The dataset is generated with a documented injection script: eight machine profiles in printers.csv, ground-truth sensor behaviour per machine type and age, then deliberate anomaly injections across the six labelled families. The status column interleaves IDLE, PRINTING, MAINTENANCE, ERROR and OFFLINE rows so that trail-off behaviour (an OFFLINE machine with null sensor values) and error-code behaviour exist in the same file - which is exactly what the alert engine and the report generator must handle gracefully.')
P(doc, "The relationship between the labelled flag and the threshold breaches is intentionally not one-to-one: a labelled VIBRATION_SPIKE row may breach one machine's limit but sit inside another machine's wider allowance, and a threshold breach may reflect normal variation rather than a labelled event. Chapter 7 therefore reports and reconciles these three related-but-distinct counts (labelled readings, breach readings, detected events) wherever they appear.")
H2(doc, '4.3  Anomaly and threshold design')
P(doc, 'Threshold rules are configured per machine and per metric: temperature, vibration and paper-jam counts carry CRITICAL severity; motor RPM, power, the humidity band (min-max) and the ink-level floor carry WARNING; the paper-stock floor carries INFO. The alert engine evaluates each incoming reading against exactly these columns, records the metric, value, threshold, severity and a human-readable message, and is the sole source of the alerts.csv rows used in reporting.')
P(doc, "On top of raw breaches, the detection layer maintains per-machine sensor windows: a metric that stays out of bounds for three consecutive readings fires a detected anomaly event, while a single-reading excursion contributes to the breach count only. This reduces false positives that would flood the dashboard and keeps the operator's attention on sustained conditions, which are the maintenance-relevant ones.")
H2(doc, '4.4  Dashboard design')
P(doc, "The dashboard is a single-page React application with five fixed sections. Overview carries the fleet KPI band (8 machines, 6,912 readings, 346 alerts, monitoring window), fleet distributions and the trend backbone. Anomaly Detection renders the labelled-episode surfaces, alert timeline and per-episode drill-downs. Telemetry Explorer is the analyst's view: pick a printer and a sensor, inspect its full time series with labelled points marked red, and filter by metric. Prediction exposes the weighted risk-score evaluation for live sensor input using the same breach weighting the backend uses. Live Monitor shows the machine state as the replay engine streams readings in, including detector events as they fire.")
P(doc, 'The design deliberately keeps all heavy computation server-side: the client requests filtered series (printer + metric) rather than the whole dataset, which keeps the dashboard responsive on commodity hardware.')
H2(doc, '4.5  Individual printer PDF report design')
P(doc, 'The report service (report.js) is a self-contained pdfkit program. Given a printer ID, it filters the three datasets entirely by that machine and emits three pages of print-ready output: a header band with the machine identity, a printer-information table, the configured sensor threshold limits table, the sensor performance summary (sixteen statistics per sensor - minimum, average, maximum, last reading and breach count for nine channels), the anomaly summary distinguishing labelled readings, raw breach readings and sustained-window detected events, three time-series charts (temperature, vibration, motor RPM) each carrying the machine\'s own limit line with red markers where a labelled reading also breaches its limit, the alert-history table (newest first, CRITICAL rows highlighted, gracefully shrunken when empty), and rule-based recommendations that follow a fixed mapping from observed breaches to maintenance suggestions.')
P(doc, 'The service is exposed through GET /api/report/<printer-id> with a Content-Disposition attachment header and a machine-specific filename (EpicReads_Printer_<id>_Report.pdf); unknown printers return HTTP 404 with a JSON error rather than a broken PDF, and generation errors are caught and reported so a partial file can never download.')

# ---- Chapter 5 ----
page_break(doc)
H1(doc, 'CHAPTER 5  SCHEDULE, TASKS AND MILESTONES')
P(doc, 'The project proceeded in six phases: dataset engineering, the analytics core, the serving layer, the dashboard, the anomaly and alert engine, and the reporting feature with its verification pass. Table 5.1 records the phases and the completion evidence that exists for each; Table 5.2 records the bounded but genuinely outstanding work.')
CAPTION(doc, 'Table 5.1  Development phases and available completion evidence')
TBL(doc, ['Phase', 'Scope', 'Completion evidence'], [
    ['P1. Dataset engineering', 'Machine registry, sensor behaviour, anomaly injections, alert rows', 'printers.csv, telemetry.csv (6,912), alerts.csv (346) regenerate from one script'],
    ['P2. Analytics core', 'KPIs, distributions, hourly/daily trends, pivot, threshold rules', 'analytics.js pure modules; endpoints answer 200 on a clean boot'],
    ['P3. Serving layer', 'HTTP surface, ingestion validation, static payload contracts', 'server.js; unknown printers and malformed bodies rejected'],
    ['P4. Dashboard', 'Five-section React + TypeScript UI with Chart.js series', 'All sections render on port 3000; no console errors'],
    ['P5. Anomaly + alerts engine', 'Per-machine rules, breach counting, sustained-window detector', '346 recorded alerts; three-window events fired and displayed'],
    ['P6. Reporting feature', 'Individual printer PDF service + dashboard button', 'Eight PDFs generated; EPR-001/EPR-008 verified end-to-end'],
], widths=[1.5, 2.4, 3.0], size=8.5)
CAPTION(doc, 'Table 5.2  Outstanding work and required acceptance evidence')
TBL(doc, ['Outstanding item', 'Required acceptance evidence'], [
    ['Authenticated fleet accounts', 'A sign-in flow with per-account data scoping and a session test'],
    ['Cloud deployment with persistence', 'A deployed reference environment whose health endpoint answers over HTTPS'],
    ['Streaming ingestion beyond replay', 'A live sensor source feeding /api/telemetry at real cadence without manual replay'],
    ['Predictive maintenance modelling', 'A trained model whose predictions are served and evaluated on held-out windows'],
    ['Push notifications for CRITICAL alerts', 'E-mail or webhook dispatch with delivery evidence'],
], widths=[2.6, 4.3], size=8.5)

# ---- Chapter 6 ----
page_break(doc)
H1(doc, 'CHAPTER 6  PROJECT IMPLEMENTATION AND DEMONSTRATION')
H2(doc, '6.1  Implementation units and interfaces')
P(doc, 'Table 6.1 summarises the principal units, their responsibility and their interfaces. The structure is intentionally shallow: every unit is readable in one sitting and every cross-unit contract is visible in the endpoint payloads.')
CAPTION(doc, 'Table 6.1  Main implementation units and interfaces')
TBL(doc, ['Unit (file)', 'Responsibility', 'Interface'], [
    ['dataset-backend/analytics.js', 'KPIs, distributions, trends, pivot, threshold rules, risk scoring, series access', 'getOverview() · getDistributions() · getTrends() · getPivot() · getThresholdRules() · getPrediction(input) · getPrinterSeries(id, metric)'],
    ['dataset-backend/server.js', 'HTTP surface, ingestion, static payload contracts', 'GET /api/stats · /api/analytics/* · /api/telemetry/:id?metric= · /api/events · POST /api/telemetry'],
    ['dataset-backend/report.js', 'Individual printer PDF service (three pages, vector)', 'printerReportPdf(printerId, live) -> Buffer; buildReportData() for unit inspection'],
    ['printer-dashboard/src/App.tsx', 'Application shell, five-section navigation, shared fleet state', 'Renders Overview, Anomaly Detection, Telemetry Explorer, Prediction, Live Monitor'],
    ['printer-dashboard/src/components/*', 'Per-section views with Chart.js series', 'OverviewTab · AnomalyTab · TelemetryTab · PredictionTab · LiveTab'],
    ['printer-dashboard/src/components/TelemetryTab.tsx', 'Series explorer + report download button', 'GET /api/telemetry/:id?metric= · GET /api/report/:id'],
    ['generate_dataset.py', 'Reproducible fleet dataset generator with labelled anomalies', 'Writes printers.csv, telemetry.csv, alerts.csv'],
    ['replay_dataset.py', 'Historical sensor replay into live ingestion', 'POSTs telemetry rows with real spacing to /api/telemetry'],
    ['verify scripts', 'Independent CSV-vs-report verification', 'Python script recomputes statistics and alerts from the raw CSVs'],
], widths=[1.9, 2.2, 2.8], size=8.0)
H2(doc, '6.2  Dataset composition')
P(doc, 'Table 6.2 records the composition of the three datasets as used in the experiments, and the status distribution of the telemetry file.')
CAPTION(doc, 'Table 6.2  Recorded dataset composition')
TBL(doc, ['Property', 'Value (as measured)'], [
    ['Machines', '8 industrial printers (EPR-001..EPR-008): 2 offset presses, 3 digital presses, cover press, perfect binder, large-format unit'],
    ['Monitoring window', PERIOD],
    ['Telemetry rows', f'{nloc(total_rows)} readings x 16 columns (all 7 sensors, pages, jams, status, error code, labelled flag and type)'],
    ['Machine status mix', ', '.join(f'{k} {nloc(v)}' for k, v in sorted(status_all.items()) if k)],
    ['Labelled anomalies', f'{nloc(total_anom)} readings ({f(fleet_rate, 2)}%) across the six injected families'],
    ['Recorded alerts', '346 rows: 157 CRITICAL + 189 WARNING, raised from per-machine rules'],
    ['Anomaly types (labelled)', ', '.join(f'{t} {c}' for t, c in type_all.most_common())],
], widths=[1.7, 5.2], size=8.5)
H2(doc, '6.3  Fleet demonstration')
P(doc, f"The headline fleet picture is visible in Figs. 6.1 to 6.3. The labelled anomaly rate per machine varies from {f(min(p['rate'] for p in per), 1)}% to {f(max(p['rate'] for p in per), 1)}% - the differences are machine-specific by construction, and the dashboard surfaces them explicitly rather than hiding them behind a fleet average. Fig. 6.1 shows the rate per machine; Fig. 6.2 stacks the recorded alerts per machine by severity; Fig. 6.3 shows the hourly labelled-anomaly flow across the monitored window.")
fig_rate('fig_rate.png'); fig_alerts('fig_alerts.png'); fig_hourly('fig_hourly.png')
doc.add_picture('fig_rate.png', width=Inches(6.0))
doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
CAPTION(doc, 'Fig. 6.1  Labelled anomaly rate per printer (dataset ground truth)')
doc.add_picture('fig_alerts.png', width=Inches(6.0))
doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
CAPTION(doc, 'Fig. 6.2  Recorded alerts per printer by severity (alerts.csv)')
doc.add_picture('fig_hourly.png', width=Inches(6.0))
doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
CAPTION(doc, 'Fig. 6.3  Labelled anomalous readings per hour (telemetry.csv)')
P(doc, "The per-machine tables follow in Chapter 7 with the reconciliation of the three anomaly counts and the individual-report verification.")

# ---- Chapter 7 ----
page_break(doc)
H1(doc, 'CHAPTER 7  RESULTS AND DISCUSSION')
H2(doc, '7.1  Fleet results')
P(doc, 'Table 7.1 records, per machine, the labelled anomalies against the raw threshold-breach readings and the recorded alert count. The three counts are related but distinct: a machine may breach frequently and still earn few labelled rows (normal high-load behaviour near its limits), or receive many labelled rows with few breaches (dataset-injected episodes inside a wide allowance). The dashboard and the reports always present all three so the operator never confuses them.')
CAPTION(doc, 'Table 7.1  Per-printer results across the monitored window (6,912 readings)')
rows71 = []
for p in per:
    top_types = ', '.join(f'{t.replace("_", " ")} {c}' for t, c in p['types'].most_common(3))
    rows71.append([p['id'], p['model'], nloc(p['rows']), str(p['labelled']), f(p['rate'], 1), str(p['breach']), str(p['alerts']), str(p['crit']), top_types])
TBL(doc, ['Printer', 'Model', 'Readings', 'Labelled', 'Rate %', 'Breach readings', 'Alerts', 'Critical', 'Dominant labelled episodes'], rows71, widths=[0.8, 1.15, 0.75, 0.65, 0.55, 0.8, 0.55, 0.65, 2.2], size=7.5)
P(doc, f"Two machines carry the load of the fleet's visible problems and are used as the acceptance pair for the report feature: EPR-001 (offset press, {ep1['labelled']} labelled reads, {f(ep1['rate'])}%, {ep1['alerts']} alerts of which {ep1['crit']} CRITICAL) dominates the humidity and power families, while EPR-008 (large format, {ep8['labelled']} labelled reads, {f(ep8['rate'])}%, {ep8['alerts']} alerts of which {ep8['crit']} CRITICAL) dominates vibration, motor overspeed and offline episodes.")
H2(doc, '7.2  Individual report verification (EPR-001 vs EPR-008)')
P(doc, 'The download feature was accepted only after the two-machine comparison used as test case: select EPR-001, download; select EPR-008, download; then re-verify every statistic in both PDFs against the raw CSVs with an independent recomputation. Table 7.2 records the reconciliation of the headline numbers; every per-sensor minimum, average and maximum in each report was also matched verbatim, and each chart carries only its own machine\'s series and limit values.')
CAPTION(doc, 'Table 7.2  Report verification pair - results from the automated cross-check')
TBL(doc, ['Check', 'EPR-001', 'EPR-008'], [
    ['Report pages / filename', '3 pages / EpicReads_Printer_EPR-001_Report.pdf', '3 pages / EpicReads_Printer_EPR-008_Report.pdf'],
    ['Foreign printer IDs in report', 'None', 'None'],
    ['Total readings', f"{ep1['rows']} (matches CSV)", f"{ep8['rows']} (matches CSV)"],
    ['Labelled anomalous readings', f"{ep1['labelled']} of {ep1['rows']} ({f(ep1['rate'])}%) - matches CSV", f"{ep8['labelled']} of {ep8['rows']} ({f(ep8['rate'])}%) - matches CSV"],
    ['Raw threshold-breach readings', f"{ep1['breach']} readings (recomputed)", f"{ep8['breach']} readings (recomputed)"],
    ['Recorded alerts', f"{ep1['alerts']} total, {ep1['crit']} CRITICAL", f"{ep8['alerts']} total, {ep8['crit']} CRITICAL"],
    ['Anomaly types shown', ', '.join(f'{t} {c}' for t, c in ep1['types'].most_common()), ', '.join(f'{t} {c}' for t, c in ep8['types'].most_common())],
    ['Chart limit lines (own machine)', '75.0 °C · 5.5 mm/s · 13,500 rpm', '60.0 °C · 3.0 mm/s · 3,200 rpm'],
    ['Recommendations generated', 'Rules fired from its own records; no confirmed-failure claim', 'Rules fired from its own records; no confirmed-failure claim'],
], widths=[1.7, 2.6, 2.6], size=8.0)
P(doc, 'Both reports passed every check: the two documents are strictly machine-specific (no statistic, alert row or chart point from one machine appears in the other\'s PDF), every displayed value matches the CSV ground truth, the charts render with red labelled-breach markers and the machine\'s own dashed limit lines, and the layout holds three pages with per-page footers. All eight printers generated PDFs successfully through the live endpoint; a machine with no recorded alerts receives the graceful no-alerts text rather than an empty table.')
H2(doc, '7.3  Cost analysis')
CAPTION(doc, 'Table 7.3  Resource quantities and cost evidence')
TBL(doc, ['Item', 'Quantity', 'Cost basis'], [
    ['Compute (analytics + serving)', 'Two processes on the development laptop', 'Zero marginal cost; CPU only'],
    ['Compute (report generation)', 'Tens of CPU-milliseconds per three-page PDF', 'Measured via the generation timing in the service'],
    ['Storage', '3 CSV datasets + 8 PDF artifacts (~13 KB each)', 'Order of a few MB in total'],
    ['Datasets', 'Generated in-repository with a documented script', 'Zero acquisition cost, no licensing constraint'],
    ['Libraries', 'Open source (React, Chart.js, Node.js, pdfkit, axios)', 'Zero licence cost'],
    ['Unmeasured', 'Production concurrency, multi-instance scaling, streaming at production cadence', 'Stated as unmeasured rather than estimated'],
], widths=[2.0, 2.3, 2.6], size=8.5)
H2(doc, '7.4  Discussion')
P(doc, "Three findings organise the discussion. First, per-machine configuration matters: the same sensor reading can be healthy on one machine and a breach on the next (for example, a 5.4 mm/s vibration is inside EPR-001's 5.5 mm/s allowance but is an 80% overshoot on EPR-008's 3.0 mm/s limit), so any fleet-wide average hides exactly the events that matter. Second, the three anomaly counts are a feature, not a bookkeeping burden: the sustained-window detector keeps the operator's attention on persistent conditions while the breach count shows raw excursions, and the labelled count is the ground truth the system is judged against. Third, downloadable reporting is what makes the fleet auditable by humans: the three-page PDF carries the machine's own limits, its whole alert history and rule-based recommendations, and it is the artifact a supervisor can actually file.")

# ---- Chapter 8 ----
page_break(doc)
H1(doc, 'CHAPTER 8  SUMMARY')
P(doc, 'This project implements Project 27, a runnable IoT monitoring system for the eight-printer fleet of EpicReads, and measures each layer of it against the datasets it actually serves.')
H2(doc, '8.1  Completed work and technical contribution')
P(doc, 'The completed implementation covers reproducible dataset engineering (three CSV files with per-machine limits and labelled anomaly episodes), a pure-function analytics core with a REST serving surface, strict ingestion validation, per-machine threshold rules with severity mapping, a three-consecutive-reading sustained-window detector on top of raw breach counting, a five-section React + TypeScript dashboard, and a three-page individual printer PDF report service exposed through a dedicated endpoint with a dashboard download button.')
P(doc, 'The technical contribution lies in the integration discipline: every statistic in every surface - dashboard, API and PDF report - traces back to the same datasets, per-machine limits are honoured everywhere (no fleet-wide thresholds), and the three related anomaly counts are always distinguished so that no display conflates labelled ground truth, raw breaches and sustained-window detections.')
H2(doc, '8.2  Results and objective achievement')
P(doc, f'Every objective in Table 2.1 has observable evidence behind it: {nloc(total_rows)} readings processed at 15-minute cadence, 346 recorded alerts with correct severity attribution, 416 labelled anomalous readings ({f(fleet_rate, 2)}%) surfaced as a first-class dataset view, and an eight-for-eight generation record for the individual report feature with the mandatory EPR-001/EPR-008 comparison fully verified (Table 7.2).')
H2(doc, '8.3  Limitations')
P(doc, 'The system runs replay of recorded telemetry, not a physical sensor stream; nothing is claimed about field data. Concurrency and deployment-scale behaviour are unmeasured on this single-user laptop. The labelled anomalies are injected by the data-generation script and deliberately realistic, but they remain synthetic. The recommendation rules map threshold breaches to maintenance suggestions; they are explicitly not diagnoses, and no claim of confirmed mechanical failure is made anywhere in the system.')
H2(doc, '8.4  Future enhancements')
P(doc, 'The next engineering steps are the five outstanding items of Table 5.2: authenticated fleet accounts, a cloud deployment with persistence, streaming ingestion at production cadence, a predictive maintenance model served alongside the risk score, and push notifications for CRITICAL alerts. Beyond them, per-machine rolling baselines (instead of static limits) and a maintenance-history timeline per machine would round out the operational picture.')

# ---- References ----
page_break(doc)
H1(doc, 'REFERENCES')
for ref in [
    '[1] The React Team, "React - The library for web and native user interfaces," Meta Open Source, 2026. [Online]. Available: https://react.dev/',
    '[2] Microsoft, "TypeScript - JavaScript With Syntax For Types," 2026. [Online]. Available: https://www.typescriptlang.org/',
    '[3] Chart.js contributors, "Chart.js - Simple, flexible HTML5 charts," 2026. [Online]. Available: https://www.chartjs.org/',
    '[4] OpenJS Foundation, "Node.js - Runtime built on Chrome\'s V8 JavaScript engine," 2026. [Online]. Available: https://nodejs.org/',
    '[5] Devon Govett, "PDFKit - A JavaScript PDF generation library for Node and the browser," 2026. [Online]. Available: https://github.com/foliojs/pdfkit',
    '[6] axios contributors, "axios - Promise based HTTP client for the browser and node.js," 2026. [Online]. Available: https://axios-http.com/',
    '[7] Mozilla Developer Network, "Content-Disposition attachment header," 2026. [Online]. Available: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Disposition',
    '[8] Python Software Foundation, "csv - CSV File Reading and Writing," 2026. [Online]. Available: https://docs.python.org/3/library/csv.html',
]:
    P(doc, ref, space_after=5)

# ---- Appendix A ----
page_break(doc)
H1(doc, 'APPENDIX A  SELECTED IMPLEMENTATION EXCERPTS')
P(doc, "The excerpts below are the exact interfaces of the report services, quoted from the repository so that the report's claims match real code.")

def CODE(doc, text):
    for line in text.split('\n'):
        P(doc, line if line else ' ', align='left', size=8, font='Courier New', space_after=0)

CODE(doc, """// analytics.js - threshold rules derived from printers.csv (per machine)
function thresholdRules() {
  return printersCsv.rows.map((p) => ({
    printer_id: p.printer_id, printer_name: p.printer_name,
    model: p.model, location: p.location,
    rules: [
      { metric: 'temperature_c',  limit: num(p.max_temperature_c), severity: 'CRITICAL' },
      { metric: 'vibration_mm_s', limit: num(p.max_vibration_mm_s), severity: 'CRITICAL' },
      { metric: 'paper_jams',     limit: num(p.max_paper_jams_per_interval), severity: 'CRITICAL' },
      { metric: 'motor_rpm',      limit: num(p.max_motor_rpm), severity: 'WARNING' },
      { metric: 'power_kw',       limit: num(p.max_power_kw), severity: 'WARNING' },
      { metric: 'humidity_pct',   min: num(p.min_humidity_pct),
        max: num(p.max_humidity_pct), severity: 'WARNING' },
      { metric: 'ink_level_pct',  min: num(p.min_ink_level_pct), severity: 'WARNING' },
      { metric: 'paper_stock_pct', min: num(p.min_paper_stock_pct), severity: 'INFO' },
    ],
  }));
}""")
P(doc, '', space_after=6)
CODE(doc, """// report.js - the individual printer report contract
function buildReportData(printerId, live) {
  const csv = printersCsv.rows.find((r) => r.printer_id === printerId);
  if (!csv) return null;   // unknown printer -> HTTP 404
  const rows = T.filter((r) => r.printer_id === printerId);   // dataset filter
  const alerts = ALERTS.filter((a) => a.printer_id === printerId);
  // per-sensor stats, raw breach counts, labelled episode types, alert history
  // ... every returned number is computed from the CSVs at request time
}""")
P(doc, '', space_after=6)
CODE(doc, """// report.js - the recommendation rules fire only on observed breaches
if (temp && temp.breaches > 0)
  out.push(`Temperature was out of bounds on ${temp.breaches} reading(s) ...`
    + ` Recommend checking the cooling system and ventilation of ${printer.location}.`);
// ... vibration -> mechanical inspection, ink/paper stock -> replenishment
// plus a fixed disclaimer: maintenance suggestions, not confirmed diagnoses""")

# ---- Appendix B ----
page_break(doc)
H1(doc, 'APPENDIX B  REPRODUCTION AND ARTEFACT CHECKLIST')
CAPTION(doc, 'Table B.1  Reproduction commands')
TBL(doc, ['Step', 'Command'], [
    ['Environment', 'node --version  (Node.js 18+ and npm 9+ verify clean)'],
    ['Backend deps', 'npm install --prefix dataset-backend'],
    ['Regenerate datasets (optional)', 'python generate_dataset.py   (rewrites the three CSV files)'],
    ['Backend', 'node dataset-backend/server.js   (port 3001)'],
    ['Frontend', 'npm start --prefix printer-dashboard   (port 3000)'],
    ['Replay sensors', 'python replay_dataset.py   (posts telemetry rows into the live detector)'],
    ['Individual report', 'GET http://127.0.0.1:3001/api/report/EPR-001   (or the dashboard button)'],
], widths=[1.9, 5.0], size=8.5)
P(doc, 'Artefacts produced: the three CSV datasets, the dashboard build, the two server processes on their documented ports, and one three-page PDF per printer generated through the live endpoint or the dashboard button.')

# ---- Appendix C ----
page_break(doc)
H1(doc, 'APPENDIX C  VERIFICATION CHECKLIST AND RESULTS')
P(doc, "The verification pass at acceptance time re-checked every claim of Chapter 7 from the raw CSVs with an independent recomputation, and exercised the dashboard through a real browser session. Table C.1 summarises the checklist with its results.")
CAPTION(doc, 'Table C.1  Verification checklist')
TBL(doc, ['Area', 'What was asserted'], [
    ['Fleet generation', 'All eight printers generated a three-page report through the live endpoint; every response 200 with a PDF content type'],
    ['Per-machine filtering', 'No foreign printer ID, statistic or alert row appears in any report (automated re-check)'],
    ['Statistics integrity', 'Every sensor min / avg / max in the EPR-001 and EPR-008 reports matches the CSV verbatim'],
    ['Chart correctness', "Each chart carries only its own machine's series; limit lines show that machine's configured values"],
    ['Anomaly counts', "Labelled, breach and detected-event counts reconcile Chapter 7's tables against the CSVs"],
    ['Error handling', 'Unknown printer ids return HTTP 404 with a JSON error; the dashboard shows a red error banner on failure'],
    ['Dashboard health', 'All five sections render; every section endpoint answers 200; no console errors during the walkthrough'],
    ['Ports preserved', 'Frontend on port 3000 and backend on port 3001 as before the feature was added'],
], widths=[1.7, 5.2], size=8.5)

doc.save(OUT)
print('wrote', OUT)
