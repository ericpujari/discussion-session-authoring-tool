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
// Request contract: POST { op: 'get'|'set'|'list'|'listByUser'|'coachLogin', ... }
//   get        -> { value: string } | null
//   set        -> { ok: true }  (value must be a string — callers JSON.stringify first)
//   list       -> { keys: string[] }  (key doubles as the prefix to match)
//                 COACH ONLY: requires a valid x-coach-token header.
//   listByUser -> { drafts: object[] }  ({ key: 'draft:', username }); open to
//                 students, returns only drafts whose studentName matches.
//   coachLogin -> { token, expiresAt }  ({ password }); 401 on a bad password.
//
// Required env vars:
//   REDIS_URL        (auto-injected by the Vercel Redis integration)
//   COACH_PASSWORD   (set by hand; gates the coach inbox)

const { createClient } = require('redis');
const crypto = require('crypto');

// ---- Coach authentication --------------------------------------------------
// One shared password (COACH_PASSWORD) gates the coach-only operations. The
// browser never stores that password: it posts it once to `coachLogin` and gets
// back a short-lived HMAC-signed token, which it then sends as x-coach-token.
//
// What this gate does and does not cover, worth being precise about:
//   `list` (bulk key enumeration) is coach-only. That is the operation that
//   would otherwise let anyone dump every draft in the database, so it is the
//   one that matters most. `get`/`set` on an already-known key stay open,
//   because students have no accounts and must still read and write their own
//   drafts. Guessing a 5-char draft id therefore remains possible; closing that
//   needs real per-student auth, which is the Synthesis portal's job later.
const COACH_TOKEN_HEADER = 'x-coach-token';
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // one coaching session

// Derived rather than using the password as the HMAC key directly, so rotating
// COACH_PASSWORD also invalidates every token already handed out.
function tokenKey() {
  return crypto
    .createHash('sha256')
    .update('coach-token-v1:' + (process.env.COACH_PASSWORD || ''))
    .digest();
}

// Constant-time compare. Both sides are hashed first so the comparison is over
// fixed-length buffers and doesn't leak the expected length via an early return.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function signExpiry(exp) {
  return crypto.createHmac('sha256', tokenKey()).update(exp).digest('base64url');
}

function issueToken() {
  const exp = String(Date.now() + TOKEN_TTL_MS);
  return {
    token: Buffer.from(exp).toString('base64url') + '.' + signExpiry(exp),
    expiresAt: Number(exp),
  };
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  let exp;
  try {
    exp = Buffer.from(parts[0], 'base64url').toString('utf8');
  } catch (e) {
    return false;
  }
  if (!/^\d+$/.test(exp)) return false;
  if (!safeEqual(parts[1], signExpiry(exp))) return false;
  return Date.now() < Number(exp);
}

function normalizeUsername(u) {
  return String(u == null ? '' : u).trim().toLowerCase();
}

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

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const { op, key, value, username } = body || {};

  if (op === 'coachLogin') {
    const expected = process.env.COACH_PASSWORD;
    if (!expected) {
      res.status(500).json({
        error: 'Coach access is not configured. Set COACH_PASSWORD in the Vercel project settings and redeploy.',
      });
      return;
    }
    if (typeof body.password !== 'string' || !safeEqual(body.password, expected)) {
      res.status(401).json({ error: "That password doesn't match." });
      return;
    }
    res.status(200).json(issueToken());
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

  if (!op || typeof key !== 'string' || !key) {
    res.status(400).json({ error: 'op and key are required.' });
    return;
  }

  // Bulk enumeration is coach-only; everything else stays open (see the note above).
  if (op === 'list') {
    if (!process.env.COACH_PASSWORD) {
      res.status(500).json({
        error: 'Coach access is not configured. Set COACH_PASSWORD in the Vercel project settings and redeploy.',
      });
      return;
    }
    if (!verifyToken(req.headers[COACH_TOKEN_HEADER])) {
      res.status(401).json({ error: 'Coach sign-in required.' });
      return;
    }
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
      // node-redis >=5 yields one array per SCAN round; v4 yielded individual keys.
      // Accept both, so a client-version bump can't silently empty the coach inbox again.
      for await (const batch of redis.scanIterator({ MATCH: key + '*', COUNT: 200 })) {
        if (Array.isArray(batch)) keys.push(...batch);
        else keys.push(batch);
      }
      res.status(200).json({ keys });
      return;
    }

    // Students have no accounts, so resume-by-username filters server-side and
    // returns only that student's drafts. Doing the match here (rather than
    // shipping every draft to the browser to filter, as this used to) is what
    // lets `list` above be locked down without breaking resume.
    if (op === 'listByUser') {
      const wanted = normalizeUsername(username);
      if (!wanted) {
        res.status(400).json({ error: 'username is required.' });
        return;
      }
      const drafts = [];
      for await (const batch of redis.scanIterator({ MATCH: key + '*', COUNT: 200 })) {
        const batchKeys = Array.isArray(batch) ? batch : [batch];
        if (!batchKeys.length) continue;
        const values = await redis.mGet(batchKeys);
        for (const v of values) {
          if (!v) continue;
          try {
            const d = JSON.parse(v);
            if (d && normalizeUsername(d.studentName) === wanted) drafts.push(d);
          } catch (e) { /* a corrupt value shouldn't sink the whole lookup */ }
        }
      }
      res.status(200).json({ drafts });
      return;
    }

    res.status(400).json({ error: 'Unknown op: ' + op });
  } catch (e) {
    console.error('storage error', e);
    res.status(500).json({ error: 'Storage request failed.' });
  }
};
