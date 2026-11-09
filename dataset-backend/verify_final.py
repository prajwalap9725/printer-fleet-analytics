"""Independent verification of downloaded PDFs against the raw CSVs.

Ground truth is computed here from telemetry.csv / printers.csv / alerts.csv —
not from the backend's own modules — then checked against the text extracted
from the downloaded PDF reports for EPR-001 and EPR-008.
"""
import csv, sys
from collections import Counter
import pymupdf

METRICS = [
    ("temperature_c",   "Temperature",   "°C",   "max",  "max_temperature_c"),
    ("humidity_pct",    "Humidity",      "%",    "band", "max_humidity_pct"),
    ("ink_level_pct",   "Ink level",     "%",    "lower", "min_ink_level_pct"),
    ("paper_stock_pct", "Paper stock",   "%",    "lower", "min_paper_stock_pct"),
    ("motor_rpm",       "Motor RPM",     "rpm",  "max",  "max_motor_rpm"),
    ("vibration_mm_s",  "Vibration",     "mm/s", "max",  "max_vibration_mm_s"),
    ("power_kw",        "Power",         "kW",   "max",  "max_power_kw"),
    ("pages_per_min",   "Throughput",    "ppm",  None,   None),
    ("paper_jams",      "Paper jams",    "count", "max", "max_paper_jams_per_interval"),
]

def read_csv(path):
    rows = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            rows.append(r)
    return rows

def fnum(v):
    v = (v or "").strip()
    if v == "":
        return None
    try:
        return float(v)
    except ValueError:
        return None

def truth(printer_id, rows, printers, alerts):
    prof = next(p for p in printers if p["printer_id"] == printer_id)
    ar   = sorted([r for r in rows if r["printer_id"] == printer_id], key=lambda r: r["timestamp"])
    alrt = [a for a in alerts if a["printer_id"] == printer_id]
    t = {"id": printer_id, "rows": len(ar)}
    t["labelled"] = sum(1 for r in ar if fnum(r["is_anomaly"]) == 1)
    t["labelled_pct"] = t["labelled"] / t["rows"] * 100
    types = Counter(r["anomaly_type"] for r in ar if fnum(r["is_anomaly"]) == 1)
    t["types"] = dict(types)
    # sensor stats excluding OFFLINE rows
    stats = {}
    breach_rows = 0
    for r in ar:
        if (r["status"] or "OFFLINE") == "OFFLINE":
            continue
        any_breach = False
        for key, _lab, _u, direction, col in METRICS:
            v = fnum(r[key])
            if v is None:
                continue
            s = stats.setdefault(key, [])
            s.append(v)
            lim = None
            if direction == "max":
                lim = fnum(prof[col])
                is_b = lim is not None and v > lim
            elif direction == "lower":
                lim = fnum(prof[col])
                is_b = lim is not None and v < lim
            elif direction == "band":
                hi, lo = fnum(prof["max_humidity_pct"]), fnum(prof["min_humidity_pct"])
                lim = hi
                is_b = (hi is not None and v > hi) or (lo is not None and v < lo)
            else:
                is_b = False
            if is_b:
                any_breach = True
        breach_rows += any_breach
    t["stats"] = {k: (min(v), sum(v)/len(v), max(v)) for k, v in stats.items()}
    t["breach_rows"] = breach_rows
    t["alerts"] = alrt
    t["crit_alerts"] = sum(1 for a in alrt if a["severity"] == "CRITICAL")
    t["last_status"] = ar[-1]["status"]
    t["status_mix"] = dict(Counter(r["status"] for r in ar))
    return t

def pdf_text(path):
    doc = pymupdf.open(path)
    pages = [p.get_text() for p in doc]
    drawings = sum(len(p.get_drawings()) for p in doc)
    texts = "\n".join(pages)
    doc.close()
    return pages, texts, drawings

def approx_in(text, x, places=1):
    if x is None:
        return True
    for d in (places, 2, 0):
        s = f"{x:.{d}f}"
        if s in text:
            return True
    return False

def check(printer_id, rows, printers, alerts, path):
    t = truth(printer_id, rows, printers, alerts)
    pages, text, drawings = pdf_text(path)
    r = {"id": printer_id, "pages": len(pages), "drawings": drawings, "fails": []}
    if not (2 <= len(pages) <= 3):
        r["fails"].append(f"page count {len(pages)} outside 2-3")
    # page number footers on every page
    for i, p in enumerate(pages, 1):
        if f"Page {i} of" not in p:
            r["fails"].append(f"missing 'Page {i} of' footer")
    # correct printer id
    if printer_id not in text:
        r["fails"].append("printer id missing from report")
    for other in [p["printer_id"] for p in printers]:
        if other != printer_id and other in text:
            r["fails"].append(f"foreign printer id {other} appears in report")
    # headline counts
    if f"{t['rows']:,}" not in text and f"{t['rows']}" not in text:
        r["fails"].append(f"total readings {t['rows']} not found")
    if f"{t['labelled']} of" not in text:
        r["fails"].append(f"labelled anomaly count {t['labelled']} not found")
    if f"{t['crit_alerts']} CRITICAL" not in text:
        r["fails"].append(f"CRITICAL alert count {t['crit_alerts']} not found")
    # sensor stats present (min, avg, max of the 7 required sensors)
    for key, lab, _u, _d, _c in METRICS[:7]:
        if lab not in text:
            r["fails"].append(f"sensor label {lab} missing")
            continue
        if key not in t["stats"]:
            continue
        mn, avg, mx = t["stats"][key]
        for name, v in (("min", mn), ("avg", avg), ("max", mx)):
            if not approx_in(text, v):
                r["fails"].append(f"{printer_id} {key} {name}={v:.2f} not found in PDF")
    # breach count of each temperature-limited sensor row is same as ground truth check below (informational)
    r["breach_rows_truth"] = t["breach_rows"]
    # alert correctness: every alert timestamp of this printer should appear (first 22 shown)
    shown = sorted(t["alerts"], key=lambda a: a["timestamp"], reverse=True)[:22]
    for a in shown:
        ts = a["timestamp"].replace("T", " ")[:16]
        if ts not in text and printer_id != "EPR-999":
            # timestamps in pdf are 'YYYY-MM-DD HH:MM'
            r["fails"].append(f"alert row {ts} not found")
    r["alerts_truth"] = len(t["alerts"])
    r["types_truth"] = t["types"]
    r["recommend_note"] = "recommendations present" if "recommend" in text.lower() else "NO RECOMMENDATIONS"
    return r

def main():
    rows = read_csv("telemetry.csv")
    printers = read_csv("printers.csv")
    alerts = read_csv("alerts.csv")
    print(f"dataset: {len(rows)} telemetry rows, {len(printers)} printers, {len(alerts)} alerts\n")

    results = []
    for pid in ["EPR-001", "EPR-008"]:
        path = f"reports_test/EpicReads_Printer_{pid}_Report.pdf"
        res = check(pid, rows, printers, alerts, path)
        results.append(res)
        print(f"=== {pid} ===")
        print({
            "pages": res["pages"], "vectorDrawings": res["drawings"],
            "truthBreachRows": res["breach_rows_truth"], "alerts": res["alerts_truth"],
            "types": res["types_truth"], "recommended": res["recommend_note"],
        })
        if res["fails"]:
            print("FAILURES:")
            for f_ in res["fails"]:
                print("  -", f_)
        else:
            print("ALL CHECKS PASSED")
        print()

    # cross-contamination check: printer-specific stats must not appear in the other PDF
    def stat_lines(pid, rows):
        t = truth(pid, rows, printers, alerts)
        out = set()
        for key, lab, _u, _d, _c in METRICS[:7]:
            if key in t["stats"]:
                for v in t["stats"][key]:
                    out.add(f"{v:.1f}")
        return t, out

    t1, s1 = stat_lines("EPR-001", rows)
    t8, s8 = stat_lines("EPR-008", rows)
    _, p1, _ = pdf_text("reports_test/EpicReads_Printer_EPR-001_Report.pdf")
    _, p8, _ = pdf_text("reports_test/EpicReads_Printer_EPR-008_Report.pdf")
    only1 = s1 - s8
    only8 = s8 - s1
    leak8_in_1 = [v for v in only8 if v in p1]
    leak1_in_8 = [v for v in only1 if v in p8]
    print("cross-contamination:")
    print("  printer-specific stat values unique to EPR-001:", sorted(only1))
    print("  printer-specific stat values unique to EPR-008:", sorted(only8))
    print("  EPR-001-only values leaked into EPR-008 PDF:", leak1_in_8 or "none")
    print("  EPR-008-only values leaked into EPR-001 PDF:", leak8_in_1 or "none")
    print("  EPR-001 alert total:", t1["alerts"], "| EPR-008 alert total:", t8["alerts"])

if __name__ == "__main__":
    main()
