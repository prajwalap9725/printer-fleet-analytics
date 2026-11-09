import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Overview, Distributions, Trends, Pivot, PrinterRules, LiveStats } from './analytics.types';
import OverviewTab from './components/OverviewTab';
import AnomalyTab from './components/AnomalyTab';
import TelemetryTab from './components/TelemetryTab';
import PredictionTab from './components/PredictionTab';
import LiveMonitorTab from './components/LiveMonitorTab';
import './App.css';

const API = process.env.REACT_APP_API_BASE || 'http://localhost:3001';

const TABS = ['Overview', 'Anomaly Detection', 'Telemetry Explorer', 'Prediction', 'Live Monitor'] as const;
type Tab = typeof TABS[number];

const App: React.FC = () => {
  const [tab, setTab] = useState<Tab>('Overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [distributions, setDistributions] = useState<Distributions | null>(null);
  const [trends, setTrends] = useState<Trends | null>(null);
  const [pivot, setPivot] = useState<Pivot | null>(null);
  const [rules, setRules] = useState<PrinterRules[]>([]);
  const [liveStats, setLiveStats] = useState<LiveStats | null>(null);
  const [printers, setPrinters] = useState<{ PrinterId: string; PrinterName: string; Location?: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [o, d, t, p, r, lp, s] = await Promise.all([
          axios.get(`${API}/api/analytics/overview`),
          axios.get(`${API}/api/analytics/distributions`),
          axios.get(`${API}/api/analytics/trends`),
          axios.get(`${API}/api/analytics/pivot`),
          axios.get(`${API}/api/analytics/thresholds`),
          axios.get(`${API}/printers`),
          axios.get(`${API}/api/stats`),
        ]);
        if (cancelled) return;
        setOverview(o.data);
        setDistributions(d.data);
        setTrends(t.data);
        setPivot(p.data);
        setRules(r.data);
        setPrinters(lp.data);
        setLiveStats(s.data);
        setError(null);
      } catch (e) {
        if (!cancelled) setError('Backend unreachable — is node dataset-backend/server.js running on port 3001?');
      }
    };
    load();
    const iv = setInterval(load, 5000); // live stats refresh every 5s
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  const badge = (label: string, value: string | number) => (
    <span className="pill"><span>{label}</span> <b>{value}</b></span>
  );

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">🖨️</div>
          <div>
            <div className="brand-name">EpicPrint Fleet<br />Analytics</div>
            <div className="brand-sub">IoT · CLOUD</div>
          </div>
        </div>

        <div className="side-section">DATASET</div>
        <div className="side-item"><span>Printers</span><b>{overview?.printers ?? '—'}</b></div>
        <div className="side-item"><span>Readings</span><b>{overview?.readings?.toLocaleString() ?? '—'}</b></div>
        <div className="side-item"><span>Window</span><b className="small">{overview?.window.split(' → ')[0].slice(0,10) ?? '—'}</b></div>
        <div className="side-item"><span>Anomaly %</span><b>{overview?.anomalyPct ?? '—'}%</b></div>
        <div className="side-item"><span>Models</span><b>{(overview?.machines ?? 0)}</b></div>
        <div className="side-item"><span>Locations</span><b>{overview?.locations ?? '—'}</b></div>

        <div className="side-section">METHODS</div>
        <div className="side-item"><span>Anomaly rules</span><b>Thresholds</b></div>
        <div className="side-item"><span>Risk scoring</span><b>Lift weights</b></div>
        <div className="side-item"><span>Pivot engine</span><b>Status×Printer</b></div>
        <div className="side-item"><span>Live replay</span><b>2s ticks</b></div>

        <div className="side-section">SOURCE</div>
        <div className="side-note">
          All figures are computed live from printers.csv, telemetry.csv and alerts.csv — no random data.
        </div>
      </aside>

      <main className="content">
        <div className="eyebrow">IOT ANOMALY DETECTION · CLOUD PROJECT</div>
        <h1>Comprehensive Printer Fleet Analytics</h1>
        <div className="sub">
          {overview?.readings.toLocaleString() ?? '…'} telemetry readings from {overview?.printers ?? '—'} industrial printers, {overview?.window ?? ''}
        </div>
        <div className="pills">
          {(overview ? [
            badge('Printers', overview.printers),
            badge('Machines', overview.machines),
            badge('Readings', overview.readings.toLocaleString()),
            badge('Alerts', overview.alerts),
          ] : [])}
        </div>

        {error && <div className="banner error">{error}</div>}

        <div className="tabs">
          {TABS.map((t, i) => (
            <button key={t} className={'tab' + (tab === t ? ' active' : '')} onClick={() => setTab(t)}>
              {i + 1}. {t}
            </button>
          ))}
        </div>

        {tab === 'Overview' && <OverviewTab overview={overview} distributions={distributions} trends={trends} pivot={pivot} />}
        {tab === 'Anomaly Detection' && <AnomalyTab rules={rules} distributions={distributions} trends={trends} />}
        {tab === 'Telemetry Explorer' && <TelemetryTab printers={printers} />}
        {tab === 'Prediction' && <PredictionTab printers={printers} />}
        {tab === 'Live Monitor' && <LiveMonitorTab stats={liveStats} />}
      </main>
    </div>
  );
};

export default App;
