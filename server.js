const path = require('path');
const express = require('express');
const cron = require('node-cron');

const { CRON_SCHEDULE } = require('./src/config');
const { runIngestCycle } = require('./src/ingest');
const { readListings, readRunLog } = require('./src/storage');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Current listings snapshot (always serves last known-good data, even if
// the most recent ingestion cycle failed).
app.get('/api/listings', (req, res) => {
  const data = readListings();
  res.json(data);
});

// Run history — lets you see the resilience behavior over time: which
// cycles succeeded, which were blocked/failed, and what fallback fired.
app.get('/api/runs', (req, res) => {
  res.json(readRunLog());
});

// Manually trigger an ingestion cycle on demand (handy for demoing without
// waiting for the cron schedule).
app.post('/api/ingest/run', async (req, res) => {
  try {
    const summary = await runIngestCycle();
    res.json(summary);
  } catch (err) {
    // Even an unexpected crash in the ingestion logic shouldn't take the
    // API server down with it.
    res.status(500).json({ status: 'unexpected_error', error: err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.listen(PORT, () => {
  console.log(`Job ingest demo listening on :${PORT}`);

  // Schedule recurring ingestion runs.
  cron.schedule(CRON_SCHEDULE, () => {
    runIngestCycle().catch((err) => console.error('Scheduled ingest failed:', err));
  });
});

// Fire the boot-time ingest AFTER the event loop returns so the server is
// already accepting requests (including /api/health) before we make any
// outbound network calls. This prevents Render's health check from timing
// out while remoteok.com is slow or retrying — which causes the 502.
setImmediate(() => {
  runIngestCycle().catch((err) => console.error('Boot ingest failed:', err));
});
