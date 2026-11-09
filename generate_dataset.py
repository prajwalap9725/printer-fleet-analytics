"""
EpicReads printer IoT dataset generator.
Produces printers.csv (machine master + thresholds), telemetry.csv (time series
with labelled anomalies) and alerts.csv (threshold breaches).
Usage: python generate_dataset.py [--days 3] [--interval 5] [--seed 27]
"""
import argparse, math, random
from datetime import datetime, timedelta, timezone
import pandas as pd

ap = argparse.ArgumentParser()
ap.add_argument("--days", type=int, default=3)
ap.add_argument("--interval", type=int, default=5, help="minutes between readings")
ap.add_argument("--seed", type=int, default=27)
ap.add_argument("--start", default="2026-10-15T00:00:00")
args = ap.parse_args()
random.seed(args.seed)

# ---------------- machine master + machine-specific thresholds ----------------
PRINTERS = [
 # id, name, model, type, location, base_temp, base_rpm, base_ppm, base_kw, base_vib, max_temp, max_vib, max_rpm
 ("EPR-001","Offset Press A","HeidelPress XL-106","Offset","Plant 1 - Hall A",52,11000,160,38.0,2.1,75,5.5,13500),
 ("EPR-002","Offset Press B","HeidelPress XL-106","Offset","Plant 1 - Hall A",53,11000,158,37.5,2.2,75,5.5,13500),
 ("EPR-003","Digital Press A","KonicaJet 6120","Digital","Plant 1 - Hall B",44,6000,120,18.0,1.2,65,3.5,7500),
 ("EPR-004","Digital Press B","KonicaJet 6120","Digital","Plant 1 - Hall B",45,6000,118,17.5,1.3,65,3.5,7500),
 ("EPR-005","Digital Press C","RicohPro C9500","Digital","Plant 2 - Hall A",43,5800,110,16.0,1.1,65,3.5,7200),
 ("EPR-006","Cover Press","HeidelPress CD-74","Offset","Plant 2 - Hall A",50,9000,130,28.0,1.8,72,5.0,11000),
 ("EPR-007","Perfect Binder","MullerBind Pro","Binding","Plant 2 - Hall B",38,3000,60,12.0,2.6,60,6.5,3800),
 ("EPR-008","Large Format","EpsonSure 9900","Large-format","Plant 2 - Hall C",41,2500,40,9.0,0.9,60,3.0,3200),
]
cols = ["printer_id","printer_name","model","machine_type","location","install_date",
        "base_temp","base_rpm","base_ppm","base_kw","base_vib",
        "max_temperature_c","max_vibration_mm_s","max_motor_rpm",
        "min_ink_level_pct","min_paper_stock_pct","max_humidity_pct","min_humidity_pct","max_power_kw",
        "max_paper_jams_per_interval"]
rows = []
for i,p in enumerate(PRINTERS):
    pid,name,model,mtype,loc,bt,br,bp,bk,bv,mt,mv,mr = p
    rows.append([pid,name,model,mtype,loc,f"20{19+i%5}-0{1+i%9}-1{i%9}",
                 bt,br,bp,bk,bv,mt,mv,mr,15,10,70,30,round(bk*1.35,1),2])
master = pd.DataFrame(rows, columns=cols)
public_cols = [c for c in cols if not c.startswith("base_")]
master[public_cols].to_csv("printers.csv", index=False)

# ---------------- simulate ----------------
start = datetime.fromisoformat(args.start).replace(tzinfo=timezone.utc)
steps = args.days*24*60//args.interval
T = {r.printer_id: r for r in master.itertuples()}

def plan_anomalies(pid):
    """Return list of (start_step, length, type) episodes for a printer."""
    eps = []
    n = random.randint(3,5)
    kinds = ["OVERHEAT","VIBRATION_SPIKE","PAPER_JAM_BURST","INK_LEAK_DROP","HUMIDITY_SPIKE",
             "OFFLINE","MOTOR_OVERSPEED","POWER_SURGE"]
    for _ in range(n):
        k = random.choice(kinds); L = random.randint(6,24)
        s = random.randint(int(steps*0.05), steps-L-1)
        eps.append((s,L,k))
    return eps

telemetry = []
for p in PRINTERS:
    pid = p[0]; t = T[pid]
    eps = plan_anomalies(pid)
    ink, paper = random.uniform(60,100), random.uniform(60,100)
    pages = random.randint(800_000, 2_500_000)
    temp = t.base_temp - 8
    vib_drift = 0.0
    for s in range(steps):
        ts = start + timedelta(minutes=s*args.interval)
        hour = ts.hour + ts.minute/60
        # shift schedule: busy 06-22, light otherwise, weekends lighter
        weekend = ts.weekday() >= 5
        duty = 0.85 if 6 <= hour < 22 else 0.08
        if weekend: duty *= 0.5
        printing = random.random() < duty
        status = "PRINTING" if printing else "IDLE"
        # scheduled maintenance window 02:00-03:00 on one machine per day
        if hour >= 2 and hour < 3 and (hash(pid)+ts.day) % 8 == 0:
            status, printing = "MAINTENANCE", False
        active = [e for e in eps if e[0] <= s < e[0]+e[1]]
        types = {e[2] for e in active}

        target_temp = t.base_temp + (random.gauss(0,1.5) if printing else -12 + random.gauss(0,1))
        temp += (target_temp - temp)*0.35
        rpm = t.base_rpm*random.uniform(0.94,1.04) if printing else random.uniform(0,0.03)*t.base_rpm
        ppm = t.base_ppm*random.uniform(0.9,1.05) if printing else 0.0
        kw  = t.base_kw*random.uniform(0.9,1.08) if printing else t.base_kw*random.uniform(0.08,0.15)
        vib = t.base_vib*random.uniform(0.85,1.15) if printing else t.base_vib*random.uniform(0.05,0.2)
        hum = 48 + 8*math.sin((hour-14)/24*2*math.pi) + random.gauss(0,1.5)
        jams = 0
        if printing and random.random() < 0.01: jams = 1
        err = ""
        if printing:
            ink   -= random.uniform(0.04,0.12)
            paper -= random.uniform(0.05,0.14)
        if ink < 12:   ink = random.uniform(92,100)      # operator refill
        if paper < 8:  paper = random.uniform(90,100)

        anomaly, atype = 0, ""
        for e in active:
            k = e[2]; prog = (s-e[0]+1)/e[1]
            anomaly, atype = 1, k
            if k=="OVERHEAT":
                status = "PRINTING" if status!="OFFLINE" else status
                temp = t.base_temp + (t.max_temperature_c - t.base_temp)*(0.8+0.6*prog)+random.gauss(0,1); err="E-TEMP-HIGH"
            elif k=="VIBRATION_SPIKE":
                vib = t.max_vibration_mm_s*(0.9+0.9*prog)*random.uniform(0.95,1.1); err="E-VIB-BEARING"
            elif k=="PAPER_JAM_BURST":
                jams = random.randint(2,5); ppm *= 0.3; err="E-JAM-FEED"; status="ERROR"
            elif k=="INK_LEAK_DROP":
                ink = max(1.0, ink - random.uniform(2.5,5)); err="E-INK-LOW"
            elif k=="HUMIDITY_SPIKE":
                hum = 74 + 10*prog + random.gauss(0,1); err="E-ENV-HUMID"
            elif k=="MOTOR_OVERSPEED":
                rpm = t.max_motor_rpm*random.uniform(1.03,1.15); err="E-MOTOR-OVERSPEED"
            elif k=="POWER_SURGE":
                kw = t.max_power_kw*random.uniform(1.05,1.3); err="E-PWR-SURGE"
            elif k=="OFFLINE":
                status="OFFLINE"
        if status == "OFFLINE":
            # device stopped reporting: write the row with nulls (heartbeat lost)
            telemetry.append([ts.strftime("%Y-%m-%dT%H:%M:%SZ"),pid,status,None,None,None,None,None,None,None,pages,None,0,"E-COMM-LOST",anomaly,atype])
            continue
        pages += int(ppm*args.interval)
        telemetry.append([
            ts.strftime("%Y-%m-%dT%H:%M:%SZ"), pid, status, round(temp,1), round(hum,1),
            round(ink,1), round(paper,1), round(rpm), round(vib,2), round(kw,1),
            pages, round(ppm,1), jams, err, anomaly, atype])

tcols = ["timestamp","printer_id","status","temperature_c","humidity_pct","ink_level_pct",
         "paper_stock_pct","motor_rpm","vibration_mm_s","power_kw","pages_printed_total",
         "pages_per_min","paper_jams","error_code","is_anomaly","anomaly_type"]
df = pd.DataFrame(telemetry, columns=tcols).sort_values(["timestamp","printer_id"]).reset_index(drop=True)
df.to_csv("telemetry.csv", index=False)

# ---------------- alerts from machine-specific thresholds ----------------
alerts = []
def add(ts,pid,metric,val,thr,sev,msg):
    alerts.append([ts,pid,metric,val,thr,sev,msg])
for r in df.itertuples():
    t = T[r.printer_id]
    if r.status == "OFFLINE":
        add(r.timestamp,r.printer_id,"heartbeat",None,None,"CRITICAL","Device offline - no telemetry received"); continue
    if r.temperature_c > t.max_temperature_c: add(r.timestamp,r.printer_id,"temperature_c",r.temperature_c,t.max_temperature_c,"CRITICAL","Temperature above threshold")
    if r.vibration_mm_s > t.max_vibration_mm_s: add(r.timestamp,r.printer_id,"vibration_mm_s",r.vibration_mm_s,t.max_vibration_mm_s,"CRITICAL","Excessive vibration - inspect bearings")
    if r.motor_rpm > t.max_motor_rpm: add(r.timestamp,r.printer_id,"motor_rpm",r.motor_rpm,t.max_motor_rpm,"WARNING","Motor speed above limit")
    if r.power_kw > t.max_power_kw: add(r.timestamp,r.printer_id,"power_kw",r.power_kw,t.max_power_kw,"WARNING","Power draw above limit")
    if r.humidity_pct > t.max_humidity_pct: add(r.timestamp,r.printer_id,"humidity_pct",r.humidity_pct,t.max_humidity_pct,"WARNING","Humidity above limit")
    if r.humidity_pct < t.min_humidity_pct: add(r.timestamp,r.printer_id,"humidity_pct",r.humidity_pct,t.min_humidity_pct,"WARNING","Humidity below limit")
    if r.ink_level_pct < t.min_ink_level_pct: add(r.timestamp,r.printer_id,"ink_level_pct",r.ink_level_pct,t.min_ink_level_pct,"WARNING","Ink level low")
    if r.paper_stock_pct < t.min_paper_stock_pct: add(r.timestamp,r.printer_id,"paper_stock_pct",r.paper_stock_pct,t.min_paper_stock_pct,"INFO","Paper stock low")
    if r.paper_jams > t.max_paper_jams_per_interval: add(r.timestamp,r.printer_id,"paper_jams",r.paper_jams,t.max_paper_jams_per_interval,"CRITICAL","Repeated paper jams")
al = pd.DataFrame(alerts, columns=["timestamp","printer_id","metric","value","threshold","severity","message"])
al.insert(0,"alert_id",[f"ALT-{i+1:05d}" for i in range(len(al))])
al.to_csv("alerts.csv", index=False)

print(f"printers.csv : {len(master)} rows")
print(f"telemetry.csv: {len(df)} rows, anomaly rows = {int(df.is_anomaly.sum())}")
print(f"alerts.csv   : {len(al)} rows")
