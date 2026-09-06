# Student Beta Test — Operating Guide

Started September 2026. This is a private beta with the ~83 students on the Synthesis
Supercollaborators roster, ahead of full Synthesis platform integration — testing the
drafting UX with real students, on real deployed infrastructure, before anything wider.

This doc is the reference for running it day to day: what's safe to touch while links are
live, what isn't, how to add or remove a student, and what to do if something goes wrong.

## How access works (plain-language)

Each student got a personal link — `https://.../?s=<long token>` — instead of an account.
Opening it signs them in automatically and remembers them on that device (their browser
stores it), so they don't need to re-enter anything on a return visit. A "Not you? Sign
out" link on the home screen lets them clear it.

Behind that: the token is cryptographically signed, and the server checks it on every
single read and write. A student can only ever see, edit, or delete their own drafts —
this was verified directly against the live production API, including a real two-student
test (one student's throwaway draft was correctly hidden and unreachable from another
student's token, confirmed 403 on read/list/delete).

## ✅ Safe to do while links are live

- **Deploy code changes.** Bug fixes, styling, copy changes, new features — pushing to
  `main` and redeploying is safe at any time. Student drafts live in Redis, not in the
  deployed code, so a redeploy never touches saved work. A student with the page already
  open may need to refresh to get the update, but nothing breaks or gets lost either way.
- **Add a new student.** Add their row to the roster CSV, re-run the link generator (see
  below), send them just their new link. Existing students' links are untouched — tokens
  are derived independently per username, so generating one doesn't affect the others.
- **Coach sign-in, review, notes.** Completely separate system (a shared password), unrelated
  to student links. Use it normally any time.
- **Redeploying for unrelated reasons** (a Noun Project fix, a Redis hiccup, anything else)
  — safe, as long as you don't also change the two env vars below.

## ⚠️ What kills or breaks the links — avoid unless you mean it

- **Rotating `STUDENT_LINK_SECRET`** in Vercel invalidates **every single one of the 83
  links at once**, immediately. This is the intended kill switch for ending the beta or
  responding to a leak — but it is all-or-nothing. There is no way to revoke just one
  student's access without taking down everyone else's too. If that's ever needed, the
  workaround is social, not technical: ask that one student to stop using their link.
- **Turning `STUDENT_LINKS_REQUIRED` off** removes the privacy protection entirely and
  reverts to the old "type any username" behavior for everyone. Only do this deliberately
  (e.g., rolling back the whole beta), never as a quick fix for something else.
- **Setting either of the above with a typo or extra whitespace** effectively breaks it the
  same way — a value that's ever-so-slightly wrong looks identical to "not set" from the
  outside. If links stop working right after touching either variable in Vercel, that's
  the first thing to check (see Troubleshooting).

## Ending the beta / full reset

1. Vercel dashboard → your project → **Settings** → **Environment Variables**.
2. Find `STUDENT_LINK_SECRET` → **⋯** → **Edit** → replace the value with a fresh one
   (`openssl rand -base64 32` in Terminal) → **Save**.
3. **Deployments** tab → latest deployment → **⋯** → **Redeploy**.
4. Every previously sent link now shows the locked "open your personal link" screen. No
   code changes needed.

## Adding a student mid-beta

1. Add their row to `Synthesis Supercollaborators - Sheet1.csv` (must have a `Username`).
2. Run, from the project folder in Terminal:
   ```
   STUDENT_LINK_SECRET='<the value currently set in Vercel>' node scripts/make-student-links.js \
     --roster "Synthesis Supercollaborators - Sheet1.csv" \
     --base-url https://discussion-session-authoring-tool.vercel.app \
     --out student-links.csv
   ```
3. This regenerates the whole file, but everyone's link stays identical except the new
   row — safe to re-run any time. Send only the new student their link.

The output is `Name, Username, Parent Email, Link`, ready to feed straight into a mail
merge — pulling the email from the roster automatically rather than needing a manual
match-up. If a row on the roster has no parent email on file, the generator prints it as a
warning and leaves that cell blank rather than silently skipping it; you'll need another
way to reach that student.

## What was verified before this went live

- Full ownership matrix (server logic): a student can't read, overwrite, delete, or take
  over another student's draft or notes; can't read another student's moderation record;
  unrecognized storage keys are denied by default rather than left open.
- Tampered or forged tokens are rejected; a missing token shows the locked screen rather
  than an error.
- Turning enforcement on without the secret configured fails **closed** (locks everyone
  out with a clear setup error) rather than failing open.
- Coaches bypass all of the above — the review inbox still sees everything.
- **Live on production, with two real disposable test identities**: student A created a
  draft; student B's token got 403 trying to read, list, or delete it; A could still see
  and delete their own. Cleaned up afterward, no test data left behind.
- All 83 real links were generated and each one verified to resolve back to the correct
  student through the actual server-side check — not just spot-checked.

## Known limitations for this beta (accepted, not fixed)

- **The link is the credential.** A student who forwards theirs hands over full access to
  their own sessions — there's no password behind it. Worth one line in whatever you send
  students: keep this link to yourself.
- **Links don't expire**, and there's no per-student revocation — only the all-or-nothing
  secret rotation above.
- The two seeded example sessions (`EXAMPLE-HMG`, `EXAMPLE-AOG`) can still be edited or
  deleted by a coach only — a student opening an example now gets a read-only preview and
  can no longer create an orphaned copy under the name "Example."
- The coach password has no lockout on repeated wrong guesses, and a coach sign-in token
  can't be revoked early (expires naturally after 8 hours).

## Day-to-day housekeeping

- **Clean up old test drafts.** Sign into the coach inbox, open any leftover draft named
  "Example" from testing done before the read-only fix shipped, and use its **🗑️ Delete**
  button. That button is deliberately hidden on `EXAMPLE-HMG` and `EXAMPLE-AOG` — those are
  the intentionally seeded pair, and can't be removed this way even by accident.
- **`student-links.csv` and the roster CSV are both gitignored on purpose** — the links
  file is 83 working credentials. Don't attach it wholesale to a group email or shared
  doc; it's meant for a mail-merge into one-to-one messages.

## Troubleshooting

**A student says their link doesn't work / shows the locked screen:**
1. Check the full URL made it through their email client intact — some clients truncate
   or wrap long links, which corrupts the token. Ask them to try tapping/clicking it
   directly rather than retyping it.
2. Check `STUDENT_LINK_SECRET` hasn't been rotated since their link was generated — if it
   has, their old link is permanently dead and they need a freshly generated one.
3. Check `STUDENT_LINKS_REQUIRED` is still set to `1` in Vercel — if it got unset, links
   still work but so does the old "type any username" box, which isn't what you want.

**Everyone's links broke at once, right after a Vercel change:**
Almost certainly a copy-paste issue with `STUDENT_LINK_SECRET` — trailing whitespace or a
newline captured along with the value produces a completely different (but not obviously
wrong-looking) secret. Re-edit the variable, clear the field fully before pasting, redeploy.

## Quick reference

| Env var | Purpose | Set in |
|---|---|---|
| `COACH_PASSWORD` | Gates the coach inbox | Vercel → Environment Variables |
| `STUDENT_LINK_SECRET` | Signs every student link | Vercel → Environment Variables |
| `STUDENT_LINKS_REQUIRED` | `1` = enforce ownership; unset = old open behavior | Vercel → Environment Variables |

| File | Purpose |
|---|---|
| `Synthesis Supercollaborators - Sheet1.csv` | The roster (gitignored) |
| `student-links.csv` | Generated links, one per student (gitignored) |
| `scripts/make-student-links.js` | Regenerates the links file |
| `README.md` | Full technical writeup of how the link system works |
