import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { LiveStats } from '../analytics.types';
import './LiveMonitorTab.css';

const API = process.env.REACT_APP_API_BASE || 'http://localhost:3001';

const LiveMonitorTab: React.FC<{ stats: LiveStats | null }> = ({ stats }) => {
  const [events, setEvents] = useState<any[]>([]);
  const [auto, setAuto] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await axios.get(`${API}/api/events`);
        if (!cancelled) setEvents(r.data);
      } catch (e) { /* ignore */ }
    };
    load();
    if (!auto) return;
    const iv = setInterval(load, 3000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [auto]);

  if (!stats) return <div className="loading">Waiting for the replay…</div>;

  const ingestRate = stats.readingsIngested;

  return (
    <div>
      <div className="section-title">LIVE REPLAY MONITOR</div>
      <div className="banner info">
        Every reading is a tick from the dataset replayed as live IoT traffic. This is the exact flow the
        AWS IoT → Lambda → DynamoDB pipeline implements, running locally on the dataset.
      </div>

      <div className="cards4">
        <div className="kpi cyan pulse"><div className="kpi-label">READINGS INGESTED LIVE</div><div className="kpi-value">{ingestRate.toLocaleString()}</div></div>
        <div className="kpi yellow"><div className="kpi-label">EVENTS FIRED</div><div className="kpi-value">{stats.eventsFired}</div></div>
        <div className="kpi cyan"><div className="kpi-label">DETECTION WINDOW</div><div className="kpi-value">{stats.window}</div></div>
        <div className="kpi red"><div className="kpi-label">ACTIVE PRINTERS</div><div className="kpi-value">{stats.printers}</div></div>
      </div>

      <div className="section-title">RECENT ANOMALY EVENTS</div>
      <div className="panel table-panel">
        {events.length === 0 ? <div className="loading">No events yet…</div> : (
          <table className="pivot">
            <thead><tr><th>Event ID</th><th>Timestamp</th><th>Printer</th><th>Type</th><th>Severity</th><th>Message</th></tr></thead>
            <tbody>
              {events.map(e => (
                <tr key={e.id}>
                  <td>{e.id}</td>
                  <td>{new Date(e.timestamp).toLocaleTimeString()}</td>
                  <td>{e.deviceId}</td>
                  <td>{e.type}</td>
                  <td><span className={'sev ' + e.severity.toLowerCase()}>{e.severity}</span></td>
                  <td className="muted">{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="section-title">TOP OFFENDERS</div>
      <div className="cards4">
        {(stats.topPrinters || []).map(p => (
          <div key={p.PrinterId} className="kpi cyan">
            <div className="kpi-label">{p.PrinterId}</div>
            <div className="kpi-value">{p.EventCount}</div>
          </div>
        ))}
      </div>

      <div className="section-title">CONTROLS</div>
      <div className="controls-row">
        <label className="toggle-label">
          <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />
          Auto-refresh every 3s
        </label>
        <button
          className="primary-btn small"
          onClick={async () => { await axios.post(`${API}/api/reset`); setEvents([]); }}
        >
          Reset counters
        </button>
      </div>
    </div>
  );
};

export default LiveMonitorTab;
