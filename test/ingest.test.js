const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const { runIngestCycle } = require('../src/ingest');
const {
    SOURCE_KEY, SECONDARY_SOURCE_KEY,
    DATA_FILE, LOG_FILE, BREAKER_STATE_FILE
} = require('../src/config');

function resetState() {
    for (const f of [DATA_FILE, LOG_FILE, BREAKER_STATE_FILE]) {
        if (fs.existsSync(f)) fs.unlinkSync(f);
    }
}

test.beforeEach(resetState);
test.after(resetState);

function jsonResponse(status, obj) {
    return { status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(obj) };
}

function rssResponse(status, items) {
    const xml = `<?xml version="1.0"?><rss><channel>${items.map(i =>
        `<item><title>${i.title}</title><link>${i.link}</link><guid>${i.link}</guid><pubDate>${i.date}</pubDate></item>`
    ).join('')}</channel></rss>`;
    return { status, ok: status >= 200 && status < 300, text: async () => xml };
}

async function alwaysThrows() {
    throw new Error('simulated network failure');
}

test('when the primary source succeeds, it is used and the secondary is never called', async () => {
    const primaryFetch = async () => jsonResponse(200, [
        { id: '1', position: 'Engineer', company: 'Acme', url: 'https://x.com/1' }
    ]);
    let secondaryCalled = false;
    const secondaryFetch = async () => { secondaryCalled = true; return rssResponse(200, []); };

    const summary = await runIngestCycle({
        fetchImplBySourceKey: { [SOURCE_KEY]: primaryFetch, [SECONDARY_SOURCE_KEY]: secondaryFetch }
    });

    assert.equal(summary.activeSource, SOURCE_KEY);
    assert.equal(secondaryCalled, false);
});

test('when the primary source fails, the pipeline fails over to the secondary and succeeds from it', async () => {
    const secondaryFetch = async () => rssResponse(200, [
        { title: 'Acme: Backend Engineer', link: 'https://wwr.test/1', date: '2026-08-18' }
    ]);

    const summary = await runIngestCycle({
        fetchImplBySourceKey: { [SOURCE_KEY]: alwaysThrows, [SECONDARY_SOURCE_KEY]: secondaryFetch }
    });

    assert.equal(summary.activeSource, SECONDARY_SOURCE_KEY);
    assert.equal(summary.storedCount, 1);
    assert.equal(summary.sources[SOURCE_KEY].status, 'network_failure');
});

test('when both sources fail, the cycle reports all_sources_failed and falls back to cache', async () => {
    const summary = await runIngestCycle({
        fetchImplBySourceKey: { [SOURCE_KEY]: alwaysThrows, [SECONDARY_SOURCE_KEY]: alwaysThrows }
    });

    assert.equal(summary.status, 'all_sources_failed');
    assert.equal(summary.fallback, 'served_last_known_good');
});

test('a source with an open circuit breaker is skipped entirely, not retried', async () => {
    const breaker = require('../src/circuitBreaker');
    const { BREAKER_FAILURE_THRESHOLD } = require('../src/config');

    // Manually trip the primary's breaker as if prior cycles had failed.
    for (let i = 0; i < BREAKER_FAILURE_THRESHOLD; i += 1) {
        breaker.recordFailure(SOURCE_KEY);
    }

    let primaryCallCount = 0;
    const primaryFetch = async () => { primaryCallCount += 1; return jsonResponse(200, []); };
    const secondaryFetch = async () => rssResponse(200, [
        { title: 'Beta: Designer', link: 'https://wwr.test/2', date: '2026-08-18' }
    ]);

    const summary = await runIngestCycle({
        fetchImplBySourceKey: { [SOURCE_KEY]: primaryFetch, [SECONDARY_SOURCE_KEY]: secondaryFetch }
    });

    assert.equal(primaryCallCount, 0, 'primary should never be called while its breaker is open');
    assert.equal(summary.sources[SOURCE_KEY].skipped, true);
    assert.equal(summary.activeSource, SECONDARY_SOURCE_KEY);
});