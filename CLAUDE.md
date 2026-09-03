# Project: Discussion Session Authoring Tool

## What this project is

This is a web-based tool where Synthesis **students** (ages 8–14) draft their own
Discussion Sessions, which automatically follow the correct structure and tone rules,
for a **coach** to review before anything goes further.

**This is NOT an AI content generator.** The tool does not write scenarios, options, or
questions for the student. It is a structured drafting environment — think smart form +
live structure checker — that:

- Enforces the fixed session structure (see below) so a student can't accidentally skip a
  section, mistime a scenario, or mix option counts.
- Surfaces the style/tone/sensitivity guardrails inline while drafting, so the writer
  self-checks as they go.
- Outputs a clean, correctly formatted session document (matching the structure of the
  files in `reference/sessions/`) that a coach can review, and that staff can turn into an
  official published session.

A dormant AI writing-assistant (behind `AI_ASSISTANT_ENABLED`, currently `false` — see
"Architecture conventions" below) exists for the same reason: coaching the student's own
writing, never generating content in their place.

## Who uses it

Two roles, in the one tool:

- **Students** (ages 8–14, worldwide) are the authors. No accounts — a typed username
  identifies a student's drafts (`listByUser` in `api/storage.js`), autosaved as they
  work, resumable later by typing that same username again.
- **Coaches** review what students submit, through a separate password-gated inbox
  (`COACH_PASSWORD` in `.env.example`) — not the student-facing home screen. A coach can
  leave notes, send a draft back for revision, or mark it reviewed.

This was forked from an earlier, separate student practice tool that lived at
`reference/session_builder.html` in this repo (since removed — see "Reference materials"
below); `src/authoring-tool.html` inherited its reusable patterns (storyboard UI,
self-check panel, save-reliability system) but is now its own thing, not a stand-in for
that original tool.

## Source of truth for structure and rules

`reference/Discussion_Session_Template.md` is the canonical spec. Read it in full before
building or modifying any structural logic. Key fixed rules from it:

- Exactly **6 scenarios**, fixed timing: 2-6, 6-10, 10-14, **[HALFTIME 14-15]**, 15-19,
  19-23, 23-27.
- Every scenario in a session uses the **same option count** throughout — 2, 3, or 4,
  never mixed within one session.
- Domains should rotate across peer/friendship, family, school, team/group — with an
  optional Synthesis-platform-specific scenario (usually Scenario 6).
- Each scenario: setup (1-3 sentences, second person) → options (each with its own
  genuine, positive rationale) → 3-4 challenge questions → 1 reflection question.
- Halftime (14-15): a process check-in, not a 7th scenario. Short framing question + 2-3
  options + one forward-looking line.
- Closing reflection (27-28): synthesizes across all six scenarios, 2-3 options, closing
  line that resists declaring a winner.
- Parent blurb always closes with some version of: "No right or wrong answers here — just
  interesting conversations with kids from around the world."

## Style & guardrails (must be checkable/visible in the tool, not just documentation)

**Balance test (most important):** every option in every scenario needs its own genuine,
positive reason a thoughtful kid would pick it — stated with equal confidence to every
other option. No option should read as "safe and obvious" while another reads as
"passive" or a fallback. No loaded language that quietly judges an option.

**Tone:** second person, plain vocabulary — readable aloud to an 8-year-old, engaging for
a 14-year-old. No jargon. No assumed cultural context (avoid country-specific
institutions, brands, currencies, seasons where possible). Light humor welcome, never at
someone's expense.

**Sensitivity:** never diagnose or reference a mental health condition, even lightly.
Avoid scenarios that could make an actually-quiet or actually-left-out student in the room
feel singled out. Handle money, family structure, and cultural norms carefully — don't
assume income level, family shape, or religion. No real named public figures.

**Global audience:** students are ages 8–14, from all over the world. Vocabulary,
references, and framing need to travel — nothing that only makes sense in one country or
culture.

## Reference materials

- `reference/Discussion_Session_Template.md` — the spec (read first, always)
- `reference/sessions/*.md` — 9 real, deployed sessions to pattern-match tone and
  structure against. When in doubt about what "matches the voice" means, look here.
- `src/authoring-tool.html` was forked from `reference/session_builder.html` (now removed
  from this repo — see "Who uses it" above) and inherited its reusable patterns: storyboard
  UI, self-check panel, save-reliability system. Those patterns are the reference now, not
  the original file itself.

## Architecture conventions (carried over from session_builder.html's patterns)

- Single-file or clearly separated HTML/CSS/JS — no build step required to run locally,
  should be staticly hostable (Vercel/Netlify Drop/GitHub Pages).
- Centralized state object + render() dispatcher pattern if the UI has multiple views.
- Feature flags (a boolean near config) for any dormant/in-progress feature rather than
  half-wired code paths.
- Verify JS syntax (`node --check`) before considering any change session done.

## Working style — how Eric wants to collaborate on this

- He's a contractor building this in his own time, learning React/Node/Claude Code as he
  goes — explain framework/tooling choices, don't assume deep familiarity.
- He does best refining or extending something already started, not blank-page mode —
  when starting a new feature, propose a concrete first pass rather than just asking "what
  do you want."
- Break work into small PRs/commits (under ~300 lines, ideally 200, touching 3 or fewer
  files, one specific problem each) if this becomes a multi-session build.
- Plan before building. For anything architectural or ambiguous, propose a short plan and
  ask clarifying questions before writing code. For small, well-specified asks, just
  implement.
- Stay tightly scoped to what's asked — don't carry forward reverted changes, don't remove
  working features unless told to.

## Current status

Built and working, not a scaffold. `src/authoring-tool.html` is a single-file app (state
object + `render()` dispatcher — see "Architecture conventions") backed by three Vercel
serverless functions in `api/`:

- `api/storage.js` — a Redis-backed key/value store: draft autosave (with retry and a
  size cap), resume-by-username, the coach inbox, private per-draft sticky notes, and
  coach sign-in (a shared password exchanged for a short-lived token).
- `api/noun-project-search.js` + `api/icon-asset.js` — a signed proxy to the Noun Project
  icon API, plus a second endpoint that re-fetches a chosen icon by id and embeds it as a
  permanent `data:` URI (Noun Project's own asset URLs expire roughly an hour after
  they're issued, which would otherwise rot every icon a student ever picked).

Drafting flow (answering what used to be open questions): storyboard view with
per-scenario editing panels, not one long form — Setup → Storyboard (6 scenario cards +
a fixed halftime card, drag or move-buttons to reorder) → Closing reflection → Review &
submit. Multi-user save-and-resume, by username, no accounts. Export is Markdown
matching the reference sessions' structure. The review/handoff step is the coach inbox
described above — export is not the end of the tool's job, submission is.

Known, accepted gap for the current test deployment: no real student authentication —
resume-by-username means typing someone else's username reaches their drafts. See the
README's "Known limitations" section before treating this as production-ready for a
wider student audience.
