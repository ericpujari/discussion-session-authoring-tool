# Project: Discussion Session Authoring Tool

## What this project is

This is a web-based **authoring interface** that lets Synthesis session writers (coaches,
learning team members — not students) draft new Discussion Sessions that automatically
follow the correct structure and tone rules.

**This is NOT an AI content generator.** The tool does not write scenarios, options, or
questions for the user. It is a structured drafting environment — think smart form +
live structure checker — that:

- Enforces the fixed session structure (see below) so a writer can't accidentally skip a
  section, mistime a scenario, or mix option counts.
- Surfaces the style/tone/sensitivity guardrails inline while drafting, so the writer
  self-checks as they go (similar in spirit to the self-check panel pattern this project
  inherited from the student practice tool it was forked from, but for full session
  authoring rather than student practice drafts).
- Outputs a clean, correctly formatted session document (matching the structure of the
  files in `reference/sessions/`) that a writer can export/copy for review.

Eric (the user) writes and coaches these sessions himself and knows the voice already —
this tool exists to make drafting faster and more consistent, not to replace his (or other
writers') judgment about content.

## Who uses it

Synthesis session writers — coaches and learning-team members who write Discussion
Session scripts. Not the end students. (Students get a *different* tool — a separate,
student-facing practice tool for ages 8–14 to draft their own mini-sessions for coach
review. It used to live at `reference/session_builder.html` in this repo but was removed
after student-facing work accidentally landed there instead of in this authoring tool;
`src/authoring-tool.html` is its fork and carries the same reusable patterns. Don't
confuse the two — this authoring tool is for the adults writing the real, deployed
sessions; student-facing changes don't belong here.)

## Source of truth for structure and rules

`reference/Discussion_Session_Template.md` is the canonical spec. Read it in full before
building or modifying any structural logic. Key fixed rules from it:

- Exactly **6 scenarios**, fixed timing: 2-6, 6-10, 10-14, **[HALFTIME 14-15]**, 15-19,
  19-23, 23-27.
- Every scenario in a session uses the **same option count** throughout — either 2 or 3,
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
  UI, self-check panel, save-reliability system. Those patterns are the reference now.

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

Fresh project, just scaffolded. No UI has been built yet. Next step is to define the exact
screens/flow for the authoring interface (see open questions below).

## Open questions to resolve with Eric before/while building

- What's the actual drafting flow? E.g.: one long form matching the template top-to-bottom,
  or a storyboard-style view (like `src/authoring-tool.html` already has) with
  per-scenario editing panels?
- Does this need multi-user/save-and-resume, or is it single-session-at-a-time (draft,
  export, done)?
- Export format — Markdown matching the reference sessions' structure? Something else?
- Does it need a review/handoff step (e.g. flagging for Aaron or another reviewer), or is
  export the end of this tool's job?
