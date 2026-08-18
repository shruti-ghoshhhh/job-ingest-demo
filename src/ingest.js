const { SOURCE_URL } = require('./config');
const { fetchWithRetry } = require('./fetchWithRetry');
const { validateBatch } = require('./validate');
const { readListings, writeListings, appendRunLog } = require('./storage');

/**
 * Runs one ingestion cycle end-to-end and returns a run summary.
 * This function is the resilience story: no matter which stage fails
 * (network, block signal, empty body, bad markup/schema), it degrades to
 * "keep serving the last known-good snapshot" instead of crashing the
 * process or wiping good data with a bad partial result.
 */
async function runIngestCycle() {
  const attemptLog = [];
  const result = await fetchWithRetry(SOURCE_URL, {
    onAttemptLog: (entry) => attemptLog.push(entry)
  });

  // Stage 1: the request itself failed / we got blocked after retries.
  if (!result.ok) {
    const summary = {
      status: result.blocked ? 'blocked' : 'network_failure',
      httpStatus: result.status,
      error: result.error,
      attempts: attemptLog,
      fallback: 'served_last_known_good'
    };
    appendRunLog(summary);
    return summary;
  }

  // Stage 2: we got a 200 but the body is empty or unparseable.
  let parsed;
  try {
    parsed = JSON.parse(result.body);
  } catch (err) {
    const summary = {
      status: 'parse_failure',
      error: `JSON parse failed: ${err.message}`,
      attempts: attemptLog,
      fallback: 'served_last_known_good'
    };
    appendRunLog(summary);
    return summary;
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    const summary = {
      status: 'empty_response',
      attempts: attemptLog,
      fallback: 'served_last_known_good'
    };
    appendRunLog(summary);
    return summary;
  }

  // Stage 3: schema validation per-record. RemoteOK's first array element
  // is a metadata/legal blob, not a listing — this alone will quarantine
  // as expected, demonstrating the pipeline doesn't choke on it.
  const { valid, quarantined } = validateBatch(parsed);

  if (valid.length === 0) {
    // Every record failed validation — likely the source changed its
    // markup/schema overnight. Don't overwrite good data with nothing.
    const summary = {
      status: 'schema_drift_suspected',
      quarantinedCount: quarantined.length,
      sampleQuarantined: quarantined.slice(0, 3),
      attempts: attemptLog,
      fallback: 'served_last_known_good'
    };
    appendRunLog(summary);
    return summary;
  }

  // Success path: partial success is still success — persist what
  // validated, log what didn't.
  const stored = writeListings(valid, SOURCE_URL);
  const summary = {
    status: quarantined.length > 0 ? 'success_with_quarantine' : 'success',
    storedCount: valid.length,
    quarantinedCount: quarantined.length,
    attempts: attemptLog,
    lastSuccessAt: stored.lastSuccessAt
  };
  appendRunLog(summary);
  return summary;
}

module.exports = { runIngestCycle };
