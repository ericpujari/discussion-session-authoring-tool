// Vercel serverless function: given a Noun Project icon id, returns that icon's
// image permanently embedded as a data: URI, instead of Noun Project's own asset
// URL, which the docs state expires roughly an hour after it's issued.
//
// Why this exists: src/authoring-tool.html persists a chosen icon into the draft
// (selectedIcon.thumbnailUrl/iconUrl) and re-renders it later — in Review, the
// coach inbox, the player preview, and the Markdown export. Drafts routinely live
// far longer than an hour (autosave + resume-by-username is the whole point), so
// storing Noun Project's own URL meant every one of those views would eventually
// show a broken image. A data: URI never expires — it's just a string — so once
// this runs, the icon is safe to redisplay indefinitely.
//
// Deliberately does NOT accept an image URL from the client: the client only ever
// sends an icon id (validated as a plain integer), and this function re-fetches
// that icon from Noun Project itself before downloading its asset. Accepting a
// caller-supplied URL here would make this endpoint an open SSRF proxy — anyone
// could ask the server to fetch and return an arbitrary URL's bytes.
//
// Also protects the "icon call" quota specifically (see api/noun-project-search.js
// for the general design note): Noun Project's own definition is "any request
// that includes an icon ID" is an icon call, which is exactly what re-fetching by
// id is. Once fetched, the result is cached under the icon's id with a long TTL —
// the embedded bytes never go stale, so unlike the search-result cache, there's no
// correctness reason to keep this TTL short. That also means picking the same icon
// twice (by the same or different students) only ever costs one real Noun Project
// call, not one per selection.
//
// NOTE: like noun-project-search.js, this is implemented against Noun Project's
// documented OAuth 1.0a two-legged auth and the "Get an Icon" endpoint response
// shape as described in their docs — not verified against a live response, since
// this project doesn't hold real credentials in this environment. Confirm the
// response field names below (icon_url / thumbnail_url / attribution / permalink)
// against a real call before relying on this in production.
//
// Required env vars (same as noun-project-search.js):
//   NOUNPROJECT_API_KEY
//   NOUNPROJECT_API_SECRET
// Optional:
//   REDIS_URL                        — enables the id-keyed embed cache and the
//                                       daily icon-call budget guard. If unset or
//                                       unreachable, this endpoint still works —
//                                       it just re-fetches from Noun Project on
//                                       every call and has no budget protection.
//   NOUNPROJECT_DAILY_ICON_BUDGET     — max real icon-by-id calls per UTC day
//                                       before this endpoint refuses new ones.
//                                       Cache hits don't count. Default 130,
//                                       sized under the Free Trial's 150/day
//                                       icon-call ceiling — raise this once the
//                                       project moves to a paid Noun Project plan.

const crypto = require('crypto');
const OAuth = require('oauth-1.0a');
const { createClient } = require('redis');

const NOUN_PROJECT_ICON_ENDPOINT = 'https://api.thenounproject.com/v2/icon/';
const ASSET_CACHE_KEY_PREFIX = 'iconasset:';
const ASSET_CACHE_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days — housekeeping, not correctness
const BUDGET_KEY_PREFIX = 'iconbudget:icon:';
const DEFAULT_DAILY_ICON_BUDGET = 130;
const MAX_ASSET_BYTES = 200 * 1024; // a simple line icon should be a few KB; this is a generous ceiling against a pathological asset

function buildOAuthClient() {
  const key = process.env.NOUNPROJECT_API_KEY;
  const secret = process.env.NOUNPROJECT_API_SECRET;
  if (!key || !secret) return null;
  return new OAuth({
    consumer: { key, secret },
    signature_method: 'HMAC-SHA1',
    hash_function: (baseString, hashKey) =>
      crypto.createHmac('sha1', hashKey).update(baseString).digest('base64'),
  });
}

// Duplicated from api/storage.js and api/noun-project-search.js rather than shared,
// matching this repo's existing convention of independent, self-contained serverless
// functions (see CLAUDE.md's architecture notes) — each api/*.js file here already
// stands alone with no imports between them.
let clientPromise = null;
function getRedisClient() {
  const url = process.env.REDIS_URL;
  if (!url) return Promise.resolve(null);
  if (!clientPromise) {
    const client = createClient({ url });
    client.on('error', (err) => console.error('Redis connection error (icon-asset)', err));
    clientPromise = client.connect().then(() => client).catch((err) => {
      clientPromise = null;
      console.error('Redis connect failed (icon-asset)', err);
      return null;
    });
  }
  return clientPromise;
}

function secondsUntilNextUTCMidnight() {
  const now = new Date();
  const nextMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.ceil((nextMidnight - now.getTime()) / 1000);
}

// Atomic increment-then-check so concurrent requests can't both slip through under
// the limit — see the design note in noun-project-search.js's rate limiter for why
// this order (not check-then-increment) matters.
async function underDailyIconBudget(redis) {
  if (!redis) return true; // fail open: a Redis hiccup shouldn't take the feature down
  const budget = Number(process.env.NOUNPROJECT_DAILY_ICON_BUDGET) || DEFAULT_DAILY_ICON_BUDGET;
  try {
    const dateKey = new Date().toISOString().slice(0, 10); // UTC date
    const key = BUDGET_KEY_PREFIX + dateKey;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, secondsUntilNextUTCMidnight());
    return count <= budget;
  } catch (e) {
    console.error('icon budget check failed', e);
    return true; // fail open
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const rawId = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  if (!/^\d+$/.test(rawId)) {
    res.status(400).json({ error: 'A valid icon id is required.' });
    return;
  }

  const redis = await getRedisClient().catch(() => null);

  // Cache hit: the embedded bytes never go stale, so this is always safe to serve
  // regardless of age, and costs zero Noun Project calls.
  if (redis) {
    try {
      const cached = await redis.get(ASSET_CACHE_KEY_PREFIX + rawId);
      if (cached) {
        res.status(200).json(JSON.parse(cached));
        return;
      }
    } catch (e) {
      console.error('icon asset cache read failed', e);
      // fall through and fetch fresh
    }
  }

  if (!(await underDailyIconBudget(redis))) {
    res.status(503).json({
      error: "Today's icon-saving limit has been reached. Try again tomorrow, or ask a coach to check the Noun Project plan.",
    });
    return;
  }

  const oauth = buildOAuthClient();
  if (!oauth) {
    res.status(500).json({ error: 'Icon search is not configured.' });
    return;
  }

  const detailUrl = NOUN_PROJECT_ICON_ENDPOINT + encodeURIComponent(rawId);
  const authHeader = oauth.toHeader(oauth.authorize({ url: detailUrl, method: 'GET' }));

  let detail;
  try {
    const detailRes = await fetch(detailUrl, { headers: { Authorization: authHeader.Authorization } });
    if (!detailRes.ok) {
      res.status(502).json({ error: "Couldn't look up that icon." });
      return;
    }
    const detailBody = await detailRes.json();
    detail = detailBody && (detailBody.icon || detailBody); // defensive: unverified whether the response wraps in "icon"
  } catch (e) {
    res.status(502).json({ error: 'Could not reach the icon service.' });
    return;
  }

  const assetUrl = detail && (detail.icon_url || detail.thumbnail_url);
  if (!assetUrl) {
    res.status(502).json({ error: 'That icon has no image to save.' });
    return;
  }

  let assetRes;
  try {
    assetRes = await fetch(assetUrl);
  } catch (e) {
    res.status(502).json({ error: 'Could not download that icon.' });
    return;
  }
  if (!assetRes.ok) {
    res.status(502).json({ error: 'Could not download that icon.' });
    return;
  }

  const contentType = assetRes.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) {
    res.status(502).json({ error: 'That icon was not an image.' });
    return;
  }
  const contentLength = Number(assetRes.headers.get('content-length'));
  if (contentLength && contentLength > MAX_ASSET_BYTES) {
    res.status(502).json({ error: 'That icon is too large to use here.' });
    return;
  }

  let buf;
  try {
    const arrayBuffer = await assetRes.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_ASSET_BYTES) {
      res.status(502).json({ error: 'That icon is too large to use here.' });
      return;
    }
    buf = Buffer.from(arrayBuffer);
  } catch (e) {
    res.status(502).json({ error: 'Could not read that icon.' });
    return;
  }

  const payload = {
    id: rawId,
    dataUri: 'data:' + contentType + ';base64,' + buf.toString('base64'),
    attributionName: (detail.attribution || '').trim() || null,
    attributionUrl: detail.permalink || null,
  };

  if (redis) {
    redis.set(ASSET_CACHE_KEY_PREFIX + rawId, JSON.stringify(payload), { EX: ASSET_CACHE_TTL_SECONDS })
      .catch((e) => console.error('icon asset cache write failed', e));
  }

  res.status(200).json(payload);
};
