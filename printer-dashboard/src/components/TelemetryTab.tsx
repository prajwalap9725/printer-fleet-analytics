import React, { useEffect, useMemo, useState } from 'react';
import { Line, Scatter } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js';
import axios from 'axios';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

interface Props {
  printers: { PrinterId: string; PrinterName: string }[];
}

const API = process.env.REACT_APP_API_BASE || 'http://localhost:3001';
const METRICS = ['temperature_c','humidity_pct','ink_level_pct','paper_stock_pct','motor_rpm','vibration_mm_s','power_kw','pages_per_min'] as const;
type Metric = typeof METRICS[number];

const COLORS = ['#00e5ff','#b388ff','#ffd54f','#69f0ae','#ff5252','#448aff','#ffab40','#e0e0e0'];
const GRID = 'rgba(255,255,255,0.06)';
const TICKS = '#8aa';

const TelemetryTab: React.FC<Props> = ({ printers }) => {
  const [printer, setPrinter] = useState<string>('EPR-001');
  const [metric, setMetric] = useState<Metric>('temperature_c');
  const [series, setSeries] = useState<{ t: string; v: number | null; anom: number }[]>([]);
  const [reportState, setReportState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [reportError, setReportError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await axios.get(`${API}/api/telemetry/${printer}?metric=${metric}`);
        if (!cancelled) setSeries(res.data.series);
      } catch (e) { /* keep old series */ }
    };
    load();
    return () => { cancelled = true; };
  }, [printer, metric]);

  const downloadReport = async () => {
    setReportState('loading');
    setReportError(null);
    try {
      const res = await axios.get(`${API}/api/report/${printer}`, { responseType: 'blob', timeout: 60000 });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `EpicReads_Printer_${printer}_Report.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setReportState('idle');
    } catch (e: any) {
      setReportState('error');
      setReportError(
        e?.response?.status === 404 ? `Unknown printer ${printer}.` :
        e?.response?.status === 500 ? 'PDF generation failed on the backend. Check the backend console.' :
        e?.code === 'ECONNABORTED' ? 'Report generation timed out — is the backend on port 3001 running?' :
        `Could not generate the report (${e?.message || 'unknown error'}).`
      );
    }
  };

  const lineData = useMemo(() => ({
    labels: series.map(s => s.t.slice(11, 16)),
    datasets: [
      {
        label: metric,
        data: series.map(s => s.v),
        borderColor: COLORS[0],
        backgroundColor: 'rgba(0, 229, 255, 0.08)',
        fill: true,
        tension: 0.3,
        pointRadius: (ctx: any) => {
          const i = ctx.dataIndex;
          return series[i]?.anom === 1 ? 4 : 0;
        },
        pointBackgroundColor: (ctx: any) => {
          const i = ctx.dataIndex;
          return series[i]?.anom === 1 ? '#ff5252' : '#00e5ff';
        },
        pointBorderWidth: 0,
        spanGaps: true,
      } as any,
    ],
  }), [series, metric]);

  // extract anomalies for scatter of temperature vs vibration
  const anomalous = series.filter(s => s.anom === 1);
  const normal = series.filter(s => s.anom === 0);

  return (
    <div>
      <div className="section-title">TELEMETRY TIME SERIES PER PRINTER</div>
      <div className="banner info">
        Pick a printer and a sensor — red points are labelled anomalies from the dataset.
      </div>
      <div className="filters">
        <label>
          Printer
          <select value={printer} onChange={e => setPrinter(e.target.value)}>
            {printers.map(p => <option key={p.PrinterId} value={p.PrinterId}>{p.PrinterId} — {p.PrinterName}</option>)}
          </select>
        </label>
        <label>
          Metric
          <select value={metric} onChange={e => setMetric(e.target.value as Metric)}>
            {METRICS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="report-wrap">
          <button
            className="report-btn"
            onClick={downloadReport}
            disabled={reportState === 'loading' || series.length === 0}
          >
            {reportState === 'loading' ? 'Generating PDF…' : '⬇ Download PDF Report'}
          </button>
        </label>
      </div>
      {reportError && <div className="banner error">Report error: {reportError}</div>}
      <div className="panel">
        {series.length > 0 ? (
          <Line data={lineData} options={{
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
              x: { grid: { color: GRID }, ticks: { color: TICKS, maxTicksLimit: 16 } },
              y: { grid: { color: GRID }, ticks: { color: TICKS } },
            },
          }} />
        ) : <div className="loading">Loading series…</div>}
      </div>
      <div className="cards4">
        <div className="kpi cyan"><div className="kpi-label">READINGS SHOWN</div><div className="kpi-value">{series.length}</div></div>
        <div className="kpi red"><div className="kpi-label">ANOMALIES</div><div className="kpi-value">{series.filter(s=>s.anom===1).length}</div></div>
        <div className="kpi cyan"><div className="kpi-label">ACTIVE PRINTER</div><div className="kpi-value">{printer}</div></div>
        <div className="kpi cyan"><div className="kpi-label">METRIC</div><div className="kpi-value small">{metric}</div></div>
      </div>
    </div>
  );
};

export default TelemetryTab;
