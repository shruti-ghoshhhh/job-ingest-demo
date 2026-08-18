const fs = require('fs');
const path = require('path');
const { DATA_FILE, LOG_FILE } = require('./config');

function ensureDataDir() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Reads the last known-good listings snapshot. If a run fails entirely
 * (source down, blocked, empty response), the API keeps serving this
 * instead of an empty/broken payload — "fail soft," not silent failure.
 */
function readListings() {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) return { listings: [], lastSuccessAt: null, source: null };
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    // Corrupted file shouldn't crash the server either.
    return { listings: [], lastSuccessAt: null, source: null };
  }
}

function writeListings(listings, sourceUrl) {
  ensureDataDir();
  const payload = {
    listings,
    count: listings.length,
    lastSuccessAt: new Date().toISOString(),
    source: sourceUrl
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2));
  return payload;
}

function appendRunLog(entry) {
  ensureDataDir();
  let log = [];
  if (fs.existsSync(LOG_FILE)) {
    try {
      log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
    } catch {
      log = [];
    }
  }
  log.unshift({ ...entry, at: new Date().toISOString() });
  log = log.slice(0, 50); // keep last 50 runs
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

function readRunLog() {
  ensureDataDir();
  if (!fs.existsSync(LOG_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

module.exports = { readListings, writeListings, appendRunLog, readRunLog };
