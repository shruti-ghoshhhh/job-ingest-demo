const defaultFetch = require('node-fetch');
const { MAX_RETRIES, BASE_BACKOFF_MS } = require('./config');
const { nextIdentity, jitterDelay } = require('./identity');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches a URL with:
 *  - a rotated identity (User-Agent) per attempt
 *  - pacing jitter before each request
 *  - exponential backoff + jitter between retries
 *  - explicit handling of 429 / 403 (the two responses that signal
 *    "you've been noticed") vs generic network failure
 *
 * Returns { ok, status, body, attempts, blocked } — never throws for
 * expected failure modes, so callers can decide what "resilience" means
 * (fallback to cache, skip cycle, alert) instead of crashing.
 *
 * `fetchImpl` is injectable (defaults to node-fetch) specifically so unit
 * tests can simulate 403s, timeouts, and malformed responses
 * deterministically without depending on a real network call. See
 * test/fetchWithRetry.test.js.
 */
async function fetchWithRetry(url, { onAttemptLog, fetchImpl = defaultFetch } = {}) {
  let lastError = null;
  let lastStatus = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    await jitterDelay();
    const identity = nextIdentity();

    try {
      const res = await fetchImpl(url, { headers: identity.headers, timeout: 10000 });
      lastStatus = res.status;

      if (res.status === 429 || res.status === 403) {
        // Explicit "you've been noticed" signal — back off harder than a
        // generic error would warrant, and surface it distinctly so the
        // caller can trip a circuit breaker instead of hammering further.
        const backoff = BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 500;
        onAttemptLog?.({ attempt, status: res.status, action: 'blocked_backoff', backoff });
        await sleep(backoff);
        continue;
      }

      if (!res.ok) {
        const backoff = BASE_BACKOFF_MS * 2 ** (attempt - 1);
        onAttemptLog?.({ attempt, status: res.status, action: 'retry_backoff', backoff });
        await sleep(backoff);
        continue;
      }

      const text = await res.text();
      onAttemptLog?.({ attempt, status: res.status, action: 'success' });
      return { ok: true, status: res.status, body: text, attempts: attempt, blocked: false };
    } catch (err) {
      lastError = err;
      const backoff = BASE_BACKOFF_MS * 2 ** (attempt - 1);
      onAttemptLog?.({ attempt, status: null, action: 'network_error', error: err.message, backoff });
      await sleep(backoff);
    }
  }

  const blocked = lastStatus === 429 || lastStatus === 403;
  return {
    ok: false,
    status: lastStatus,
    body: null,
    attempts: MAX_RETRIES,
    blocked,
    error: lastError?.message || `Exhausted retries (last status: ${lastStatus})`
  };
}

module.exports = { fetchWithRetry };
