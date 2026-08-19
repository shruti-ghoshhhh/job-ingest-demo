# Job Ingest Demo

Resilient job listing ingestion demo — Acdyon Technologies Frontend
Challenge, Part 1.

Pulls listings from RemoteOK's public `/api` endpoint (primary) with
automatic failover to WeWorkRemotely's public RSS feed (secondary) on a
schedule (and on demand), with pacing, identity rotation, retry/backoff, a
per-source circuit breaker, schema validation, and fail-soft fallback to
the last known-good data if both sources are unavailable. See `DESIGN.md`
for the full design rationale (including a flow diagram) and
`DECISIONS.md` for trade-offs.

## Run locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`. The server runs one ingestion cycle on
boot and then on a cron schedule (every 10 min by default, see
`src/config.js`). You can also trigger a run manually from the dashboard
("Run ingestion now") or via:

```bash
curl -X POST http://localhost:3000/api/ingest/run
```

To run a single ingestion cycle from the CLI without starting the server:

```bash
npm run ingest:once
```

## Tests

```bash
npm test
```

21 tests, runs in ~5 seconds (pacing/backoff delays are overridden to near-zero
via env vars in the test script — see `src/config.js`). Covers retry/backoff
behavior, 403/429 vs. generic-error handling, schema validation and
quarantine (including a simulated overnight schema drift), circuit breaker
trip/reset/per-source independence, and full integration tests of the
failover chain (primary fails → secondary takes over; both fail → cached
fallback; breaker-open → source skipped without being called).

## Endpoints

- `GET /` — dashboard (listings + run log)
- `GET /api/listings` — current listings snapshot (JSON)
- `GET /api/runs` — ingestion run history, most recent first
- `POST /api/ingest/run` — trigger an ingestion cycle immediately
- `GET /api/health` — liveness check

## Deploy (Render)

1. Push this repo to GitHub.
2. On Render: **New → Web Service**, connect the repo.
3. Render should pick up `render.yaml` automatically (build:
   `npm install`, start: `npm start`). If not, set those manually.
4. Deploy. First boot triggers an ingestion cycle automatically.

## Project structure

```
server.js               Express server, cron schedule, API endpoints
src/config.js            Source URLs, pacing/retry/backoff/breaker constants
src/identity.js          User-Agent rotation + jitter delay
src/fetchWithRetry.js    Retry/backoff, block-signal (403/429) handling (injectable fetch)
src/sources.js           Parses primary (JSON) and secondary (RSS) source formats
src/validate.js          Per-record schema validation + quarantine
src/circuitBreaker.js    Per-source circuit breaker, persisted to disk
src/storage.js           JSON-file persistence + run log, last-known-good fallback
src/ingest.js            Orchestrates one cycle: breaker check → primary → secondary → cache fallback
src/runOnce.js           CLI entrypoint for a single manual run
public/index.html        Dashboard UI (listings + run log with per-source status)
test/                    Automated tests (see "Tests" above)
```

## A note on the network sandbox this was built in

This was scaffolded and tested in a sandboxed dev environment with a fixed
outbound-domain allowlist that does **not** include `remoteok.com` — so the
live fetch itself couldn't be exercised there (confirmed via
`x-deny-reason: host_not_allowed`, not a real block from the source). The
server, API, storage, and fallback logic were fully tested end-to-end in
that environment; the live fetch path should be verified once more with open
internet access (locally, or after deploying to Render) before submission.