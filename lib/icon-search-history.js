// Per-student icon search history, so the "your parents and coaches can see
// what you search" warning is literally true, not a bluff. See the header
// comment in lib/icon-blocklist.js for why this file lives outside api/.
//
// Read-modify-write on a single Redis key per student, same key style as
// api/storage.js's moduser:<username> moderation record. This module never
// opens its own Redis connection — callers (api/noun-project-search.js)
// already have a client and pass it in.

const HISTORY_KEY_PREFIX = 'iconsearch:';
const MAX_HISTORY_ENTRIES = 100;

function normalizeUsername(u) {
  return String(u || '').trim().toLowerCase();
}

function historyKey(username) {
  return HISTORY_KEY_PREFIX + normalizeUsername(username);
}

// Known, accepted tradeoff: this is a read-modify-write, so truly concurrent
// requests for the same username have a small race window where one write
// could clobber another. Acceptable because this is a supervision log, not
// correctness-critical data — a single student's browser fires these
// serially in practice — and it matches this feature's existing "fail open,
// low-stakes" philosophy (see api/noun-project-search.js's header comment).
async function recordSearchAttempt(redis, username, entry) {
  const u = normalizeUsername(username);
  if (!redis || !u) return; // no username or no Redis: skip silently, never block search

  const key = historyKey(u);
  try {
    const raw = await redis.get(key);
    let record;
    try {
      record = raw ? JSON.parse(raw) : null;
    } catch (e) {
      record = null;
    }
    if (!record || !Array.isArray(record.entries)) {
      record = { username: u, entries: [] };
    }

    record.entries.push({
      term: entry.term,
      blocked: !!entry.blocked,
      at: Date.now(),
      mode: entry.mode || null,
      scenarioIndex: Number.isInteger(entry.scenarioIndex) ? entry.scenarioIndex : null,
      optionIndex: Number.isInteger(entry.optionIndex) ? entry.optionIndex : null,
    });
    if (record.entries.length > MAX_HISTORY_ENTRIES) {
      record.entries = record.entries.slice(-MAX_HISTORY_ENTRIES);
    }
    record.updatedAt = Date.now();

    await redis.set(key, JSON.stringify(record));
  } catch (e) {
    console.error('icon search history write failed', e);
    // best-effort only — never throw back into the search request
  }
}

module.exports = {
  recordSearchAttempt,
  historyKey,
  normalizeUsername,
  MAX_HISTORY_ENTRIES,
};
