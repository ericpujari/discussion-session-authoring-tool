# Discussion Session Authoring Tool

A web tool where Synthesis students (ages 8–14) draft their own Discussion Sessions —
storyboard editor, autosave, structure/tone guardrails built in — for a coach to review
before anything gets used for real.

Not an AI generator: the tool doesn't write scenarios, options, or questions for the
student. It's a structured drafting environment, not a content-writing one.

See [`CLAUDE.md`](CLAUDE.md) for full project context (read this first if you're Claude
Code) — what's built, who uses it, the session-structure spec it enforces, and how Eric
wants to collaborate on this.

## Running it locally

No build step. You need the [Vercel CLI](https://vercel.com/docs/cli) to run the
serverless API routes alongside the static HTML:

```bash
npm install
npx vercel dev
```

Then open the URL it prints (typically `http://localhost:3000`).

### Environment variables

Copy `.env.example` to `.env` and fill in real values — see that file for what each
one does and why. In short:

| Variable | Required for |
|---|---|
| `NOUNPROJECT_API_KEY` / `NOUNPROJECT_API_SECRET` | Icon search |
| `REDIS_URL` | Draft autosave, resume-by-username, the coach inbox, sticky notes. Without it the app still loads, but nothing persists. |
| `COACH_PASSWORD` | The coach review inbox — stays closed without it |
| `NOUNPROJECT_DAILY_SERVICE_BUDGET` / `NOUNPROJECT_DAILY_ICON_BUDGET` | Optional; caps daily Noun Project usage under the current plan's quota |

`REDIS_URL` is normally auto-injected by connecting a Redis database to the Vercel
project (Storage tab, or the Marketplace) — see `.env.example`'s comment on that
variable for the one-time dashboard steps. Without a real `REDIS_URL`, `vercel dev` still
runs, but every save silently no-ops.

## Student access links

Students don't have accounts or passwords. Each one gets a personal URL:

```
https://<your-app>.vercel.app/?s=c2NvdXQ0MjQ2.DIHw8ORBifW_cSGlQtif2D
```

The token is `base64url(username)` plus a truncated HMAC of that username, signed with
`STUDENT_LINK_SECRET`. It is stateless — nothing is stored per student, and any link can
be regenerated from the username plus the secret, so re-running the generator produces
identical links. Opening the link signs the student in and remembers them in
`localStorage`; a "Not you? Sign out" link on the home screen clears it.

`api/storage.js` checks the token on every read and write: a draft can only be read,
changed or deleted by the student whose name is on it, and `listByUser` uses the token's
username rather than whatever the browser claims. Coaches, who sign in separately with
`COACH_PASSWORD`, are exempt — the review inbox has to see everything.

### Generating the links

```bash
STUDENT_LINK_SECRET='<the same value set in Vercel>' \
  node scripts/make-student-links.js \
    --roster "Synthesis Supercollaborators - Sheet1.csv" \
    --base-url https://<your-app>.vercel.app \
    --out student-links.csv
```

Outputs `Name,Username,Parent Email,Link` — ready to feed straight into a mail merge. Rows
with no username are skipped, a duplicate username is a hard error (two students would
otherwise share one set of drafts), and a roster row with no parent email on file is
called out separately so it doesn't silently get missed. Both the roster and the
generated file are gitignored; the output is a set of working credentials.

### Turning it on

1. `openssl rand -base64 32` → set as `STUDENT_LINK_SECRET` in the Vercel project settings.
2. Deploy. Enforcement is still off, so nothing changes for anyone yet.
3. Set `STUDENT_LINKS_REQUIRED=1` and redeploy.
4. Generate the links and send each student theirs.

Unsetting `STUDENT_LINKS_REQUIRED` and redeploying is the rollback, and needs no code
change. Env vars only take effect on a new deployment.

## Known limitations (current test deployment)

- **Access links are bearer credentials.** A student who forwards their link hands over
  full access to their own sessions — there is no password behind it. Acceptable for a
  supervised test; real accounts are the Synthesis portal's job later.
- Links do not expire. The only way to revoke access is to rotate
  `STUDENT_LINK_SECRET`, which invalidates every student's link at once.
- Opening an example session from the home screen is a read-only preview — nothing it
  contains is ever saved, so a student can explore freely without creating a draft. Two
  seeded copies of those same sessions (`EXAMPLE-HMG`, `EXAMPLE-AOG`) sit in the coach
  inbox at "Ready for review" and still use the username `Example`, so anyone who types
  that can rename or delete those two from their own resume list. Four more seeded
  drafts (`EXAMPLE-AOG-REV`, `-PEND`, `-READY`, `-SHIP`) walk that same session through
  the rest of the coach pipeline as a worked example — each uses a distinct
  `Example (...)` username, so they aren't reachable the same way, and Accept/Delete are
  hidden for all six from the coach side (`isSeededExampleId` in `authoring-tool.html`).
- The coach inbox password (`COACH_PASSWORD`) has no lockout on repeated wrong guesses,
  and a successful coach sign-in issues a token with no identity attached, valid for 8
  hours with no way to revoke it early.

Before sharing a deployment more widely than a small trusted group, turn on **Vercel
Deployment Protection** (Project Settings → Deployment Protection) as a stopgap on top
of the above.

## Structure

- [`CLAUDE.md`](CLAUDE.md) — project context for Claude Code: what's built, the session
  spec, style/tone guardrails, working conventions
- [`reference/Discussion_Session_Template.md`](reference/Discussion_Session_Template.md)
  — the canonical session spec the tool enforces
- [`reference/sessions/`](reference/sessions/) — 9 real deployed sessions, for
  tone/structure reference
- [`src/authoring-tool.html`](src/authoring-tool.html) — the app: state object +
  `render()` dispatcher, no framework
- [`api/`](api/) — three Vercel serverless functions: Redis-backed draft/coach storage
  (`storage.js`), and icon search + permanent icon embedding via Noun Project
  (`noun-project-search.js`, `icon-asset.js`)
