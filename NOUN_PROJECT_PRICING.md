# Noun Project API Pricing & Scaling Notes

Written 2026-09-11, currently on the Free Trial. Revisit this before opening the
tool up to a few hundred students — the Free Trial will not hold up at that scale.

## Terminology: service call vs. icon call

Noun Project bills by what a request *contains*, not how many results come back.

- **Service call** — any request *without* a specific icon ID. Every icon **search**
  is one service call, no matter how many results it returns (this app's proxy asks
  for up to 20 per search — still just 1 service call). Handled in
  `api/noun-project-search.js`.
- **Icon call** — any request that *includes* a specific icon ID. This only happens
  when a student **selects** a result to embed it — handled in `api/icon-asset.js`,
  which re-fetches that one icon by id and embeds it as a permanent `data:` URI.

So: 1 search = 1 service call. 1 selection = 1 icon call. Searching does **not** cost
20 icon calls — the `limit=20` param only affects how many results come back in that
single service call.

## How this app's existing caching affects real usage

Both call types are already cached, which matters a lot for cost:

- **Search results** (`api/noun-project-search.js`): cached 45 minutes, keyed by the
  normalized search term, **shared across every student**. 50 kids all searching
  "trophy" within the same 45-minute window costs 1 real service call, not 50.
- **Selected icons** (`api/icon-asset.js`): cached 90 days, keyed by icon ID, also
  shared across every student. Once *anyone* picks a specific icon, every future
  student who picks that same icon costs zero additional icon calls, for 90 days.

This makes **service calls** (searches) comfortable at almost any realistic scale —
the cache absorbs most duplicate traffic on common words. **Icon calls** (selections)
get much less benefit from caching, since different students tend to pick *different*
specific icons even when searching the same word.

## Why the Free Trial breaks at "a few hundred students"

Free Trial limits (as of the pricing page checked 2026-09-11):

| | Free Trial |
|---|---|
| Service calls | 1,000/day, 2,000/month |
| Icon calls | **150/day, 150/month** (same number — 150 total per month, period) |
| Monthly value cap | $5 |

Service calls are fine — the 45-minute shared cache keeps real usage well under
1,000–2,000/month even with heavy search traffic.

**Icon calls are the real constraint.** A few hundred students each building a
6-scenario session with up to 4 options each is easily thousands of icon
*selections*. The Free Trial allows 150 selections total, per month, ever. Real
usage would exhaust that in the first day or two, after which every student trying
to save an icon gets a 503 — this app's own `underDailyIconBudget` guard in
`api/icon-asset.js` already returns exactly that error
(`"Today's icon-saving limit has been reached..."`) once the configured budget is hit.

## Recommendation: Pay-Per-Use tier

$25/month minimum. Rough cost estimate for a few hundred active students:

- **Service calls**: even ~5,000 real searches/month after caching ≈ $12.50 — under
  the $25 minimum either way.
- **Icon calls**: worst case ~7,000 unique selections/month ≈ $67; likely lower once
  repeat icon choices across students and future sessions start hitting the 90-day
  cache.

**Realistic range: roughly $25–$100/month**, depending on adoption. The Pay-Per-Use
tier also lets you set your own monthly maximum as a spend cap. The Custom tier
($300/month minimum, unlimited) is overkill at this scale — revisit only if usage
grows into the thousands of students.

## Action items for when the account upgrades

1. **Raise the app's own budget env vars in the Vercel dashboard.** These currently
   default to numbers sized specifically for the *Free Trial's* limits, with headroom
   under them — they will keep throttling students at Free Trial levels even after
   upgrading, unless raised:
   - `NOUNPROJECT_DAILY_SERVICE_BUDGET` — currently defaults to 900/day (Free Trial
     cap is 1,000/day). Pay-Per-Use allows 200,000/day.
   - `NOUNPROJECT_DAILY_ICON_BUDGET` — currently defaults to 130/day (Free Trial cap
     is 150/day, which is also the *monthly* cap). Pay-Per-Use allows 10,000/day.
   - Defined in `api/noun-project-search.js` (`DEFAULT_DAILY_SERVICE_BUDGET`) and
     `api/icon-asset.js` (`DEFAULT_DAILY_ICON_BUDGET`); overridden via the two env
     vars above, documented in `README.md`'s environment variables table.
   - Pick numbers well under the new plan's ceiling (not the ceiling itself) — these
     exist as a safety backstop against a bug or abuse, not just a formality.
2. **Set Noun Project's own "Monthly Maximum" spend cap** on the Pay-Per-Use plan
   itself, as a second, independent safety net on top of this app's internal budget
   guards.
