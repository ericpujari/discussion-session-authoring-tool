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
//   In the Vercel dashboard, add a Redis database to this project (Storage tab, or
//   vercel.com/marketplace?category=storage) and connect it to this project. That
//   auto-injects REDIS_URL, which this endpoint reads.
//
// Uses the standard `redis` (node-redis) client over a TCP connection — the
// package and env var name Vercel's own dashboard quickstart points to for its
// Redis integration. The connected client is cached at module scope so a warm
// serverless instance reuses one connection across invocations instead of
// reconnecting on every request.
//
// Required env vars (auto-injected by the integration above):
//   REDIS_URL
//
// Request contract: POST { op: 'get'|'set'|'list', key, value? }
//   get  -> { value: string } | null
//   set  -> { ok: true }  (value must be a string — callers JSON.stringify first)
//   list -> { keys: string[] }  (key doubles as the prefix to match)

const { createClient } = require('redis');

let clientPromise = null;
function getClient() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!clientPromise) {
    const client = createClient({ url });
    client.on('error', (err) => console.error('Redis connection error', err));
    clientPromise = client.connect().then(() => client).catch((err) => {
      clientPromise = null; // let the next request retry instead of staying broken forever
      throw err;
    });
  }
  return clientPromise;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  let redis;
  try {
    const client = await getClient();
    if (!client) {
      res.status(500).json({
        error: 'Storage is not configured. In the Vercel dashboard, add a Redis database to this project (Storage tab) and redeploy.',
      });
      return;
    }
    redis = client;
  } catch (e) {
    console.error('storage connect error', e);
    res.status(500).json({ error: 'Could not connect to storage.' });
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
      for await (const k of redis.scanIterator({ MATCH: key + '*', COUNT: 200 })) {
        keys.push(k);
      }
      res.status(200).json({ keys });
      return;
    }

    res.status(400).json({ error: 'Unknown op: ' + op });
  } catch (e) {
    console.error('storage error', e);
    res.status(500).json({ error: 'Storage request failed.' });
  }
};
