// Types for the analytics API responses
export interface Overview {
  printers: number;
  machines: number;
  locations: number;
  readings: number;
  window: string;
  anomalyPct: string;
  offlineCount: number;
  alerts: number;
  criticalAlerts: number;
  anomalyTypes: Record<string, number>;
  sensors: number;
}

export interface Distributions {
  byType: Record<string, number>;
  statusDist: Record<string, number>;
  sevDist: Record<string, number>;
  metricDist: Record<string, number>;
}

export interface HourlyPoint { hour: number; rate: number; count: number; readings: number }
export interface DailyPoint { day: string; total: number; anomaly: number; printing: number; anomalyRate: number }

export interface Trends { hourly: HourlyPoint[]; daily: DailyPoint[] }

export interface PivotRow { Printer: string; [col: string]: number | string }
export interface Pivot { cols: string[]; rows: PivotRow[] }

export interface ThresholdRule {
  metric: string;
  limit?: number;
  min?: number;
  max?: number;
  dir?: string;
  severity: string;
}
export interface PrinterRules {
  printer_id: string;
  printer_name: string;
  model: string;
  location: string;
  rules: ThresholdRule[];
}

export interface PredictInput {
  printer_id?: string;
  temperature_c?: number | null;
  humidity_pct?: number | null;
  ink_level_pct?: number | null;
  paper_stock_pct?: number | null;
  motor_rpm?: number | null;
  vibration_mm_s?: number | null;
  power_kw?: number | null;
  paper_jams?: number | null;
}
export interface PredictResult {
  riskPct: number;
  level: 'CRITICAL' | 'WARNING' | 'ELEVATED' | 'NORMAL';
  breached: { metric: string; value: number; limit: number; dir: 'above' | 'below' }[];
  weights: { metric: string; weight: number }[];
}

export interface LiveStats {
  printers: number;
  readingsIngested: number;
  eventsFired: number;
  lastEvent: { id: string; deviceId: string; type: string; timestamp: string; severity: string; message: string; value?: number; threshold?: number } | null;
  topPrinters: { PrinterId: string; EventCount: number }[];
  window: number;
}
