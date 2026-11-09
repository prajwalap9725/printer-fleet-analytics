import React from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend,
} from 'chart.js';
import { Distributions, PrinterRules, Trends } from '../analytics.types';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

interface Props {
  rules: PrinterRules[];
  distributions: Distributions | null;
  trends: Trends | null;
}

const CYAN = 'rgba(75, 192, 192, 0.85)';
const RED = 'rgba(255, 99, 132, 0.85)';
const GRID = 'rgba(255,255,255,0.06)';
const TICKS = '#8aa';

const AnomalyTab: React.FC<Props> = ({ rules, distributions, trends }) => {
  if (!rules.length || !distributions) return <div className="loading">Loading rules…</div>;

  const metricEntries = Object.entries(distributions.metricDist).sort((a,b) => b[1]-a[1]);
  const metricChart = {
    labels: metricEntries.map(e => e[0]),
    datasets: [{ label: 'threshold breaches', data: metricEntries.map(e => e[1]), backgroundColor: CYAN, borderWidth: 0, borderRadius: 6 }],
  };

  // heatmap-ish: printer × top-3 breach metrics from pivot-anomaly counts (rules view uses rules instead)
  return (
    <div>
      <div className="section-title">DETECTION RULES: MACHINE-SPECIFIC THRESHOLDS</div>
      <div className="banner info">
        Each printer carries its own limits from printers.csv. A metric breaching its bound for
        <b> 3 consecutive readings</b> fires an anomaly event — mirrored exactly by the alert generation in alerts.csv.
      </div>

      <div className="cards3">
        {rules.map(r => (
          <div key={r.printer_id} className="panel rule-card">
            <div className="panel-title">{r.printer_id} · {r.printer_name}</div>
            <div className="rule-sub">{r.model} — {r.location}</div>
            <table className="mini-table">
              <thead><tr><th>Metric</th><th>Bound</th><th>Severity</th></tr></thead>
              <tbody>
                {r.rules.map((rule, i) => (
                  <tr key={i}>
                    <td>{rule.metric}</td>
                    <td>{rule.limit != null ? (rule.dir === '<=' ? `≤ ${rule.limit}` : '') : `${rule.min ?? ''}${rule.max != null ? '–' + rule.max : '+'}`}</td>
                    <td>
                      <span className={'sev ' + rule.severity.toLowerCase()}>{rule.severity}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <div className="section-title">BREACHES BY METRIC (FROM ALERTS.CSV)</div>
      <div className="panel">
        <Bar data={metricChart} options={{
          indexAxis: 'y' as const,
          responsive: true,
          plugins: { legend: { display: false } },
          scales: { x: { beginAtZero: true, grid: { color: GRID }, ticks: { color: TICKS } }, y: { grid: { color: GRID }, ticks: { color: TICKS } } },
        }} />
      </div>

      {trends && (
        <>
          <div className="section-title">WHEN DO ANOMALIES STRIKE? (HOURLY HEAT)</div>
          <div className="panel">
            <div className="heat-row">
              {trends.hourly.map(h => (
                <div
                  key={h.hour}
                  className="heat-cell"
                  title={`${h.hour}:00 — ${h.count} anomalies in ${h.readings} readings (${h.rate.toFixed(1)}%)`}
                  style={{ background: `rgba(255, 99, 132, ${Math.min(0.9, h.rate / 18)})` }}
                >
                  <span>{h.hour}</span>
                  <b>{h.count}</b>
                </div>
              ))}
            </div>
            <div className="hint">Darker red = higher anomaly rate. Values are readings count of anomaly per clock hour across all printers.</div>
          </div>
        </>
      )}
    </div>
  );
};

export default AnomalyTab;
