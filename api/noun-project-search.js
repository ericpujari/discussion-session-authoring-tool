// Vercel serverless function: proxies icon search to the Noun Project API.
//
// Why this exists: the Noun Project API requires a signed request using a
// consumer key + secret. Those must never reach the browser, so this
// function holds them (as env vars) and does the signing server-side.
// session_builder.html calls this endpoint instead of Noun Project directly.
//
// Required env vars (set in Vercel project settings, never committed):
//   NOUNPROJECT_API_KEY
//   NOUNPROJECT_API_SECRET
//
// NOTE: implemented against Noun Project's documented OAuth 1.0a (HMAC-SHA1),
// two-legged, consumer-key-only auth scheme. Confirm this still matches
// Noun Project's current API docs/plan before relying on it in production —
// API auth schemes and endpoint paths do change over time.
//
// --- Quota protection -------------------------------------------------------
// This endpoint had no rate limit, cache, or auth of any kind — anyone who found
// the URL (visible in the browser's Network tab the first time anyone searches)
// could loop it. Confirmed against Noun Project's own pricing page (checked
// 2026-09): the Free Trial this project is currently on allows 1,000 "service
// calls" (any request without an icon id — this search is one) per day; a search
// UI backed by a shared vocabulary of common icon words ("trophy", "heart",
// "clock"...) makes that trivial to exceed even without anyone abusing it.
//
// Three layers, all backed by the same Redis instance draft storage already
// uses (REDIS_URL) — no new service:
//   1. Per-IP rate limit — smooths out an accidental or scripted loop from one
//      source. Not a hard security boundary (this app has no auth at all), just
//      enough to stop a tight loop from doing real damage.
//   2. Result cache, keyed by normalized query, short TTL — the biggest lever
//      against ordinary duplicate traffic: many different people searching the
//      same common word only ever costs one real Noun Project call.
//   3. Daily service-call budget guard — the actual backstop, sized under the
//      real plan ceiling above. Protects against many *legitimate* searches
//      adding up past the quota, which per-IP limiting alone can't catch.
// All three fail OPEN if Redis is unreachable: a Redis hiccup degrades this
// down to the original always-call-Noun-Project behavior rather than breaking
// icon search entirely.
//
// The cache TTL is intentionally short (not long, despite being the single
// biggest lever): Noun Project's docs state that the thumbnail/icon URLs this
// endpoint returns expire roughly an hour after the call they came from. A
// cached search result older than that would just be handing back a dead
// thumbnail instead of a fresh one — low-stakes here since this is a live,
// transient search UI (the user just re-searches), but there's no reason to
// let a cache entry outlive the URLs it holds. Selecting a result doesn't rely
// on this cache at all — see api/icon-asset.js, which re-fetches by id and
// embeds the bytes permanently at the moment of selection.

const crypto = require('crypto');
const OAuth = require('oauth-1.0a');
const { createClient } = require('redis');

const NOUN_PROJECT_ENDPOINT = 'https://api.thenounproject.com/v2/icon';
const RESULT_LIMIT = 20;

const CACHE_KEY_PREFIX = 'iconcache:';
const CACHE_TTL_SECONDS = 45 * 60; // stays comfortably under Noun Project's ~1hr URL expiry

const RATE_LIMIT_PREFIX = 'iconrl:';
const RATE_LIMIT_PER_MINUTE = 10; // generous for a human clicking Search repeatedly; tight for a loop

const BUDGET_KEY_PREFIX = 'iconbudget:service:';
const DEFAULT_DAILY_SERVICE_BUDGET = 900; // headroom under the Free Trial's 1,000/day ceiling

function buildOAuthClient() {
  const key = process.env.NOUNPROJECT_API_KEY;
  const secret = process.env.NOUNPROJECT_API_SECRET;
  if (!key || !secret) {
    return null;
  }
  return new OAuth({
    consumer: { key, secret },
    signature_method: 'HMAC-SHA1',
    hash_function: (baseString, hashKey) =>
      crypto.createHmac('sha1', hashKey).update(baseString).digest('base64'),
  });
}

// Duplicated from api/storage.js and api/icon-asset.js rather than shared —
// matches this repo's existing convention of self-contained serverless
// functions with no imports between them (see CLAUDE.md's architecture notes).
let clientPromise = null;
function getRedisClient() {
  const url = process.env.REDIS_URL;
  if (!url) return Promise.resolve(null);
  if (!clientPromise) {
    const client = createClient({ url });
    client.on('error', (err) => console.error('Redis connection error (noun-project-search)', err));
    clientPromise = client.connect().then(() => client).catch((err) => {
      clientPromise = null;
      console.error('Redis connect failed (noun-project-search)', err);
      return null;
    });
  }
  return clientPromise;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function secondsUntilNextUTCMidnight() {
  const now = new Date();
  const nextMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.ceil((nextMidnight - now.getTime()) / 1000);
}

// Increment-then-check (not check-then-increment) so concurrent requests can't
// both slip through under the limit before either has recorded itself.
async function underRateLimit(redis, ip) {
  if (!redis) return true; // fail open
  try {
    const bucket = Math.floor(Date.now() / 60000);
    const key = RATE_LIMIT_PREFIX + ip + ':' + bucket;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 70);
    return count <= RATE_LIMIT_PER_MINUTE;
  } catch (e) {
    console.error('icon search rate limit check failed', e);
    return true; // fail open
  }
}

async function underDailyBudget(redis) {
  if (!redis) return true; // fail open
  const budget = Number(process.env.NOUNPROJECT_DAILY_SERVICE_BUDGET) || DEFAULT_DAILY_SERVICE_BUDGET;
  try {
    const dateKey = new Date().toISOString().slice(0, 10); // UTC date
    const key = BUDGET_KEY_PREFIX + dateKey;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, secondsUntilNextUTCMidnight());
    return count <= budget;
  } catch (e) {
    console.error('icon search budget check failed', e);
    return true; // fail open
  }
}

function normalizeQuery(query) {
  return query.trim().toLowerCase();
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!query) {
    res.status(400).json({ error: 'Missing required "q" search term.' });
    return;
  }

  const redis = await getRedisClient().catch(() => null);
  const ip = clientIp(req);

  if (!(await underRateLimit(redis, ip))) {
    res.status(429).json({ error: 'Too many icon searches — wait a moment and try again.' });
    return;
  }

  const cacheKey = CACHE_KEY_PREFIX + normalizeQuery(query);
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        res.status(200).json({ results: JSON.parse(cached) });
        return;
      }
    } catch (e) {
      console.error('icon search cache read failed', e);
      // fall through and search fresh
    }
  }

  if (!(await underDailyBudget(redis))) {
    res.status(503).json({
      error: "Today's icon search limit has been reached. Try again tomorrow, or ask a coach to check the Noun Project plan.",
    });
    return;
  }

  const oauth = buildOAuthClient();
  if (!oauth) {
    // Server misconfiguration, not a caller error — don't leak details.
    res.status(500).json({ error: 'Icon search is not configured.' });
    return;
  }

  const requestUrl = `${NOUN_PROJECT_ENDPOINT}?query=${encodeURIComponent(query)}&limit=${RESULT_LIMIT}`;
  const authHeader = oauth.toHeader(oauth.authorize({ url: requestUrl, method: 'GET' }));

  let response;
  try {
    response = await fetch(requestUrl, {
      method: 'GET',
      headers: { Authorization: authHeader.Authorization },
    });
  } catch (err) {
    res.status(502).json({ error: 'Could not reach the icon search service.' });
    return;
  }

  if (!response.ok) {
    // Don't forward the raw upstream body — it may include auth/debug detail.
    res.status(502).json({ error: 'Icon search service returned an error.' });
    return;
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    res.status(502).json({ error: 'Icon search service returned an unexpected response.' });
    return;
  }

  const icons = Array.isArray(data.icons) ? data.icons : [];
  const results = icons.map((icon) => ({
    id: icon.id,
    thumbnailUrl: icon.thumbnail_url || icon.preview_url || null,
    iconUrl: icon.icon_url || icon.thumbnail_url || null,
    attributionName: (icon.attribution || '').trim() || null,
    attributionUrl: icon.permalink || null,
  })).filter((icon) => icon.thumbnailUrl && icon.iconUrl);

  if (redis) {
    redis.set(cacheKey, JSON.stringify(results), { EX: CACHE_TTL_SECONDS })
      .catch((e) => console.error('icon search cache write failed', e));
  }

  res.status(200).json({ results });
};
