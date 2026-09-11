// Per-student icon search history, so the "your parents and coaches can see
// what you search" warning is literally true, not a bluff. See the header
// comment in lib/icon-blocklist.js for why this file lives outside api/.
//
// Read-modify-write on a single Redis key per student, same key style as
// api/storage.js's moduser:<username> moderation record. This module never
// opens its own Redis connection — callers (api/noun-project-search.js)
// already have a client and pass it in.

const HISTORY_KEY_PREFIX = 'iconsearch:';
// Trimmed separately, not as one combined cap: a blocked search needs to stay
// visible to a coach weeks later even if the student did 100 ordinary
// searches since — trimming the oldest of everything indiscriminately would
// let routine volume silently age a flagged search out of the record.
// MAX_ALLOWED_ENTRIES bounds routine search noise; MAX_BLOCKED_ENTRIES is
// only a defensive ceiling against pathological growth, not a normal-use cap.
const MAX_ALLOWED_ENTRIES = 100;
const MAX_BLOCKED_ENTRIES = 500;

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

    // Trim each kind against its own cap, then merge back in chronological
    // order — this is what keeps an old blocked entry from being pushed out
    // just because a lot of ordinary searching happened afterward.
    let blocked = record.entries.filter((e) => e.blocked);
    let allowed = record.entries.filter((e) => !e.blocked);
    if (blocked.length > MAX_BLOCKED_ENTRIES) blocked = blocked.slice(-MAX_BLOCKED_ENTRIES);
    if (allowed.length > MAX_ALLOWED_ENTRIES) allowed = allowed.slice(-MAX_ALLOWED_ENTRIES);
    record.entries = blocked.concat(allowed).sort((a, b) => a.at - b.at);
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
  MAX_ALLOWED_ENTRIES,
  MAX_BLOCKED_ENTRIES,
};
