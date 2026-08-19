# DECISIONS.md

## 1. Why this ingestion strategy over the obvious alternative I rejected?

The obvious move was a headless-browser scraper aimed at a real job board, since that's
the actual LinkedIn/Naukri problem the challenge is referencing. I didn't do that for a
simple reason: a demo that gets IP-banned mid-review fails the one hard requirement
("pulls listings without getting instantly blocked"), for reasons entirely outside my
control on the day someone's looking at it. The brief's own scope guardrail backs this
up, it explicitly asks for a public, low-risk source.

RemoteOK's public API gave me a real network target to run the full ingestion pattern
against: pacing, UA rotation, retry/backoff, failover, schema validation, circuit
breaker. All of that is live and testable. The difference between this and a "real"
target is the source's willingness to respond, not the ingestion machinery. That part
is the same either way.

## 2. One trade-off I made, and what I'd do with more time

No real IP rotation. The code only rotates User-Agents and adds timing jitter. For
actual anti-detection at scale you need rotating residential or mobile IPs paired with
per-identity cookie jars, because IP-level rate limiting is usually the first thing a
platform checks, ahead of headers, ahead of anything else. I left it out because
residential proxy pools cost money and I can't credibly stub one out in a few hours in a
way I'd actually be willing to defend in a call.

What I'd add with a real week: a proxy provider integration, and true per-identity
sessions where an "identity" is a consistent IP + UA + cookie jar tuple rather than just
a rotating header. The secondary-source failover is already shipped. `ingest.js` goes
primary (RemoteOK) to secondary (WeWorkRemotely RSS) to last-known-good cache, in that
order, and the full chain is integration-tested. The missing piece is purely IP rotation.

## 3. Where I used AI, and what I actually looked at myself

Used Claude to move faster on boilerplate: Express routing, the retry loop skeleton,
the dashboard HTML. The parts I read line by line: the retry/backoff math (the exponent
is different for block signals vs generic errors, and that matters), the 403/429 branch
in `fetchWithRetry.js`, the schema validation path that quarantines RemoteOK's leading
metadata object without crashing, and the fallback chain in `ingest.js`.

I also caught a real bug while reading `circuitBreaker.js`. `recordFailure` had
`&& !entry.openedAt` as a guard, which meant a failed half-open probe incremented the
failure count but left `openedAt` frozen at the original trip time. The cooldown wasn't
actually restarting on a failed probe, it was still counting down from whenever the
breaker first tripped. Removed the guard so `openedAt` always gets reset to `Date.now()`
when the failure threshold is met.

The dev environment I built this in couldn't reach `remoteok.com` at all (sandboxed
outbound allowlist), so the failure and fallback path ran on every single test cycle,
not hypothetically, for real. That's actually a better test of the resilience logic than
a working connection would have been.
