// Shared content-safety module for the Noun Project icon search feature.
//
// Lives outside api/ on purpose. Vercel's zero-config builder only turns files
// directly under api/ into routes, so a shared module here can never
// accidentally become a stray public endpoint — and @vercel/node bundles any
// local require() automatically, no extra config needed. This is a deliberate,
// narrow exception to the "self-contained serverless functions, no imports
// between them" convention noted in api/noun-project-search.js: that
// convention is about one *endpoint* not depending on another, not about
// sharing plain data/logic modules like this one.
//
// Required for the tool to go out to more students safely: blocks obviously
// inappropriate search terms before they ever reach Noun Project, and
// best-effort filters individual results that carry inappropriate tags.

const BLOCKLIST_WARNING = 'Your parents and coaches can see what you search.';

// Adapted from the widely-used "LDNOOBW" (List of Dirty, Naughty, Obscene, and
// Otherwise Bad Words) open-source list, pruned/adjusted for an 8-14 audience
// and a global user base. Grouped by category so it's easy to extend later —
// add new terms as coaches spot gaps, lowercase, no punctuation.
const BLOCKED_TERMS = [
  // -- sexual content --
  'sex', 'porn', 'nude', 'naked', 'penis', 'vagina', 'boob', 'boobs', 'breast',
  'breasts', 'condom', 'orgasm', 'masturbate', 'masturbation', 'erotic',
  'fetish', 'anal', 'oral sex', 'blowjob', 'handjob', 'cum', 'cumshot',
  'horny', 'sexy', 'strip club', 'stripper', 'prostitute', 'hooker', 'incest',
  'bdsm', 'bondage', 'dildo', 'vibrator', 'threesome', 'orgy',

  // -- profanity / slurs --
  'fuck', 'shit', 'bitch', 'bastard', 'asshole', 'dick', 'cock', 'pussy',
  'cunt', 'whore', 'slut', 'nigger', 'nigga', 'faggot', 'fag', 'retard',
  'retarded', 'spic', 'chink', 'kike', 'tranny',

  // -- violence / weapons --
  'gun', 'rifle', 'pistol', 'shotgun', 'bomb', 'grenade', 'explosive',
  'suicide', 'kill', 'murder', 'stab', 'stabbing', 'torture', 'behead',
  'beheading', 'gore', 'massacre', 'terrorist', 'terrorism',

  // -- drugs / alcohol --
  'cocaine', 'heroin', 'meth', 'methamphetamine', 'weed', 'marijuana', 'lsd',
  'ecstasy', 'crack pipe', 'bong', 'overdose', 'vape', 'vaping', 'cigarette',
  'cigar', 'beer', 'vodka', 'whiskey', 'drunk',

  // -- self-harm --
  'self harm', 'selfharm', 'cutting', 'cutter', 'anorexia', 'bulimia',
];

// Digits people substitute for look-alike letters when trying to dodge a
// filter (e.g. "s3x", "a55") — mapped back to the letter before matching.
const LEET_MAP = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's' };

function normalizeForBlocklist(text) {
  const lowered = String(text || '').toLowerCase();
  const deleeted = lowered.replace(/[01345]/g, (d) => LEET_MAP[d]);
  return deleeted.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Built once at module load. Word-boundary anchored on both sides so a
// blocked word only matches as a whole word — this is what keeps "assassin"
// and "essex" from tripping on a blocked "ass" (the "Scunthorpe problem").
// Multi-word phrases (e.g. "self harm") have their internal space turned into
// \s+ so they still match after normalizeForBlocklist collapses whitespace.
const BLOCKLIST_PATTERN = new RegExp(
  '\\b(' +
    BLOCKED_TERMS
      .map((term) => normalizeForBlocklist(term).split(' ').map(escapeRegExp).join('\\s+'))
      .join('|') +
  ')\\b',
  'i'
);

// Known gap, not solved here: spaced-out letters ("a s s") defeat this since
// normalizeForBlocklist preserves spaces as word separators. Acceptable for a
// first pass that's log-only on blocked attempts, not a hard security boundary.
function isBlockedQuery(rawQuery) {
  return BLOCKLIST_PATTERN.test(normalizeForBlocklist(rawQuery));
}

// Best-effort: only filters when Noun Project's raw response actually carries
// tag/term text per icon. Field names below are unverified — confirm against
// a real response during manual testing (log one raw icon object) and adjust
// if `tags`/`term` turn out wrong or missing. Silent no-op otherwise, not a
// failure — this layer backs up the query blocklist, it isn't the only line
// of defense.
function isBlockedIconResult(rawIcon) {
  if (!rawIcon || typeof rawIcon !== 'object') return false;
  const pieces = [];
  if (typeof rawIcon.term === 'string') pieces.push(rawIcon.term);
  if (Array.isArray(rawIcon.tags)) {
    for (const tag of rawIcon.tags) {
      if (typeof tag === 'string') pieces.push(tag);
      else if (tag && typeof tag.slug === 'string') pieces.push(tag.slug);
    }
  } else if (typeof rawIcon.tags === 'string') {
    pieces.push(rawIcon.tags);
  }
  if (!pieces.length) return false;
  return BLOCKLIST_PATTERN.test(normalizeForBlocklist(pieces.join(' ')));
}

module.exports = {
  normalizeForBlocklist,
  isBlockedQuery,
  isBlockedIconResult,
  BLOCKLIST_WARNING,
};
