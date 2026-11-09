// Smoke-test the PDF report generator standalone (no HTTP server needed).
const reports = require('./report');
reports.printerReportPdf(process.argv[2] || 'EPR-001', {
  available: true, eventCount: 12, window: 3, lastEventAt: '2026-10-15T05:55:00Z',
}).then((buf) => {
  require('fs').writeFileSync(process.argv[3] || 'smoke.pdf', buf);
  console.log('OK', buf.length, 'bytes');
}).catch((e) => { console.error('FAIL', e); process.exit(1); });
