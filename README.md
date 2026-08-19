# Job Ingest Demo — Part 1 Submission

Resilient job listing ingestion, built for the Acdyon Frontend Challenge Part 1.

**Live demo:** *(deploy URL — add after Render deployment)*
**Repo:** https://github.com/shruti-ghoshhhh/job-ingest-demo

---

## What this is

A deployed service that pulls job listings from a public source on a schedule, with the
full ingestion pattern in place: pacing, identity rotation, retry/backoff, a per-source
circuit breaker, schema validation with quarantine, and fail-soft fallback to last
known-good data if both sources are unavailable. A dashboard at `/` makes the resilience
behavior visible — you can watch which cycles succeeded, which were blocked, and what
fallback fired, without grepping server logs.

The source is **RemoteOK's public `/api` endpoint** (primary) with automatic failover to
**WeWorkRemotely's public RSS feed** (secondary) — both unauthenticated, both intended to
be machine-read, in line with the brief's scope guardrail. The engineering underneath is
built as if the source *were* adversarial, because that's the pattern the task is actually
testing. See `DESIGN.md` for the full rationale.

---

## How the four deliverable areas are addressed

### 1. Detection surface
What gives an automated client away, roughly in order of how cheaply a platform can
check it: missing or generic headers (`node-fetch` as a bare UA), fixed-interval request
timing, headless browser fingerprints (`navigator.webdriver`, missing plugins/mimeTypes),
behavioral patterns (no scroll variance, sequential pagination), and volume/velocity per
identity. `identity.js` covers header hygiene and UA rotation; `identity.jitterDelay`
adds non-uniform timing. Headless-browser fingerprint spoofing and behavioral simulation
are scoped out — they only matter against JS-rendered, login-walled targets and aren't
applicable to a public JSON API. See `DESIGN.md §1`.

### 2. Ingestion strategy
Requests rotate through a User-Agent pool (`identity.js`). Every request is preceded by
a randomized delay (not a fixed poll interval) to avoid the cron-job timing tell.
`fetchWithRetry.js` distinguishes block signals (403/429) from transient failures
(timeouts, 5xx) and backs off harder on block signals. When the primary source trips the
circuit breaker, the pipeline automatically fails over to the secondary (RSS) source
before falling back to cached data. In production this pairs with rotating egress IPs and
per-identity cookie jars — see `DECISIONS.md §2` for why that infra piece is scoped out
here and what I'd add with a real week.

### 3. Resilience

| Failure mode | What happens |
|---|---|
| Network error / timeout | Retried with exponential backoff, up to `MAX_RETRIES` |
| 403 / 429 (blocked) | Harder backoff, logged as `blocked`, trips toward circuit breaker |
| Empty or unparseable body | Logged as `empty_response` / `parse_failure`, last known-good data kept |
| Schema changed overnight | Per-record validation (`validate.js`) quarantines bad records; if *every* record fails, flagged as `schema_drift_suspected` instead of silently storing garbage |
| Partial bad data mixed with good | Valid records stored, invalid ones quarantined — partial success is still success |
| Source dead for multiple cycles | Circuit breaker trips open, stops hammering the source for `BREAKER_COOLDOWN_MS`, then probes with a half-open attempt; a failed probe re-arms the full cooldown |

### 4. Where I'd stop
Every platform named in the brief has ToS language against scraping, and several require
authentication. I won't scrape behind a login wall or authenticated session on a real
account — that's where "getting data out" becomes "using someone's account against the
platform's terms," and that risk isn't mine to take on in a take-home exercise. The demo
proves the *pattern* works end-to-end against a safe target; pointing it at a riskier
source is a policy decision, not an engineering one. See `DESIGN.md §4`.

---

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`. The server runs one ingestion cycle on boot, then on a
10-minute cron schedule. To trigger a run manually:

```bash
curl -X POST http://localhost:3000/api/ingest/run
```

To run a single cycle from the CLI without starting the server:

```bash
npm run ingest:once
```

## Tests

```bash
npm test
```

21 tests, ~5 seconds (pacing/backoff delays overridden to near-zero via env vars in the
test script). Covers: retry/backoff timing, 403/429 vs. generic-error handling, schema
validation and quarantine (including simulated overnight schema drift), circuit breaker
trip/half-open/reset/per-source independence, and full integration tests of the failover
chain (primary fails → secondary; both fail → cached fallback; breaker-open → source
skipped without being called).

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Dashboard — listings + run log |
| `GET` | `/api/listings` | Current listings snapshot (JSON) |
| `GET` | `/api/runs` | Ingestion run history, most recent first |
| `POST` | `/api/ingest/run` | Trigger an ingestion cycle immediately |
| `GET` | `/api/health` | Liveness check |

## Project structure

```
server.js               Express server, cron schedule, API endpoints
src/config.js           Source URLs, pacing/retry/backoff/breaker constants
src/identity.js         User-Agent rotation + jitter delay
src/fetchWithRetry.js   Retry/backoff, block-signal (403/429) handling
src/sources.js          Parses primary (JSON) and secondary (RSS) source formats
src/validate.js         Per-record schema validation + quarantine
src/circuitBreaker.js   Per-source circuit breaker, persisted to disk
src/storage.js          JSON-file persistence + run log, last-known-good fallback
src/ingest.js           Orchestrates one cycle: breaker check → primary → secondary → cache fallback
src/runOnce.js          CLI entrypoint for a single manual run
public/index.html       Dashboard UI
test/                   Automated tests
DESIGN.md               Full design rationale (detection surface, ingestion strategy, resilience, scope)
DECISIONS.md            Trade-offs, what I scoped out and why, where I used AI tools
```

## Deploy (Render)

1. Push repo to GitHub.
2. On Render: **New → Web Service**, connect the repo.
3. Render picks up `render.yaml` automatically (build: `npm install`, start: `npm start`).
4. Deploy — first boot triggers an ingestion cycle automatically.

> **Note on ephemeral storage:** Render's free tier has an ephemeral filesystem. The
> circuit breaker state, run log, and listings cache are written to `data/` and survive
> across requests but reset on each redeploy or restart. For a persistent demo, a Render
> Disk or external datastore would be the next step.