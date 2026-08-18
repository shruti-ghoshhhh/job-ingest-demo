const { USER_AGENTS, MIN_DELAY_MS, MAX_JITTER_MS } = require('./config');

let cursor = 0;

/**
 * Rotates through a small pool of User-Agents rather than reusing one
 * fixed string for every request. This is the client-fingerprint half of
 * identity rotation; the other half (rotating egress IP / proxy pool) is
 * infra-level and documented in DESIGN.md rather than faked here.
 */
function nextIdentity() {
  const ua = USER_AGENTS[cursor % USER_AGENTS.length];
  cursor += 1;
  return {
    headers: {
      'User-Agent': ua,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  };
}

/** Random delay so requests don't fire at suspiciously uniform intervals. */
function jitterDelay() {
  const delay = MIN_DELAY_MS + Math.floor(Math.random() * MAX_JITTER_MS);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

module.exports = { nextIdentity, jitterDelay };
