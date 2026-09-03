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

## Known limitations (current test deployment)

- **No real student authentication.** Students identify themselves by typing a
  username — there are no accounts or passwords. Typing someone else's username reaches
  their drafts (view, rename, delete). This is accepted for now; closing it needs real
  per-student accounts, which is a separate, larger piece of work.
- The two built-in example drafts use the username `Example` — anyone who types that
  can rename or delete them.
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
