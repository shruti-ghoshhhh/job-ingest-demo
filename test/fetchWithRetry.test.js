const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchWithRetry } = require('../src/fetchWithRetry');

function mockFetch(sequence) {
    // sequence: array of responses to return in order, one per call.
    // Each entry is either a fake Response-like object, or a fn that throws
    // (to simulate a network error).
    let call = 0;
    return async () => {
        const entry = sequence[Math.min(call, sequence.length - 1)];
        call += 1;
        if (typeof entry === 'function') return entry();
        return entry;
    };
}

function fakeResponse(status, bodyText) {
    return {
        status,
        ok: status >= 200 && status < 300,
        text: async () => bodyText
    };
}

test('succeeds immediately on first try when the source responds 200', async () => {
    const fetchImpl = mockFetch([fakeResponse(200, '{"ok":true}')]);
    const result = await fetchWithRetry('https://example.test', { fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.attempts, 1);
    assert.equal(result.body, '{"ok":true}');
});

test('retries past a transient network error and eventually succeeds', async () => {
    const fetchImpl = mockFetch([
        () => { throw new Error('ECONNRESET'); },
        fakeResponse(200, '{"ok":true}')
    ]);
    const result = await fetchWithRetry('https://example.test', { fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.attempts, 2);
});

test('identifies a 403 as "blocked" distinctly from a generic failure', async () => {
    const fetchImpl = mockFetch([fakeResponse(403, 'forbidden')]);
    const result = await fetchWithRetry('https://example.test', { fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.equal(result.status, 403);
});

test('identifies a 429 as "blocked" distinctly from a generic failure', async () => {
    const fetchImpl = mockFetch([fakeResponse(429, 'rate limited')]);
    const result = await fetchWithRetry('https://example.test', { fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
});

test('a generic 500 is not marked as "blocked"', async () => {
    const fetchImpl = mockFetch([
        fakeResponse(500, 'error'),
        fakeResponse(500, 'error'),
        fakeResponse(500, 'error'),
        fakeResponse(500, 'error')
    ]);
    const result = await fetchWithRetry('https://example.test', { fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.blocked, false);
    assert.equal(result.status, 500);
});

test('gives up after MAX_RETRIES consecutive failures rather than retrying forever', async () => {
    const fetchImpl = mockFetch([fakeResponse(403, 'forbidden')]); // every call returns 403
    const result = await fetchWithRetry('https://example.test', { fetchImpl });
    assert.equal(result.ok, false);
    const { MAX_RETRIES } = require('../src/config');
    assert.equal(result.attempts, MAX_RETRIES);
});