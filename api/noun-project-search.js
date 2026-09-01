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

const crypto = require('crypto');
const OAuth = require('oauth-1.0a');

const NOUN_PROJECT_ENDPOINT = 'https://api.thenounproject.com/v2/icon';
const RESULT_LIMIT = 20;

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
    const status = response.status === 401 || response.status === 403 ? 502 : 502;
    res.status(status).json({ error: 'Icon search service returned an error.' });
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

  res.status(200).json({ results });
};
