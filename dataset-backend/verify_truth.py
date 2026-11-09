import csv, json, sys, statistics
from collections import Counter

P = sys.argv[1] if len(sys.argv) > 1 else 'EPR-001'
BASE = '.'

printers = {r['printer_id']: r for r in csv.DictReader(open('printers.csv'))}
rows = [r for r in csv.DictReader(open('telemetry.csv')) if r['printer_id'] == P]
alerts = [r for r in csv.DictReader(open('alerts.csv')) if r['printer_id'] == P]
p = printers[P]

lbl = sum(1 for r in rows if r['is_anomaly'] == '1')
types = Counter(r['anomaly_type'] for r in rows if r['is_anomaly'] == '1')

metrics = {
    'temperature_c': (None, float(p['max_temperature_c'])),
    'humidity_pct': (float(p['min_humidity_pct']), float(p['max_humidity_pct'])),
    'ink_level_pct': (float(p['min_ink_level_pct']), None),
    'paper_stock_pct': (float(p['min_paper_stock_pct']), None),
    'motor_rpm': (None, float(p['max_motor_rpm'])),
    'vibration_mm_s': (None, float(p['max_vibration_mm_s'])),
    'power_kw': (None, float(p['max_power_kw'])),
    'pages_per_min': (None, None),
    'paper_jams': (None, float(p['max_paper_jams_per_interval'])),
}

labels = {'temperature_c':'Temperature','humidity_pct':'Humidity','ink_level_pct':'Ink level',
          'paper_stock_pct':'Paper stock','motor_rpm':'Motor RPM','vibration_mm_s':'Vibration',
          'power_kw':'Power','pages_per_min':'Throughput','paper_jams':'Paper jams'}

breach_readings = 0
print(f'== {P}: {len(rows)} readings, labelled anomalies {lbl} ({lbl/len(rows)*100:.1f}%), alerts {len(alerts)} (critical {sum(1 for a in alerts if a["severity"]=="CRITICAL")})')
print('types:', dict(types))
any_breach = False
for k,(lo,hi) in metrics.items():
    vs = [float(r[k]) for r in rows if r[k] != '' and r['status'] != 'OFFLINE']
    b = 0
    for r in rows:
        if r['status'] == 'OFFLINE' or r[k] == '': continue
        v = float(r[k])
        if (hi is not None and v > hi) or (lo is not None and v < lo): b += 1
    if b > 0:
        any_breach = True
    print(f'{k}: n={len(vs)} min={min(vs):.2f} avg={sum(vs)/len(vs):.2f} max={max(vs):.2f} breaches={b}')
    if b > 0:
        any_breach = True
for r in rows:
    if r['status'] == 'OFFLINE': continue
    ok = False
    for k,(lo,hi) in metrics.items():
        if r[k] == '' or (lo is None and hi is None): continue
        v = float(r[k])
        if (hi is not None and v > hi) or (lo is not None and v < lo):
            ok = True
    if ok: breach_readings += 1
print('readings with >=1 breach:', breach_readings)
print('status mix:', dict(Counter(r['status'] for r in rows)))
print('last status:', rows[-1]['status'], 'timestamps:', rows[0]['timestamp'], '->', rows[-1]['timestamp'])
