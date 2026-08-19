const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const breaker = require('../src/circuitBreaker');
const { BREAKER_FAILURE_THRESHOLD, BREAKER_STATE_FILE } = require('../src/config');

// The breaker persists state to a real file under data/ so it survives
// process restarts. Reset it before/after each test so tests don't leak
// state into each other or into a real demo run.
test.beforeEach(() => {
    if (fs.existsSync(BREAKER_STATE_FILE)) fs.unlinkSync(BREAKER_STATE_FILE);
});

test.after(() => {
    if (fs.existsSync(BREAKER_STATE_FILE)) fs.unlinkSync(BREAKER_STATE_FILE);
});

test('breaker stays closed below the failure threshold', () => {
    for (let i = 0; i < BREAKER_FAILURE_THRESHOLD - 1; i += 1) {
        breaker.recordFailure('test-source');
    }
    const status = breaker.getStatus('test-source');
    assert.equal(status.open, false);
});

test('breaker trips open once consecutive failures reach the threshold', () => {
    for (let i = 0; i < BREAKER_FAILURE_THRESHOLD; i += 1) {
        breaker.recordFailure('test-source');
    }
    const status = breaker.getStatus('test-source');
    assert.equal(status.open, true);
    assert.ok(status.remainingMs > 0);
});

test('a success resets the failure count and closes the breaker', () => {
    for (let i = 0; i < BREAKER_FAILURE_THRESHOLD; i += 1) {
        breaker.recordFailure('test-source');
    }
    assert.equal(breaker.getStatus('test-source').open, true);

    breaker.recordSuccess('test-source');
    const status = breaker.getStatus('test-source');
    assert.equal(status.open, false);
    assert.equal(status.consecutiveFailures, 0);
});

test('breakers are tracked independently per source key', () => {
    for (let i = 0; i < BREAKER_FAILURE_THRESHOLD; i += 1) {
        breaker.recordFailure('source-a');
    }
    assert.equal(breaker.getStatus('source-a').open, true);
    assert.equal(breaker.getStatus('source-b').open, false);
});