# Job Ingest Demo

Resilient job listing ingestion demo — Acdyon Technologies Frontend
Challenge, Part 1.

Pulls listings from RemoteOK's public `/api` endpoint on a schedule (and on
demand), with pacing, identity rotation, retry/backoff, schema validation,
and fail-soft fallback to the last known-good data. See `DESIGN.md` for the
full design rationale and `DECISIONS.md` for trade-offs.

## Run locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`. The server runs one ingestion cycle on
boot and then on a cron schedule (every 30 min by default, see
`src/config.js`). You can also trigger a run manually from the dashboard
("Run ingestion now") or via:

```bash
curl -X POST http://localhost:3000/api/ingest/run
```

To run a single ingestion cycle from the CLI without starting the server:

```bash
npm run ingest:once
```

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
server.js            Express server, cron schedule, API endpoints
src/config.js         Source URL, pacing/retry/backoff constants
src/identity.js        User-Agent rotation + jitter delay
src/fetchWithRetry.js  Retry/backoff, block-signal (403/429) handling
src/validate.js         Per-record schema validation + quarantine
src/storage.js          JSON-file persistence + run log, last-known-good fallback
src/ingest.js            Orchestrates one full ingestion cycle
src/runOnce.js            CLI entrypoint for a single manual run
public/index.html         Dashboard UI
```

## A note on the network sandbox this was built in

This was scaffolded and tested in a sandboxed dev environment with a fixed
outbound-domain allowlist that does **not** include `remoteok.com` — so the
live fetch itself couldn't be exercised there (confirmed via
`x-deny-reason: host_not_allowed`, not a real block from the source). The
server, API, storage, and fallback logic were fully tested end-to-end in
that environment; the live fetch path should be verified once more with open
internet access (locally, or after deploying to Render) before submission.
