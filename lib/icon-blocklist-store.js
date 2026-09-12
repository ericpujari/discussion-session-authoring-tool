// Runtime-editable extension to the static blocklist in lib/icon-blocklist.js
// — lets a coach block a specific word straight from the "Icon search
// activity" panel without a code change/redeploy. Kept as its own file for
// the same reason lib/icon-search-history.js is separate from
// lib/icon-blocklist.js: this one does Redis I/O, that one is pure text
// matching.
//
// A single shared record (not per-student — the blocklist applies to every
// student), read fresh on every search request in api/noun-project-search.js
// so a newly-blocked word takes effect immediately, no redeploy needed.

const CUSTOM_BLOCKLIST_KEY = 'iconblocklist:custom';
// Defensive ceiling against runaway growth, not a normal-use limit — a coach
// adding hundreds of one-off words would be unusual; this just stops the
// record from growing without bound.
const MAX_CUSTOM_TERMS = 500;

async function loadCustomBlockedTerms(redis) {
  if (!redis) return []; // fail open to the static list only, never throw
  try {
    const raw = await redis.get(CUSTOM_BLOCKLIST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.terms)) return [];
    return parsed.terms.map((t) => t.term).filter(Boolean);
  } catch (e) {
    console.error('custom blocklist read failed', e);
    return [];
  }
}

// Read-modify-write, same accepted race-window tradeoff as
// lib/icon-search-history.js's recordSearchAttempt — low-stakes (a coach
// adding a word), not correctness-critical, and coaches aren't clicking
// "block" on the same word from two tabs at once in practice.
async function addCustomBlockedTerm(redis, term) {
  const cleaned = String(term || '').trim().toLowerCase();
  if (!redis || !cleaned) return { ok: false, error: 'No word to block.' };
  try {
    const raw = await redis.get(CUSTOM_BLOCKLIST_KEY);
    let record;
    try {
      record = raw ? JSON.parse(raw) : null;
    } catch (e) {
      record = null;
    }
    if (!record || !Array.isArray(record.terms)) record = { terms: [] };

    const already = record.terms.some((t) => t.term === cleaned);
    if (!already) {
      record.terms.push({ term: cleaned, addedAt: Date.now() });
      if (record.terms.length > MAX_CUSTOM_TERMS) {
        record.terms = record.terms.slice(-MAX_CUSTOM_TERMS);
      }
    }
    record.updatedAt = Date.now();
    await redis.set(CUSTOM_BLOCKLIST_KEY, JSON.stringify(record));
    return { ok: true, terms: record.terms.map((t) => t.term) };
  } catch (e) {
    console.error('custom blocklist write failed', e);
    return { ok: false, error: 'Could not save that word right now.' };
  }
}

module.exports = {
  CUSTOM_BLOCKLIST_KEY,
  loadCustomBlockedTerms,
  addCustomBlockedTerm,
};
