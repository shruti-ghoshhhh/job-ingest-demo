const test = require('node:test');
const assert = require('node:assert/strict');
const { validateListing, validateBatch } = require('../src/validate');

test('validateListing accepts a well-formed RemoteOK-style record', () => {
    const result = validateListing({
        id: '123',
        position: 'Backend Engineer',
        company: 'Acme',
        url: 'https://remoteok.com/remote-jobs/123',
        tags: ['node', 'remote'],
        date: '2026-08-18'
    });
    assert.equal(result.ok, true);
    assert.equal(result.listing.title, 'Backend Engineer');
    assert.equal(result.listing.company, 'Acme');
});

test('validateListing quarantines a record missing required fields', () => {
    const result = validateListing({ id: '123', tags: ['node'] }); // no title/company/url
    assert.equal(result.ok, false);
    assert.match(result.reason, /missing_fields/);
});

test('validateListing quarantines a non-object entry instead of throwing', () => {
    const result = validateListing('this is not an object');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'not_an_object');
});

test('validateListing quarantines null/undefined without throwing', () => {
    assert.doesNotThrow(() => validateListing(null));
    assert.doesNotThrow(() => validateListing(undefined));
});

test('validateBatch quarantines RemoteOK\'s leading metadata object but keeps valid listings', () => {
    const raw = [
        { legal: 'https://remoteok.com/legal', ...{} }, // RemoteOK's real first element has no id/position/company/url
        { id: '1', position: 'Frontend Engineer', company: 'Acme', url: 'https://x.com/1' },
        { id: '2', position: 'Designer', company: 'Beta', url: 'https://x.com/2' }
    ];
    const { valid, quarantined } = validateBatch(raw);
    assert.equal(valid.length, 2);
    assert.equal(quarantined.length, 1);
});

test('validateBatch simulates overnight schema drift: every field renamed -> everything quarantined, nothing crashes', () => {
    // Simulates the source changing its markup/field names overnight.
    const driftedRaw = [
        { job_id: '1', job_title: 'Engineer', employer: 'Acme', link: 'https://x.com/1' },
        { job_id: '2', job_title: 'Designer', employer: 'Beta', link: 'https://x.com/2' }
    ];
    const { valid, quarantined } = validateBatch(driftedRaw);
    assert.equal(valid.length, 0);
    assert.equal(quarantined.length, 2);
    // The caller (ingest.js) is responsible for treating valid.length === 0
    // as schema_drift_suspected and preserving the last known-good data
    // rather than overwriting it with nothing — covered in ingest.test.js.
});

test('validateBatch handles a non-array input without throwing', () => {
    const { valid, quarantined } = validateBatch(null);
    assert.equal(valid.length, 0);
    assert.equal(quarantined.length, 0);
});