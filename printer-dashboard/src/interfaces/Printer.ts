export interface Thresholds {
  Upper: number;
  Lower: number;
}

export interface MetricThreshold {
  metric: string;
  severity: string;
  lower: number | null;
  upper: number | null;
}

export interface TelemetryReading {
  timestamp: string;
  status?: string;
  temperature_c?: number | null;
  humidity_pct?: number | null;
  ink_level_pct?: number | null;
  paper_stock_pct?: number | null;
  motor_rpm?: number | null;
  vibration_mm_s?: number | null;
  power_kw?: number | null;
  paper_jams?: number | null;
  error_code?: string | null; // e.g. E-COMM-LOST when the device stops reporting
  [key: string]: unknown;
}

export interface Printer {
  PrinterId: string;   // primary key (as in the original DynamoDB schema)
  PrinterName?: string;
  Model?: string;
  MachineType?: string;
  Location?: string;
  EventCount: number;  // anomaly events fired (accrued as the dataset is replayed)
  OutOfBoundsCount?: number; // metrics out of bounds in the latest reading
  Thresholds: Thresholds;
  MetricThresholds?: MetricThreshold[]; // full machine-specific threshold profile
  ThresholdSummary?: string;            // human-readable multi-metric threshold line
  Window?: number;      // consecutive readings before an event fires
  LastEventAt?: string | null;
  LastReading?: TelemetryReading | null;
}
