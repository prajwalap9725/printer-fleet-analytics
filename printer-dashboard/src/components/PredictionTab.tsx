import React, { useState } from 'react';
import axios from 'axios';
import { PredictResult, PredictInput } from '../analytics.types';

const API = process.env.REACT_APP_API_BASE || 'http://localhost:3001';

const DEFAULTS: Record<string, Record<string, number>> = {
  'EPR-001': { temperature_c: 52, humidity_pct: 50, ink_level_pct: 60, paper_stock_pct: 60, motor_rpm: 11000, vibration_mm_s: 2.1, power_kw: 38, paper_jams: 0 },
  'EPR-003': { temperature_c: 44, humidity_pct: 50, ink_level_pct: 60, paper_stock_pct: 60, motor_rpm: 6000, vibration_mm_s: 1.2, power_kw: 18, paper_jams: 0 },
  'EPR-007': { temperature_c: 38, humidity_pct: 50, ink_level_pct: 60, paper_stock_pct: 60, motor_rpm: 3000, vibration_mm_s: 2.6, power_kw: 12, paper_jams: 0 },
};

const SLIDERS: { key: keyof PredictInput & string; label: string; min: number; max: number; step: number; unit: string }[] = [
  { key: 'temperature_c', label: 'Temperature', min: 20, max: 90, step: 1, unit: '°C' },
  { key: 'humidity_pct', label: 'Humidity', min: 20, max: 95, step: 1, unit: '%' },
  { key: 'ink_level_pct', label: 'Ink level', min: 0, max: 100, step: 1, unit: '%' },
  { key: 'paper_stock_pct', label: 'Paper stock', min: 0, max: 100, step: 1, unit: '%' },
  { key: 'motor_rpm', label: 'Motor RPM', min: 0, max: 14000, step: 100, unit: '' },
  { key: 'vibration_mm_s', label: 'Vibration', min: 0, max: 8, step: 0.1, unit: 'mm/s' },
  { key: 'power_kw', label: 'Power', min: 0, max: 55, step: 1, unit: 'kW' },
  { key: 'paper_jams', label: 'Paper jams', min: 0, max: 5, step: 1, unit: '' },
];

const LEVEL_COLOR = { NORMAL: '#69f0ae', ELEVATED: '#ffd54f', WARNING: '#ffab40', CRITICAL: '#ff5252' };

const PredictionTab: React.FC<{ printers: { PrinterId: string }[] }> = ({ printers }) => {
  const [printerId, setPrinterId] = useState('EPR-001');
  const [inputs, setInputs] = useState<Record<string, number>>(DEFAULTS['EPR-001']);
  const [result, setResult] = useState<PredictResult | null>(null);
  const [predicting, setPredicting] = useState(false);

  const changePrinter = (pid: string) => {
    setPrinterId(pid);
    setInputs(DEFAULTS[pid] || {});
    setResult(null);
  };

  const setVal = (k: string, v: number) => setInputs(prev => ({ ...prev, [k]: v }));

  const predict = async () => {
    setPredicting(true);
    try {
      const res = await axios.post(`${API}/api/analytics/predict`, { printer_id: printerId, ...inputs });
      setResult(res.data);
    } catch (e) {
      setResult(null);
    } finally {
      setPredicting(false);
    }
  };

  const levelColor = (level: string) => LEVEL_COLOR[level as keyof typeof LEVEL_COLOR] || '#69f0ae';

  return (
    <div>
      <div className="section-title">PREDICTION: RISK SCORING FROM LIVE SENSOR INPUTS</div>
      <div className="banner info">
        The model learns, from the labelled dataset, how much each threshold breach raises the odds of an
        anomaly episode (<b>lift weights</b>), then scores your simulated sensor state against the selected
        printer's own machine-specific limits. Fully deterministic — no ML black box.
      </div>

      <div className="filters">
        <label>
          Printer profile
          <select value={printerId} onChange={e => changePrinter(e.target.value)}>
            {printers.map(p => <option key={p.PrinterId} value={p.PrinterId}>{p.PrinterId}</option>)}
          </select>
        </label>
      </div>

      <div className="panel predict-grid">
        {SLIDERS.map(s => (
          <label key={s.key} className="slider">
            <span>{s.label} <b>{inputs[s.key] ?? 0}{s.unit}</b></span>
            <input
              type="range"
              min={s.min} max={s.max} step={s.step}
              value={inputs[s.key] ?? s.min}
              onChange={e => setVal(s.key, Number(e.target.value))}
            />
          </label>
        ))}
        <button className="primary-btn" onClick={predict} disabled={predicting}>
          {predicting ? 'Scoring…' : 'Predict anomaly risk'}
        </button>
      </div>

      {result && (
        <>
          <div className="section-title">RESULT</div>
          <div className="cards2">
            <div className="panel result-card">
              <div className="kpi-label">RISK SCORE</div>
              <div className="big-risk" style={{ color: levelColor(result.level) }}>
                {result.riskPct}%
              </div>
              <div className="pill" style={{ background: levelColor(result.level), color: '#0b1120' }}>
                <b>{result.level}</b>
              </div>
            </div>
            <div className="panel">
              <div className="panel-title">Breached thresholds</div>
              {result.breached.length === 0 ? (
                <div className="hint">No thresholds breached — printer running within its limits.</div>
              ) : (
                <table className="mini-table">
                  <thead><tr><th>Metric</th><th>Value</th><th>Limit</th><th>Direction</th></tr></thead>
                  <tbody>
                    {result.breached.map(b => (
                      <tr key={b.metric}>
                        <td>{b.metric}</td>
                        <td>{b.value}</td>
                        <td>{b.limit}</td>
                        <td style={{ color: b.dir === 'above' ? '#ff5252' : '#448aff' }}>{b.dir}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="section-title">LEARNED LIFT WEIGHTS (HOW MUCH EACH BREACH MATTERS)</div>
          <div className="panel">
            {result.weights.length === 0 ? (
              <div className="hint">No metric in this state carries dataset-learned lift above 1×.</div>
            ) : (
              <table className="mini-table">
                <thead><tr><th>Metric</th><th>Lift weight</th><th>Visual</th></tr></thead>
                <tbody>
                  {result.weights.map(w => (
                    <tr key={w.metric}>
                      <td>{w.metric}</td>
                      <td>{w.weight}×</td>
                      <td>
                        <div className="lift-bar" style={{ width: `${Math.min(100, (w.weight / 4) * 100)}%` }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default PredictionTab;
