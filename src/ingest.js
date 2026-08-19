const {
  SOURCE_URL, SOURCE_TYPE, SOURCE_KEY,
  SECONDARY_SOURCE_URL, SECONDARY_SOURCE_TYPE, SECONDARY_SOURCE_KEY
} = require('./config');
const { fetchWithRetry } = require('./fetchWithRetry');
const { parseSource } = require('./sources');
const { validateBatch } = require('./validate');
const { writeListings, appendRunLog } = require('./storage');
const breaker = require('./circuitBreaker');

/**
 * Attempts one full pull-and-validate cycle against a single source
 * (fetch with retry -> parse -> schema-validate). Never throws; returns a
 * structured result so the caller can decide what to do next (try the
 * next source, fall back to cache, etc.) instead of a try/catch pyramid.
 */
async function attemptSource({ url, type, key }, { fetchImpl } = {}) {
  const attemptLog = [];
  const fetchResult = await fetchWithRetry(url, {
    onAttemptLog: (entry) => attemptLog.push(entry),
    ...(fetchImpl ? { fetchImpl } : {})
  });

  if (!fetchResult.ok) {
    return {
      ok: false,
      sourceKey: key,
      status: fetchResult.blocked ? 'blocked' : 'network_failure',
      httpStatus: fetchResult.status,
      error: fetchResult.error,
      attempts: attemptLog
    };
  }

  let parsed;
  try {
    parsed = parseSource(type, fetchResult.body);
  } catch (err) {
    return {
      ok: false,
      sourceKey: key,
      status: 'parse_failure',
      error: err.message,
      attempts: attemptLog
    };
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { ok: false, sourceKey: key, status: 'empty_response', attempts: attemptLog };
  }

  const { valid, quarantined } = validateBatch(parsed);

  if (valid.length === 0) {
    // Every record failed validation — the source likely changed its
    // markup/schema overnight. Surfaced distinctly from a plain empty
    // response because the remediation is different (fix the parser vs.
    // just wait for the source to come back).
    return {
      ok: false,
      sourceKey: key,
      status: 'schema_drift_suspected',
      quarantinedCount: quarantined.length,
      sampleQuarantined: quarantined.slice(0, 3),
      attempts: attemptLog
    };
  }

  return {
    ok: true,
    sourceKey: key,
    sourceUrl: url,
    valid,
    quarantined,
    attempts: attemptLog
  };
}

/**
 * Runs one ingestion cycle end-to-end:
 *   1. If the primary source's breaker is open (tripped after repeated
 *      consecutive failures), skip it entirely and go straight to the
 *      secondary — no point retrying a source known to be down.
 *   2. Otherwise attempt the primary. Success -> store, record breaker
 *      success, done.
 *   3. Primary failure -> record breaker failure, attempt the secondary
 *      (same breaker logic applied to it independently).
 *   4. Secondary also fails (or its breaker is open) -> fall back to
 *      serving the last known-good snapshot rather than crashing or
 *      wiping good data.
 *
 * This is the concrete implementation of the "plan B when the primary
 * approach gets shut down" question from the design doc — not just a
 * paragraph, but the actual control flow a scheduled run takes.
 */
async function runIngestCycle({ fetchImplBySourceKey = {} } = {}) {
  const primary = { url: SOURCE_URL, type: SOURCE_TYPE, key: SOURCE_KEY };
  const secondary = { url: SECONDARY_SOURCE_URL, type: SECONDARY_SOURCE_TYPE, key: SECONDARY_SOURCE_KEY };

  const attemptsBySource = {};

  for (const source of [primary, secondary]) {
    const breakerStatus = breaker.getStatus(source.key);

    if (breakerStatus.open) {
      attemptsBySource[source.key] = {
        skipped: true,
        reason: 'circuit_open',
        remainingMs: breakerStatus.remainingMs,
        consecutiveFailures: breakerStatus.consecutiveFailures
      };
      continue; // don't attempt a source we know is down; try the next one
    }

    const result = await attemptSource(source, { fetchImpl: fetchImplBySourceKey[source.key] });
    attemptsBySource[source.key] = result;

    if (result.ok) {
      breaker.recordSuccess(source.key);
      const stored = writeListings(result.valid, result.sourceUrl);
      const summary = {
        status: result.quarantined.length > 0 ? 'success_with_quarantine' : 'success',
        activeSource: source.key,
        storedCount: result.valid.length,
        quarantinedCount: result.quarantined.length,
        sources: attemptsBySource,
        lastSuccessAt: stored.lastSuccessAt
      };
      appendRunLog(summary);
      return summary;
    }

    // This source failed — record it against its breaker and fall
    // through to try the next source in the loop (if any remain).
    breaker.recordFailure(source.key);
  }

  // Every source failed (or was skipped due to an open breaker). Serve
  // the last known-good snapshot instead of an empty/broken result.
  const summary = {
    status: 'all_sources_failed',
    sources: attemptsBySource,
    fallback: 'served_last_known_good'
  };
  appendRunLog(summary);
  return summary;
}

module.exports = { runIngestCycle, attemptSource };
