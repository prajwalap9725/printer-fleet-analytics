import React from 'react';
import { Bar, Line } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  Title, Tooltip, Legend, Filler, ArcElement,
} from 'chart.js';
import { Overview, Distributions, Trends, Pivot } from '../analytics.types';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler, ArcElement);

interface Props {
  overview: Overview | null;
  distributions: Distributions | null;
  trends: Trends | null;
  pivot: Pivot | null;
}

const CYAN = 'rgba(75, 192, 192, 0.85)';
const CYAN_BORDER = 'rgba(75, 192, 192, 1)';
const RED = 'rgba(255, 99, 132, 0.85)';
const YELLOW = 'rgba(255, 205, 86, 0.85)';
const GRID = 'rgba(255,255,255,0.06)';
const TICKS = '#8aa';

const darkOpts = (title: string, legendShown = false) => ({
  responsive: true,
  plugins: {
    legend: { display: legendShown, labels: { color: TICKS } },
    title: { display: false },
  },
  scales: {
    x: { grid: { color: GRID }, ticks: { color: TICKS } },
    y: { beginAtZero: true, grid: { color: GRID }, ticks: { color: TICKS } },
  },
});

const OverviewTab: React.FC<Props> = ({ overview, distributions, trends, pivot }) => {
  if (!overview || !distributions || !trends) return <div className="loading">Loading analytics…</div>;

  const typeEntries = Object.entries(distributions.byType).sort((a,b) => b[1]-a[1]);
  const statusEntries = Object.entries(distributions.statusDist);
  const sevEntries = Object.entries(distributions.sevDist);

  const typeChart = {
    labels: typeEntries.map(e => e[0].replace(/_/g,' ')),
    datasets: [{ label: 'anomaly readings', data: typeEntries.map(e => e[1]), backgroundColor: CYAN, borderColor: CYAN_BORDER, borderWidth: 1, borderRadius: 6 }],
  };

  const statusChart = {
    labels: statusEntries.map(e => e[0]),
    datasets: [{ label: 'readings', data: statusEntries.map(e => e[1]), backgroundColor: statusEntries.map(e => ({
      PRINTING: CYAN, IDLE: 'rgba(100,149,237,0.85)', ERROR: RED, MAINTENANCE: YELLOW, OFFLINE: 'rgba(120,120,130,0.85)',
    } as any)[e[0]] || CYAN), borderWidth: 0, borderRadius: 6 }],
  };

  const dailyChart = {
    labels: trends.daily.map(d => d.day),
    datasets: [{
      label: 'anomaly rate %',
      data: trends.daily.map(d => d.anomalyRate),
      borderColor: CYAN_BORDER,
      backgroundColor: 'rgba(75,192,192,0.15)',
      fill: true,
      tension: 0.35,
      pointRadius: 4,
      pointBackgroundColor: '#0ff',
    }],
  };

  const hourlyChart = {
    labels: trends.hourly.map(h => h.hour + ':00'),
    datasets: [{ label: 'anomaly rate % by hour', data: trends.hourly.map(h => h.rate), borderColor: '#b388ff', backgroundColor: 'rgba(179,136,255,0.1)', fill: true, tension: 0.35, pointRadius: 2 }],
  };

  return (
    <div>
      <div className="section-title">DATASET OVERVIEW AND KEY FIGURES</div>

      <div className="cards4">
        <div className="kpi cyan"><div className="kpi-label">READINGS</div><div className="kpi-value">{overview.readings.toLocaleString()}</div></div>
        <div className="kpi cyan"><div className="kpi-label">ANOMALY RATE</div><div className="kpi-value">{overview.anomalyPct}%</div></div>
        <div className="kpi red"><div className="kpi-label">ALERTS</div><div className="kpi-value">{overview.alerts.toLocaleString()}</div></div>
        <div className="kpi red"><div className="kpi-label">CRITICAL ALERTS</div><div className="kpi-value">{overview.criticalAlerts}</div></div>
        <div className="kpi cyan"><div className="kpi-label">OFFLINE READINGS</div><div className="kpi-value">{overview.offlineCount}</div></div>
      </div>

      <div className="section-title">DISTRIBUTIONS AND TRENDS</div>
      <div className="grid2">
        <div className="panel">
          <div className="panel-title">Anomaly readings by episode type</div>
          <Bar data={typeChart} options={darkOpts('by type') as any} />
        </div>
        <div className="panel">
          <div className="panel-title">Machine status distribution</div>
          <Bar data={statusChart} options={darkOpts('status') as any} />
        </div>
      </div>

      <div className="grid2">
        <div className="panel">
          <div className="panel-title">Anomaly rate per day</div>
          <Line data={dailyChart} options={darkOpts('daily rate') as any} />
        </div>
        <div className="panel">
          <div className="panel-title">Anomaly rate by hour of day</div>
          <Line data={hourlyChart} options={darkOpts('hourly rate') as any} />
        </div>
      </div>

      <div className="section-title">ALERT SEVERITY BREAKDOWN</div>
      <div className="cards4">
        {sevEntries.map(([sev, n]) => (
          <div key={sev} className={'kpi ' + (sev === 'CRITICAL' ? 'red' : sev === 'WARNING' ? 'yellow' : 'cyan')}>
            <div className="kpi-label">{sev}</div><div className="kpi-value">{n}</div>
          </div>
        ))}
      </div>

      {pivot && (
        <>
          <div className="section-title">OLAP PIVOT — READINGS BY PRINTER × STATUS</div>
          <div className="panel table-panel">
            <div className="panel-title">Readings (anomaly count in last column)</div>
            <table className="pivot">
              <thead>
                <tr>
                  <th>Printer</th>
                  {pivot.cols.map(c => <th key={c}>{c}</th>)}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {pivot.rows.map((row, i) => (
                  <tr key={row.Printer as string} className={i === pivot.rows.length - 1 ? 'totals' : ''}>
                    <td>{row.Printer}</td>
                    {pivot.cols.map(c => <td key={c}>{(row as any)[c] ?? 0}</td>)}
                    <td><b>{row.Total as number}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

export default OverviewTab;
