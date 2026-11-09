"""
Replays telemetry.csv as if it were live IoT data, so a backend that used to
consume real-time messages can consume the dataset instead.

  python replay_dataset.py                 # print JSON messages, 1 tick/sec
  python replay_dataset.py --speed 0       # as fast as possible
  python replay_dataset.py --post http://localhost:3000/api/telemetry
  python replay_dataset.py --mode loop     # restart when finished

Each tick = all printers' readings for one timestamp. Replace emit() with your
Socket.IO / MQTT / HTTP publish call if the backend needs a different transport.
"""
import argparse, csv, json, time, urllib.request
from itertools import groupby

ap = argparse.ArgumentParser()
ap.add_argument("--file", default="telemetry.csv")
ap.add_argument("--speed", type=float, default=1.0, help="seconds between ticks (0 = no delay)")
ap.add_argument("--post", help="HTTP endpoint to POST each reading to")
ap.add_argument("--mode", choices=["once","loop"], default="once")
args = ap.parse_args()

NUM = {"temperature_c","humidity_pct","ink_level_pct","paper_stock_pct","motor_rpm",
       "vibration_mm_s","power_kw","pages_per_min"}
INT = {"pages_printed_total","paper_jams","is_anomaly"}

def parse(row):
    out = {}
    for k, v in row.items():
        if v == "": out[k] = None
        elif k in NUM: out[k] = float(v)
        elif k in INT: out[k] = int(v)
        else: out[k] = v
    return out

def emit(msg):
    if args.post:
        req = urllib.request.Request(args.post, json.dumps(msg).encode(),
                                     {"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=5).read()
    else:
        print(json.dumps(msg))

while True:
    with open(args.file, newline="") as f:
        rows = [parse(r) for r in csv.DictReader(f)]
    for _, tick in groupby(rows, key=lambda r: r["timestamp"]):
        for msg in tick: emit(msg)
        if args.speed: time.sleep(args.speed)
    if args.mode == "once": break
