export interface Event {
  id: string;          // unique event id from the backend (e.g. EVT-00001)
  deviceId: string;    // PrinterId the event belongs to
  type: string;        // breached metric or 'OFFLINE'
  timestamp: string;   // dataset timestamp of the reading that triggered it
  severity?: string;   // CRITICAL / WARNING / INFO
  value?: number | null;    // sensor value that breached the threshold
  threshold?: number | null; // threshold that was exceeded/violated
  message?: string;
  anomalyType?: string; // labelled episode from the dataset, when present
}
