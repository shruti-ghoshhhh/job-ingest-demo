const fs = require('fs');
const path = require('path');
const { BREAKER_FAILURE_THRESHOLD, BREAKER_COOLDOWN_MS, BREAKER_STATE_FILE } = require('./config');

/**
 * A minimal circuit breaker, keyed per source, persisted to disk.
 *
 * Why this exists: retry/backoff alone handles a *single* run failing.
 * It doesn't prevent the pipeline from hammering a source that has clearly
 * gone dark — on the next scheduled cycle, a plain retry loop tries again
 * from zero, every time. A breaker adds memory *across* runs: after
 * BREAKER_FAILURE_THRESHOLD consecutive failed cycles on a source, it
 * trips "open" and short-circuits further attempts on that source for
 * BREAKER_COOLDOWN_MS, instead of retrying every cycle. This is the piece
 * that actually changes ingestion behavior when a source "gets shut down
 * for a week" rather than just failing once.
 *
 * State is persisted to disk (not just in-memory) so the breaker's memory
 * survives a process restart — otherwise a crash-loop would reset the
 * failure count to zero each time and never actually trip.
 */

function ensureDir() {
    const dir = path.dirname(BREAKER_STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readState() {
    ensureDir();
    if (!fs.existsSync(BREAKER_STATE_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(BREAKER_STATE_FILE, 'utf-8'));
    } catch {
        return {};
    }
}

function writeState(state) {
    ensureDir();
    fs.writeFileSync(BREAKER_STATE_FILE, JSON.stringify(state, null, 2));
}

/** Returns { open: boolean, remainingMs: number, consecutiveFailures: number } for a source key. */
function getStatus(sourceKey, state = readState()) {
    const entry = state[sourceKey] || { consecutiveFailures: 0, openedAt: null };

    if (!entry.openedAt) {
        return { open: false, remainingMs: 0, consecutiveFailures: entry.consecutiveFailures };
    }

    const elapsed = Date.now() - entry.openedAt;
    if (elapsed >= BREAKER_COOLDOWN_MS) {
        // Cooldown has elapsed — breaker moves to "half-open": the next call
        // is allowed through as a probe. We don't reset consecutiveFailures
        // here; that only happens on an actual recorded success.
        return { open: false, remainingMs: 0, consecutiveFailures: entry.consecutiveFailures, halfOpen: true };
    }

    return {
        open: true,
        remainingMs: BREAKER_COOLDOWN_MS - elapsed,
        consecutiveFailures: entry.consecutiveFailures
    };
}

function recordFailure(sourceKey) {
    const state = readState();
    const entry = state[sourceKey] || { consecutiveFailures: 0, openedAt: null };
    entry.consecutiveFailures += 1;

    if (entry.consecutiveFailures >= BREAKER_FAILURE_THRESHOLD) {
        // Always re-arm the timer: if the breaker was half-open and the probe
        // fails, this resets openedAt to now so the full cooldown runs again
        // from this failure — not from the original trip time.
        entry.openedAt = Date.now();
    }

    state[sourceKey] = entry;
    writeState(state);
    return getStatus(sourceKey, state);
}

function recordSuccess(sourceKey) {
    const state = readState();
    state[sourceKey] = { consecutiveFailures: 0, openedAt: null };
    writeState(state);
    return getStatus(sourceKey, state);
}

module.exports = { getStatus, recordFailure, recordSuccess };
