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

// Pulled verbatim (2026-09) from the community-maintained "LDNOOBW" (List of
// Dirty, Naughty, Obscene, and Otherwise Bad Words) English list —
// https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words —
// rather than hand-typed, since a hand-curated subset is exactly what let real
// gaps (poop, pee, damn, testicles, nipple, anus, middle finger) through in an
// earlier pass. Two fixes applied against the source file: "g-spot" split
// into both "g spot" and "gspot" (a bare hyphen gets deleted, not turned
// into a word break, by normalizeForBlocklist below — so a query typed with
// the hyphen normalizes to "gspot" while the original single "g-spot" entry
// only matched a query typed with an actual space; covering both forms
// catches it either way it's typed) and the
// trailing middle-finger emoji entry dropped (normalizeForBlocklist strips
// all non-alphanumeric characters including emoji, so it would normalize to
// an empty string — see the empty-entry filter below for why that matters,
// and CUSTOM_TERMS' "middle finger" covers the same intent as text).
// To refresh: re-fetch the "en" file from that repo and re-apply both fixes.
//
// Deliberately includes a few words with common non-vulgar meanings (poof,
// tit, cock) rather than pruning them — icon search queries are almost
// always concrete nouns, so the odds of a legitimate "blue tit" or "poof of
// smoke" search are low, and erring toward blocking is the stated priority
// here. Remove a specific word below if it turns out to cause real friction.
const LDNOOBW_TERMS = [
  '2g1c', '2 girls 1 cup', 'acrotomophilia', 'alabama hot pocket',
  'alaskan pipeline', 'anal', 'anilingus', 'anus', 'apeshit', 'arsehole',
  'ass', 'asshole', 'assmunch', 'auto erotic', 'autoerotic', 'babeland',
  'baby batter', 'baby juice', 'ball gag', 'ball gravy', 'ball kicking',
  'ball licking', 'ball sack', 'ball sucking', 'bangbros', 'bangbus',
  'bareback', 'barely legal', 'barenaked', 'bastard', 'bastardo',
  'bastinado', 'bbw', 'bdsm', 'beaner', 'beaners', 'beaver cleaver',
  'beaver lips', 'beastiality', 'bestiality', 'big black', 'big breasts',
  'big knockers', 'big tits', 'bimbos', 'birdlock', 'bitch', 'bitches',
  'black cock', 'blonde action', 'blonde on blonde action', 'blowjob',
  'blow job', 'blow your load', 'blue waffle', 'blumpkin', 'bollocks',
  'bondage', 'boner', 'boob', 'boobs', 'booty call', 'brown showers',
  'brunette action', 'bukkake', 'bulldyke', 'bullet vibe', 'bullshit',
  'bung hole', 'bunghole', 'busty', 'butt', 'buttcheeks', 'butthole',
  'camel toe', 'camgirl', 'camslut', 'camwhore', 'carpet muncher',
  'carpetmuncher', 'chocolate rosebuds', 'cialis', 'circlejerk',
  'cleveland steamer', 'clit', 'clitoris', 'clover clamps', 'clusterfuck',
  'cock', 'cocks', 'coprolagnia', 'coprophilia', 'cornhole', 'coon', 'coons',
  'creampie', 'cum', 'cumming', 'cumshot', 'cumshots', 'cunnilingus', 'cunt',
  'darkie', 'date rape', 'daterape', 'deep throat', 'deepthroat',
  'dendrophilia', 'dick', 'dildo', 'dingleberry', 'dingleberries',
  'dirty pillows', 'dirty sanchez', 'doggie style', 'doggiestyle',
  'doggy style', 'doggystyle', 'dog style', 'dolcett', 'domination',
  'dominatrix', 'dommes', 'donkey punch', 'double dong',
  'double penetration', 'dp action', 'dry hump', 'dvda', 'eat my ass',
  'ecchi', 'ejaculation', 'erotic', 'erotism', 'escort', 'eunuch', 'fag',
  'faggot', 'fecal', 'felch', 'fellatio', 'feltch', 'female squirting',
  'femdom', 'figging', 'fingerbang', 'fingering', 'fisting', 'foot fetish',
  'footjob', 'frotting', 'fuck', 'fuck buttons', 'fuckin', 'fucking',
  'fucktards', 'fudge packer', 'fudgepacker', 'futanari', 'gangbang',
  'gang bang', 'gay sex', 'genitals', 'giant cock', 'girl on', 'girl on top',
  'girls gone wild', 'goatcx', 'goatse', 'god damn', 'gokkun',
  'golden shower', 'goodpoop', 'goo girl', 'goregasm', 'grope', 'group sex',
  'g spot', 'gspot', 'guro', 'hand job', 'handjob', 'hard core', 'hardcore', 'hentai',
  'homoerotic', 'honkey', 'hooker', 'horny', 'hot carl', 'hot chick',
  'how to kill', 'how to murder', 'huge fat', 'humping', 'incest',
  'intercourse', 'jack off', 'jail bait', 'jailbait', 'jelly donut',
  'jerk off', 'jigaboo', 'jiggaboo', 'jiggerboo', 'jizz', 'juggs', 'kike',
  'kinbaku', 'kinkster', 'kinky', 'knobbing', 'leather restraint',
  'leather straight jacket', 'lemon party', 'livesex', 'lolita',
  'lovemaking', 'make me come', 'male squirting', 'masturbate',
  'masturbating', 'masturbation', 'menage a trois', 'milf',
  'missionary position', 'mong', 'motherfucker', 'mound of venus',
  'mr hands', 'muff diver', 'muffdiving', 'nambla', 'nawashi', 'negro',
  'neonazi', 'nigga', 'nigger', 'nig nog', 'nimphomania', 'nipple',
  'nipples', 'nsfw', 'nsfw images', 'nude', 'nudity', 'nutten', 'nympho',
  'nymphomania', 'octopussy', 'omorashi', 'one cup two girls',
  'one guy one jar', 'orgasm', 'orgy', 'paedophile', 'paki', 'panties',
  'panty', 'pedobear', 'pedophile', 'pegging', 'penis', 'phone sex',
  'piece of shit', 'pikey', 'pissing', 'piss pig', 'pisspig', 'playboy',
  'pleasure chest', 'pole smoker', 'ponyplay', 'poof', 'poon', 'poontang',
  'punany', 'poop chute', 'poopchute', 'porn', 'porno', 'pornography',
  'prince albert piercing', 'pthc', 'pubes', 'pussy', 'queaf', 'queef',
  'quim', 'raghead', 'raging boner', 'rape', 'raping', 'rapist', 'rectum',
  'reverse cowgirl', 'rimjob', 'rimming', 'rosy palm',
  'rosy palm and her 5 sisters', 'rusty trombone', 'sadism', 'santorum',
  'scat', 'schlong', 'scissoring', 'semen', 'sex', 'sexcam', 'sexo', 'sexy',
  'sexual', 'sexually', 'sexuality', 'shaved beaver', 'shaved pussy',
  'shemale', 'shibari', 'shit', 'shitblimp', 'shitty', 'shota', 'shrimping',
  'skeet', 'slanteye', 'slut', 's&m', 'smut', 'snatch', 'snowballing',
  'sodomize', 'sodomy', 'spastic', 'spic', 'splooge', 'splooge moose',
  'spooge', 'spread legs', 'spunk', 'strap on', 'strapon', 'strappado',
  'strip club', 'style doggy', 'suck', 'sucks', 'suicide girls',
  'sultry women', 'swastika', 'swinger', 'tainted love', 'taste my',
  'tea bagging', 'threesome', 'throating', 'thumbzilla', 'tied up',
  'tight white', 'tit', 'tits', 'titties', 'titty', 'tongue in a', 'topless',
  'tosser', 'towelhead', 'tranny', 'tribadism', 'tub girl', 'tubgirl',
  'tushy', 'twat', 'twink', 'twinkie', 'two girls one cup', 'undressing',
  'upskirt', 'urethra play', 'urophilia', 'vagina', 'venus mound', 'viagra',
  'vibrator', 'violet wand', 'vorarephilia', 'voyeur', 'voyeurweb', 'voyuer',
  'vulva', 'wank', 'wetback', 'wet dream', 'white power', 'whore',
  'worldsex', 'wrapping men', 'wrinkled starfish', 'xx', 'xxx', 'yaoi',
  'yellow showers', 'yiffy', 'zoophilia',
];

// This project's own additions, for categories LDNOOBW doesn't cover (mild
// profanity, bathroom humor, gestures, violence, drugs, self-harm) or
// specific gaps a coach reported. Some overlap with LDNOOBW_TERMS above is
// expected and harmless (duplicate regex alternatives, not a bug) — kept
// separate rather than hand-deduplicated so LDNOOBW_TERMS can stay a clean,
// re-fetchable copy of the upstream source.
const CUSTOM_TERMS = [
  // -- body parts LDNOOBW doesn't list --
  'testicle', 'testicles', 'scrotum', 'buttocks', 'pubic', 'foreskin',
  'ejaculate',

  // -- lingerie / underwear (LDNOOBW only has panties/panty) — deliberately
  // NOT including bare "teddy" or "boxer": both have common, wholesome
  // meanings (teddy bear, boxer dog/sport) too likely to be a legitimate
  // icon search in this app to block outright.
  'lingerie', 'thong', 'thongs', 'underwear', 'bra', 'bras', 'bralette',
  'corset', 'garter', 'negligee', 'camisole', 'chemise', 'briefs',
  'boxer briefs',

  // -- mild profanity --
  'damn', 'hell', 'crap', 'piss', 'pissed',

  // -- other slurs --
  'retard', 'retarded', 'chink',

  // -- crude / bathroom humor (mild, but not what this tool's icons should be) --
  'poop', 'pee', 'fart', 'farting', 'snot', 'booger', 'boogers',

  // -- rude gestures --
  'middle finger', 'flip off', 'flipping the bird',

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

const BLOCKED_TERMS = LDNOOBW_TERMS.concat(CUSTOM_TERMS);

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
//
// The empty-string filter matters: normalizeForBlocklist strips every
// non-alphanumeric character, so an emoji-only or punctuation-only entry
// normalizes to "" — an empty alternative in the regex would match at every
// position in every string, silently blocking all search results. Guards
// against that for any entry, not just the specific emoji already dropped
// from LDNOOBW_TERMS above.
const BLOCKLIST_PATTERN = new RegExp(
  '\\b(' +
    BLOCKED_TERMS
      .map((term) => normalizeForBlocklist(term))
      .filter(Boolean)
      .map((term) => term.split(' ').map(escapeRegExp).join('\\s+'))
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
