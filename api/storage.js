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
// Request contract: POST { op: 'get'|'set'|'delete'|'list'|'listByUser'|'coachLogin', ... }
//   get        -> { value: string } | null
//   set        -> { ok: true }  (value must be a string — callers JSON.stringify first)
//   delete     -> { ok: true }  (same open access as get/set — see the note below)
//   list       -> { keys: string[] }  (key doubles as the prefix to match)
//                 COACH ONLY: requires a valid x-coach-token header.
//   listByUser -> { drafts: object[] }  ({ key: 'draft:' }); returns the drafts
//                 belonging to the x-student-token holder.
//   coachLogin -> { token, expiresAt }  ({ password }); 401 on a bad password.
//
// Required env vars:
//   REDIS_URL             (auto-injected by the Vercel Redis integration)
//   COACH_PASSWORD        (set by hand; gates the coach inbox)
//   STUDENT_LINK_SECRET   (set by hand; signs the per-student access links)
//   STUDENT_LINKS_REQUIRED ('1'/'true' turns student enforcement on — see below)

const { createClient } = require('redis');
const crypto = require('crypto');

// ---- Coach authentication --------------------------------------------------
// One shared password (COACH_PASSWORD) gates the coach-only operations. The
// browser never stores that password: it posts it once to `coachLogin` and gets
// back a short-lived HMAC-signed token, which it then sends as x-coach-token.
//
// `list` (bulk key enumeration) is coach-only — it is the operation that would
// otherwise let anyone dump every draft in the database.
//
// ---- Student access links -----------------------------------------------
// Students get a personal URL (?s=<token>) instead of typing a username. The
// token is base64url(username) + '.' + a truncated HMAC of that username, so it
// is stateless: nothing is stored per student, and any link can be regenerated
// from the username plus STUDENT_LINK_SECRET. Rotating that secret invalidates
// every link at once, which is the only revocation mechanism — deliberate, for
// a short supervised test rather than a permanent account system.
//
// Enforcement sits behind STUDENT_LINKS_REQUIRED so the API and the browser app
// can be deployed in either order without a window where every request 401s.
// With it off, this file behaves exactly as it did before links existed.
// With it on, every get/set/delete is checked against the draft's own
// studentName, and listByUser ignores whatever username the browser claims and
// uses the token's instead.
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

const STUDENT_TOKEN_HEADER = 'x-student-token';

// Separate secret from COACH_PASSWORD so rotating one doesn't invalidate the other.
function studentTokenKey() {
  return crypto
    .createHash('sha256')
    .update('student-link-v1:' + (process.env.STUDENT_LINK_SECRET || ''))
    .digest();
}

// 22 base64url chars ≈ 132 bits — far more than a guessing attack can reach, and
// short enough to keep the emailed link from wrapping.
function signStudent(username) {
  return crypto
    .createHmac('sha256', studentTokenKey())
    .update(username)
    .digest('base64url')
    .slice(0, 22);
}

// Exported for scripts/make-student-links.js, so the generator and the verifier
// can never drift into producing different token formats.
function issueStudentToken(username) {
  const u = normalizeUsername(username);
  if (!u) return null;
  return Buffer.from(u).toString('base64url') + '.' + signStudent(u);
}

// Returns the normalized username the token vouches for, or null.
function verifyStudentToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  let u;
  try {
    u = normalizeUsername(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
  if (!u) return null;
  if (!safeEqual(parts[1], signStudent(u))) return null;
  return u;
}

function studentLinksRequired() {
  const v = String(process.env.STUDENT_LINKS_REQUIRED || '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

// The two seeded example sessions are shared reading material: any signed-in
// student may read them, only a coach may change them.
function isExampleDraftKey(key) {
  return /^draft:EXAMPLE-/.test(key);
}

// { exists, owner } for a draft key. A value too corrupt to parse is reported as
// existing but owned by nobody, so it fails every ownership comparison rather
// than throwing and 500ing the request.
async function readDraftOwner(redis, draftKey) {
  const raw = await redis.get(draftKey);
  if (raw == null) return { exists: false, owner: null };
  try {
    const d = JSON.parse(raw);
    return { exists: true, owner: normalizeUsername(d && d.studentName) };
  } catch (e) {
    return { exists: true, owner: null };
  }
}

const DENY = { status: 403, error: "That draft belongs to someone else." };

// Returns null when the student may proceed, or { status, error } when they may
// not. Default-deny: an unrecognised key prefix is refused, so a storage key
// added later cannot be born unprotected.
async function authorizeStudentKey(redis, op, key, value, owner) {
  if (isExampleDraftKey(key)) {
    if (op === 'get') return null;
    return { status: 403, error: 'Example sessions can only be changed by a coach.' };
  }

  if (key.startsWith('draft:')) {
    const id = key.slice('draft:'.length);
    if (!id) return { status: 400, error: 'Missing draft id.' };
    const rec = await readDraftOwner(redis, key);

    if (op === 'set') {
      let claimed;
      try {
        claimed = normalizeUsername(JSON.parse(value).studentName);
      } catch (e) {
        return { status: 400, error: 'That draft could not be read.' };
      }
      // Both halves matter: the first stops a draft being written in someone
      // else's name, the second stops an existing draft being taken over.
      if (claimed !== owner) return DENY;
      if (rec.exists && rec.owner !== owner) return DENY;
      return null;
    }

    // get / delete. A key that isn't there is not an error — get returns null
    // and delete is a no-op, exactly as before.
    if (!rec.exists) return null;
    if (rec.owner !== owner) return DENY;
    return null;
  }

  if (key.startsWith('notes:')) {
    const id = key.slice('notes:'.length);
    if (!id) return { status: 400, error: 'Missing draft id.' };
    const rec = await readDraftOwner(redis, 'draft:' + id);
    if (!rec.exists || rec.owner !== owner) return DENY;
    return null;
  }

  if (key.startsWith('moduser:')) {
    if (normalizeUsername(key.slice('moduser:'.length)) !== owner) return DENY;
    return null;
  }

  return { status: 403, error: 'That storage key is not available.' };
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
      res.status(401).json({ error: 'Coach sign-in required.', reason: 'coach' });
      return;
    }
  }

  const isCoach = verifyToken(req.headers[COACH_TOKEN_HEADER]);
  const linksRequired = studentLinksRequired();
  const studentOwner = verifyStudentToken(req.headers[STUDENT_TOKEN_HEADER]);

  // Refuse to run half-protected: enforcement on with no secret would make every
  // token unverifiable, which fails closed here rather than silently open.
  if (linksRequired && !process.env.STUDENT_LINK_SECRET) {
    res.status(500).json({
      error: 'Student links are not configured. Set STUDENT_LINK_SECRET in the Vercel project settings and redeploy.',
    });
    return;
  }

  // Coaches are exempt: the inbox has to read every draft, append notes, and mark
  // drafts reviewed. `list` was already gated above.
  if (linksRequired && !isCoach) {
    if (!studentOwner) {
      res.status(401).json({
        error: 'Open your personal link to use the session builder.',
        reason: 'student',
      });
      return;
    }
    if (op !== 'listByUser') {
      let denial;
      try {
        denial = await authorizeStudentKey(redis, op, key, value, studentOwner);
      } catch (e) {
        console.error('authorization check failed', e);
        res.status(500).json({ error: 'Storage request failed.' });
        return;
      }
      if (denial) {
        res.status(denial.status).json({ error: denial.error, reason: 'student' });
        return;
      }
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

    if (op === 'delete') {
      await redis.del(key);
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
      // With links on, the browser's claimed username is ignored outright — the
      // token decides whose drafts come back. That is what closes the old hole
      // where typing someone else's username listed their work. A coach may
      // still look a student up by name.
      const wanted = (linksRequired && !isCoach) ? studentOwner : normalizeUsername(username);
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

// Vercel only ever calls the default export above; this rides along so the link
// generator shares one definition of the token format with the verifier.
module.exports.issueStudentToken = issueStudentToken;
module.exports.verifyStudentToken = verifyStudentToken;
