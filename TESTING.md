# Testing Walkthrough

What each test suite actually checks, and how to verify the same behaviour against the
running server.

---

## Running the tests

```bash
npm test
```

The test script overrides the pacing/backoff constants to near-zero so the suite
finishes in a few seconds rather than sleeping through real retry delays:

```
cross-env MIN_DELAY_MS=5 MAX_JITTER_MS=5 BASE_BACKOFF_MS=10 node --test
```

All 21 tests should pass. No network access needed: every test injects a fake `fetch`
implementation and never makes a real HTTP request.

---

## Test suites

### 1. `test/fetchWithRetry.test.js`

Lowest-level suite. Tests `fetchWithRetry` in isolation by injecting a `mockFetch` that
returns a pre-programmed sequence of responses.

| Test | What it verifies |
|---|---|
| Succeeds on first try | A 200 response comes back immediately with `attempts: 1` |
| Retries past a transient error | A network throw followed by a 200 gives `attempts: 2` and `ok: true` |
| 403 is marked `blocked` | A 403 sets `result.blocked = true`, distinct from a generic failure |
| 429 is marked `blocked` | Same for rate-limit responses |
| 500 is NOT marked `blocked` | A 500 sets `result.ok = false` but `result.blocked = false`; server errors get normal backoff, not block backoff |
| Stops after MAX_RETRIES | Even with a permanent 403, the function gives up after `MAX_RETRIES` attempts |

The blocked/generic distinction matters because `ingest.js` uses `result.blocked` to
decide whether to log a cycle as `blocked` vs `network_failure`. Both trip the circuit
breaker, but they show up differently in the run log so you can tell at a glance whether
a source is down or actively refusing you.

---

### 2. `test/validate.test.js`

Tests `validateListing` (single record) and `validateBatch` (array of records). No
network, purely data-in data-out.

| Test | What it verifies |
|---|---|
| Accepts a well-formed record | A valid RemoteOK-style object passes, `result.ok = true`, fields mapped correctly |
| Quarantines missing fields | A record without `title`/`company`/`url` is rejected with `reason: 'missing_fields'` |
| Quarantines non-objects | A plain string gives `result.ok = false`, `reason: 'not_an_object'`, doesn't throw |
| Handles null/undefined | Neither `validateListing(null)` nor `validateListing(undefined)` throw |
| Filters RemoteOK's metadata object | RemoteOK prepends a metadata object with no `id`/`position`/`company`/`url` as its first array element. The batch validator quarantines it and keeps the real listings |
| Schema drift: every field renamed | Simulates the source changing all field names overnight. Every record gets quarantined, `valid.length === 0`. The pipeline does not crash and does not store an empty array over good data (that guarantee is covered in `ingest.test.js`) |
| Non-array input | `validateBatch(null)` returns `{ valid: [], quarantined: [] }`, doesn't throw |

---

### 3. `test/circuitBreaker.test.js`

Tests the breaker's state transitions. The breaker persists to a real file
(`data/breaker_state.json`), so each test wipes it before and after to prevent state
leaking between runs.

| Test | What it verifies |
|---|---|
| Stays closed below threshold | `BREAKER_FAILURE_THRESHOLD - 1` failures leave `status.open = false` |
| Trips open at threshold | Exactly `BREAKER_FAILURE_THRESHOLD` failures: `status.open = true`, `remainingMs > 0` |
| Success resets everything | After tripping, a single `recordSuccess` closes the breaker and zeroes `consecutiveFailures` |
| Per-source independence | Tripping `source-a`'s breaker leaves `source-b` closed; breakers don't share state |

One behaviour that's correct in the code but not yet covered by a formal test: a failed
half-open probe now resets `openedAt` to `Date.now()`, restarting the full cooldown from
that moment. Before the fix, `openedAt` was frozen at the original trip time, so a
failed probe didn't actually extend the cooldown at all.

---

### 4. `test/ingest.test.js`

Highest-level suite. `runIngestCycle` accepts an injectable `fetchImplBySourceKey` map,
so tests can wire up fake fetch functions per source without touching the network. State
files (`data/listings.json`, `data/run_log.json`, `data/breaker_state.json`) are wiped
before and after each test.

| Test | What it verifies |
|---|---|
| Primary succeeds, secondary never called | When the primary returns valid data, `secondaryCalled` stays `false` |
| Primary fails, failover to secondary | When the primary throws, the cycle uses the secondary source and reports `activeSource: 'weworkremotely'` |
| Both fail, cache fallback | When both sources throw, `summary.status = 'all_sources_failed'` and `summary.fallback = 'served_last_known_good'` |
| Open breaker, source skipped entirely | After manually tripping the primary's breaker, the primary fetch is never called (`primaryCallCount === 0`); the cycle goes straight to secondary |

---

## Verifying behaviour against the live server

Start the server:

```bash
npm start
```

### Current listings
```bash
curl http://localhost:3000/api/listings
```
Returns the last known-good snapshot: `{ listings: [...], count, lastSuccessAt, source }`.

### Trigger a cycle manually
```bash
curl -X POST http://localhost:3000/api/ingest/run
```
Returns a summary: which source was used, how many listings stored, what status each
source got (`success`, `network_failure`, `blocked`, `schema_drift_suspected`, `skipped`).

### Run history
```bash
curl http://localhost:3000/api/runs
```
Last 50 cycle summaries, most recent first. This is what the dashboard run log is built
from.

### Liveness
```bash
curl http://localhost:3000/api/health
```
Returns `{ ok: true, uptime: <seconds> }`.

### Dashboard
Open `http://localhost:3000`. Shows the listings table and run log with per-source
status badges, a visual version of what `/api/listings` and `/api/runs` return.

---

## Status values in the run log

| Status | Meaning |
|---|---|
| `success` | Source returned valid data, listings stored |
| `partial_success` | Some records quarantined but valid ones stored |
| `network_failure` | Source threw a network error after all retries |
| `blocked` | Source returned 403 or 429 |
| `empty_response` | Source returned 200 but the body was empty or unparseable |
| `schema_drift_suspected` | Every record failed validation, likely the schema changed |
| `skipped` | Circuit breaker was open; source was not contacted |
| `all_sources_failed` | Both sources failed; last known-good data was served |

---

## Circuit breaker state file

`data/breaker_state.json` is written after every failure and success:

```json
{
  "remoteok": {
    "consecutiveFailures": 3,
    "openedAt": 1724067600000
  },
  "weworkremotely": {
    "consecutiveFailures": 0,
    "openedAt": null
  }
}
```

`consecutiveFailures` resets to 0 on any successful cycle for that source.

`openedAt` is the timestamp of when the breaker last tripped (or last failed half-open
probe). `null` means the breaker is closed. Once `Date.now() - openedAt` exceeds
`BREAKER_COOLDOWN_MS` (10 minutes by default), the breaker goes half-open and allows
one probe through. If the probe fails, `openedAt` is reset to `Date.now()`, restarting
the cooldown.
