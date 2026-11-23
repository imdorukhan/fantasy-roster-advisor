# Salary CAPtain 3.0 reliability audit — 2026-11-23 PT

Scope: existing `salarycaptain` Vercel project, GitHub repository `imdorukhan/fantasy-roster-advisor`, and existing Supabase project `bmsfbcuausbfzheufjtc`. No account creation, paid services, tokens, cookie inspection, or fantasy transactions.

## Reproducible anonymous-browser baseline

Run `node scripts/sc3-ui-smoke.mjs` with the installed dependencies and Chrome on an isolated profile. This test enumerates buttons and clicks read-only controls without using the user's browser session. Authentication actions are deliberately excluded. Audit output is local and may contain player names; do not publish full output.

- `/`, `/matchup.html`, `/optimizer.html`, `/public-matchup.html` load with HTTP 200.
- In anonymous session, current SC3 streaming, Yahoo league rosters, official matchup, matchup projection, and health requests return HTTP 401; `/api/auth/yahoo/status` reports `connected=false`. Authentication protection is working, but error messages and navigation need to help the owner sign in.
- `/api/yahoo-matchup` returns 503 because the independently scraped public matchup is not verified. The legacy `/api/matchup` returns 410 (intentionally retired).
- The official Yahoo screenshot page may show `UNAVAILABLE / STALE` even when a separate SC3 snapshot exists. This conflates no-owner-session, unverified current week, and scraper failure.
- No client JavaScript exceptions were seen in the isolated browser baseline. This does not establish functionality for an authenticated owner.
- `node --test` baseline: 150 tests, 147 passed, 0 failed, 3 skipped.

## Existing data and sync

- 2026-11-23: the approved monotonic copy of only five Yahoo API sections from `public.yahoo_league_snapshots` into `sc3.yahoo_league_snapshots` advanced all five sections to 2026-11-23 11:02:21.807 UTC; no public tables were changed.
- Existing protected Preview daily NBA sync returned HTTP 200 and `complete=true`; 2026-11-22 added 149 rows. Subsequent health: `fresh=true`, `missingDays=[]`, 34 days and 5,529 game logs.
- Preview Yahoo system health returned `healthy` with five `fresh` sections.
- Official matchup endpoint still returned HTTP 422, `Exactly one official current Yahoo matchup required`. Monday week rollover must be verified, not backfilled with the prior week's data.

## Root-cause separation

1. **P0 — Owner authentication:** Production private SC3 APIs correctly reject unauthenticated requests (401). The end-user site must present actionable Yahoo owner sign-in rather than appearing inert. Do not remove the owner gate.
2. **P1 — Week rollover:** A healthy database snapshot need not contain the current Yahoo matchup week. Display this separately; never fabricate the week's 9-CAT score.
3. **P1 — Public scraper:** Public Yahoo matchup can be unavailable independently of the already-synced private Yahoo API. Never treat its failure as proof that all Yahoo data is stale.
4. **P1 — UI feedback:** Several read-only feature pages have generic HTTP-code messages instead of a sign-in link and distinct source errors.
5. **P2 — Feature coverage:** Before changing feature gates, use authenticated owner acceptance tests for Streaming Optimizer, Waiver Planner, Matchup Optimizer, player dialogs, and Free Agents.

## Safe change and release procedure

1. Improve error classification and actionable sign-in/retry UI without leaking protected snapshots.
2. Add focused unit tests, keep anonymous denial tests, re-run `node --test` and isolated-browser smoke.
3. Commit and push each logical fix on the dedicated GitHub feature branch. Verify the exact commit and a protected preview before considering any release.
4. Require an existing owner sign-in for private SC3 acceptance; do not bypass OAuth, read tokens, or start a refresh without an explicit authorized flow.
5. Keep the current production alias unchanged until a tested candidate passes owner and anonymous acceptance tests. Recheck rollback deployment before a release.

This document is evidence for diagnostics; it does not claim every owner-only button works.
