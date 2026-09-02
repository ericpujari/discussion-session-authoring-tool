// Vercel serverless function: a small key-value shim over a Redis database, giving
// the browser-side app a get/set/list API. src/authoring-tool.html's window.storage
// object (defined in the small <script> block right before the main app script)
// calls this endpoint — see that block for the client-side half of this contract.
//
// Why this exists: authoring-tool.html was forked from a version of this tool built
// to run embedded in some other platform that injected a window.storage API. This
// standalone Vercel deployment has no such host, so nothing was ever actually
// persisted — drafts, the coach inbox, resume-by-username, and sticky notes all
// silently no-op. This endpoint plus the client shim give it a real backend.
//
// Required setup (not something this code can do for you):
//   In the Vercel dashboard, open this project > Storage > Marketplace Database >
//   add a Redis integration (Upstash). That auto-injects the env vars below and
//   this endpoint picks them up automatically — no manual env var entry needed.
//
// Required env vars (auto-injected by the integration above):
//   KV_REST_API_URL
//   KV_REST_API_TOKEN
//
// Request contract: POST { op: 'get'|'set'|'list', key, value? }
//   get  -> { value: string } | null
//   set  -> { ok: true }  (value must be a string — callers JSON.stringify first)
//   list -> { keys: string[] }  (key doubles as the prefix to match)

const { Redis } = require('@upstash/redis');

function getClient() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  // Values passed in are already JSON strings (the app does its own
  // JSON.stringify/parse) — disable the client's own auto (de)serialization so
  // get() hands back the exact string that was set(), not a re-parsed object.
  return new Redis({ url, token, automaticDeserialization: false });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const redis = getClient();
  if (!redis) {
    res.status(500).json({
      error: 'Storage is not configured. In the Vercel dashboard, add a Redis database to this project (Project Settings > Storage) and redeploy.',
    });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const { op, key, value } = body || {};
  if (!op || typeof key !== 'string' || !key) {
    res.status(400).json({ error: 'op and key are required.' });
    return;
  }

  try {
    if (op === 'get') {
      const v = await redis.get(key);
      res.status(200).json(v == null ? null : { value: v });
      return;
    }

    if (op === 'set') {
      if (typeof value !== 'string') {
        res.status(400).json({ error: 'value must be a string.' });
        return;
      }
      await redis.set(key, value);
      res.status(200).json({ ok: true });
      return;
    }

    if (op === 'list') {
      const keys = [];
      let cursor = '0';
      do {
        const [nextCursor, batch] = await redis.scan(cursor, { match: key + '*', count: 200 });
        cursor = nextCursor;
        keys.push(...batch);
      } while (cursor !== '0');
      res.status(200).json({ keys });
      return;
    }

    res.status(400).json({ error: 'Unknown op: ' + op });
  } catch (e) {
    console.error('storage error', e);
    res.status(500).json({ error: 'Storage request failed.' });
  }
};
