module.exports = {
  // The single low-risk, public source this demo pulls from.
  // RemoteOK's /api endpoint is a public, unauthenticated JSON feed of
  // remote job listings, intended to be machine-read. No login, no ToS
  // violation, no account to burn — chosen specifically per the challenge's
  // scope guardrail.
  SOURCE_URL: 'https://remoteok.com/api',

  // Pacing: even against a friendly source, the demo behaves as if it were
  // adversarial, since the point is to prove the ingestion *pattern* works.
  MIN_DELAY_MS: 800,
  MAX_JITTER_MS: 1200,

  // Retry/backoff
  MAX_RETRIES: 4,
  BASE_BACKOFF_MS: 1000,

  // Rotating identities (User-Agent pool). In production this would pair
  // with rotating egress IPs / proxy pool + separate cookie jars per
  // identity; here we rotate the client-visible fingerprint we control.
  USER_AGENTS: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0'
  ],

  // Schedule: how often the scheduled ingestion run fires.
  CRON_SCHEDULE: '*/10 * * * *', // every 10 minutes

  DATA_FILE: require('path').join(__dirname, '..', 'data', 'listings.json'),
  LOG_FILE: require('path').join(__dirname, '..', 'data', 'run_log.json')
};