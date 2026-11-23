# SC3 source contracts, calibrated strategy gates, and injury/alert delivery design

**Audit date:** 2026-11-23 | **Scope:** existing read-only SC3 schema, league 85892, owner team 5, isolated `feature/sc3-reliability-20261123` protected Vercel Preview. **Production release NOT authorized.**

## Live evidence vs unverified capabilities

| Source / capability | Verified observation in the latest protected Preview and scoped SC3 DB | Gate |
| --- | --- | --- |
| Yahoo settings/teams/standings/scoreboard/roster | 5 stored sections; latest observed Nov 23, 17:29 UTC | Snapshot age, league/team identity, exact week and stat IDs must be validated per request |
| Official Yahoo Week 6 matchup | Week 6 (Nov 23–29), team 5 vs team 2; 9-CAT values not published; HTTP 422 `scoreVerified=false` | **BLOCK** category probabilities, matchup impact and actionable trade/punt recommendations |
| Yahoo league rosters | 14 teams / 206 players; owner roster 15 | Verify per-player ownership, lineup slot and observed time; no stale October names |
| Yahoo–ESPN identity | 249 verified links across SC3; **14 of 15 current owner players linked**. Yahoo ID **10452**, Kasparas Jakučionis, lacks a verified link | Do not guess by name; require one-to-one corroboration (name/team and DOB or jersey with no conflicting evidence) |
| ESPN NBA | NBA health HTTP 200, `fresh=true`, no missing dates; 1,012 stored depth rows | Missing player game logs or unknown NBA identities remain unavailable, never 0 |
| Yahoo pool | 538 waiver players, **0** verified FAs in the observed source | Cannot perform a positive live FA rank/streaming acceptance until a real verified FA is present |
| Injury feeds | Four Yahoo roster status flags; independently verified ESPN depth markers are not medical clearance | A verified return date **does not** exist from these inputs |
| Forecast ledger | Local `injury-ledger.mjs` CLI; not connected to external news and no scheduled sender | **NO background delivery or automated forecasts**; explicit opt-in and independent source checks required |

Each status above is observational, not proof that the original Yahoo data will remain unchanged. Production 2.0 must remain untouched.

## Mandatory model readiness contracts

### P0 — Yahoo official current-week evidence (all score-dependent models)

1. Current Yahoo league settings + scoreboard show a single fixture containing team 5 and correct opponent, week start/end, observation time, and **all nine official category totals**.
2. Cross-check the official `stat_winners` against category margins, correct TO inversion and shooting makes/attempts. Guard against 0/0, missing values, future timestamps and past-week substitution.
3. Derive NBA game appearances from completed ESPN box scores; derive **fantasy scoring** only from confirmed Yahoo starter slots and league locking rules. Do not treat NBA appearance as a Yahoo lineup appearance.
4. Until all verified, status is `pending`, not zero and not a simulated official score.

**Current outcome:** blocked (Yahoo Week 6 official 9-CAT totals not published). Yahoo Fantasy API docs explicitly distinguish league scoreboard/week resources and game stat categories: https://sports.yahoo.com/developer/docs/

### P1 — Player projection and data coverage

1. Validate each Yahoo player ID maps at most once to a unique ESPN ID, matching current NBA team; duplicate/conflicting IDs fail closed. Yahoo ID 10452 still needs independently matching evidence.
2. Yahoo player-stat retrieval must declare `requested`, `returned`, `missingIds`, `complete`, and upstream failure count; a valid HTTP success with absent players is **not** full coverage.
3. Require complete and date-contiguous ESPN season/last-3/7/14 history, verified stats per appearance, and attempted field goals/free throws for rate-sensitive calculations. Invalid `3PM>FGM`, `FGM>FGA` or `FTM>FTA` is not a valid player projection.
4. Pool benchmarks need explicit expected size, duplicate-ID rejection, league scoring categories, and sufficient coverage. Z-scores remain **descriptive** until outcomes are calibrated.

**Current outcome:** ESPN supplemental statistics available for most roster players; Yahoo player-stat completeness and missing identity still block full player-pool calibration.

### P2 — Trade Impact and Punt Strategy calibration

1. Demand verified player ownership, realistic proposed trade package, exact per-game shooting volume and all nine categories; ensure outgoing projections cannot exceed roster totals.
2. Simulate lineup conflicts, weekly matchups, waiver/roster rules, TO direction and FG%/FT% **attempt-weighted** effects.
3. Build an append-only prospective forecast/outcome ledger keyed by league/week/team/player/forecast issued-at. Freeze each forecast **before** outcomes occur; keep revisions as separate versions.
4. Evaluate on **chronologically held-out matchups**, never use the week's completed games as inputs to that week's initial predictions. Compare to simple baseline; measure Brier score, log loss and reliability curves before reporting probabilities or enabling recommended actions. Reference: https://scikit-learn.org/stable/modules/calibration
5. A `punt` changes roster construction; merely removing a category from a nine-value sum is not a calibrated win projection. Recompute all eight retained categories with revised roster/lineup projections.

**Current outcome:** pure arithmetic is regression-tested; no sufficiently verified outcome-history calibration pipeline. Keep `actionable=false` and `winProbability=null`.

### P3 — Playoff Planner

1. Read official Yahoo playoff start/end weeks and rules from the authenticated league settings; verify playoff league dates, team eligibility, acquisitions and lock deadlines.
2. Read complete ESPN **future NBA schedules**, deduplicate by event ID, separate published schedule from actual games played, account for back-to-back/rest and roster slot conflicts.
3. Verify Yahoo playoff week matching before computing games/advantage for a proposed team. Later changed schedules require recomputation.
4. Until all checks pass, show only a labeled **unverified schedule scenario**, not playoff-win probabilities or roster actions.

**Current outcome:** current planner only computes schedule counts; playoff-specific owner-verified integration is absent.

## Injury prediction and alerts: safe delivery architecture

**Proposed read-only flow:** official NBA injury reports + relevant official team notices (external sources) → timestamp and origin validation → exact Yahoo–ESPN identity match → update an append-only episode ledger → detect **material status changes** → review-only candidate → owner-approved notification setting → optional delivery. It must never issue fantasy add/drop or waiver transactions.

**Separate evidence types:**
- Yahoo `Q/O/IL` is *fantasy roster status*, not independent medical evidence.
- ESPN depth `IL` is *depth-chart designation*, not guaranteed recovery information.
- NBA official injury reports and team releases can support current game availability, but **a projected return date** needs explicit cited language and timestamp; otherwise use `returnDate=null`.
- Confirm the *actual return* against a completed NBA game appearance (and separate Yahoo fantasy lineup eligibility); do not backfill an earlier prediction after seeing the outcome.

**Delivery contract:** no scheduled sender exists in the current SC3 code. Before activating one, require explicit owner opt-in, no-op dry run, recipient verification, authentication and authorization, idempotent event key `source|playerId|injuryEpisode|status|observedAt`, suppression of unchanged messages, dedupe across repeated reports, retry handling without duplicate notifications, source freshness thresholds, error logs with no credentials, and a tested stop switch. Use existing free-tier infrastructure only if approved and supported; **do not provision or start one in this repair**.

**Forecast reliability contract:** `injury-ledger.mjs` is a local manual journal. Its custom path works after the repair, but it is not a cloud service. Source and outcome evidence URLs must be HTTPS; this checks link shape, **not the truth or availability** of its content. Independently verify cited sources and score only the earliest pre-outcome forecast for each injury episode; provisional confidence with small samples is not actionable.

Relevant official source entry point: https://official.nba.com/ . NBA game-day report snapshots are time-sensitive and can change.

## Priority order for subsequent work

| Rank | Next task | Release blocker |
| --- | --- | --- |
| P0 | Owner signs in interactively and completes protected Preview UI acceptance, without sharing tokens | Required; current fixture stats still pending |
| P0 | Verify Yahoo publishes the current week's complete 9-CAT totals and stat winners | Required for matchup/strategy probabilities |
| P1 | Resolve Yahoo player ID 10452 only with trusted corroboration; re-check all live ID links | Source mapping required |
| P1 | Implement/test Yahoo player-stat retrieval coverage in the owner-authorized source pipeline, without new OAuth or token reads during this task | Full player pool required |
| P2 | Model temporal evaluation ledger and calibrated 9-CAT forecasts using historical, observed outcomes; separately test Trade/Punt | Calibration required |
| P3 | Verify league playoff weeks and complete NBA schedule before accepting Playoff Planner | Verified future dates required |
| P4 | Review news-source ingestion, episode evidence and opt-in alert-delivery design; start no notification service absent approval | Reliability and delivery authorization required |

## QA / release limits

The feature branch is the only write target. Run `node --test`, isolated Chrome 401/422 and UI flows, and read-only authorized Preview API checks after each code change. Preserve anonymous Preview protection, verify current production deployment ID, and require separate release permission. Latest local test suite after this audit's source fixes: **196 total, 193 pass, 0 fail, 3 skipped**. Owner-signed-in end-to-end tests have **not** been run.

Changes in this audit were intentionally limited to identity ambiguity, Yahoo player-stat missing coverage, Z-score pool integrity, local forecast-ledger path behavior and HTTPS evidence URL validation. They do not claim that missing external source integrations are complete.

## P0/P1 verified source and readiness follow-up — November 23, 2026, afternoon PT

Current branch-only repairs and independent checks:

| Commit | Verified issue and narrowly scoped repair |
| --- | --- |
| `9c34d4b1746e30009d2e9bec019d4886b4e1cf20` | Yahoo official FG%/FT% category figures could disagree with published made/attempt pairs yet still pass. Added percentage/rate consistency checks; incomplete/contradictory shot pairs are rejected. If shot totals are absent the official score can still be read, but attempt-sensitive future projections must not treat that as shooting-volume evidence. |
| `9f396fbd2250cbeff977e8d1372b034ffeb40ae4` | Existing snapshot bridge returned `YAHOO_PLAYER_STATS` HTTP 200 with empty records but no explicit coverage completeness. It now returns `status=unavailable`, `coverage.complete=false`, full requested `missingIds`, and 0 returned; ESPN stats remain a separate labeled source. |
| `f4ba7517a6f852aa8139fc7da9e5e4c48a06ce82` | SC3 player profile did not distinguish persisted ESPN identity links from temporary corroborated public-profile matches. Introduced `profile.identityVerification` with persisted flag and source-specific label, displayed in player dialogue. No source ID was automatically stored. |
| `bbbe9a780054f1626debdfa331882967c1d671cd` | Injury alert candidate creation could duplicate the same episode/status across changing URLs and accept deceptive HTTPS URLs containing userinfo. Added episode/status event key and caller-provided prior-delivery suppression, with URL credential rejection. **No delivery enabled.** |
| `17a6541cb169a10932ce855b7fdaf8e0d2e32dad` | Introduced an offline held-out 9-CAT audit requiring original pre-week predictions, feature snapshots before issue time, post-week verified outcomes, exact nine categories per fixture and no duplicate IDs. Computes Brier score/log loss for **descriptive review only**, always `calibrated=false` / `actionable=false`. Test's synthetic 8-week/72-category QA sample is not a real calibration dataset or release qualification. |

### Independently checked missing Yahoo–ESPN identity

- Authorized Preview, `/api/auto-data?sc3Player=1&id=10452`, returned `espnId=5214640`, `identityVerification.source=YAHOO_PUBLIC_PROFILE_AND_ESPN_CATALOG` and `persisted=false`.
- Public Yahoo profile `https://sports.yahoo.com/nba/players/10452/` supports name **Kasparas Jakučionis**, Milwaukee and DOB **2006-05-29**. Official NBA profile `https://www.nba.com/player/1642857/kasparas-jakucionis/profile` confirms #25, Milwaukee and DOB; existing read-only `sc3.espn_player_identity` row for ESPN ID `5214640` matches name, team and DOB.
- Existing `sc3.sc3_player_identity` has **no persisted row for Yahoo 10452 or ESPN 5214640**. Public/runtime verification is available and clearly labeled, but a database insert is out of scope without a separately approved data-write workflow.
- This evidence does not prove that every other unmapped player is resolved.

### Remaining model / notification gates

- Latest observed Yahoo week 6 remains `HTTP 422`, `scoreVerified=false`; do not substitute previous week or convert absent values to zero. Matchup daily schedule/lineups remain separately available.
- Yahoo live per-player stats bridge for sampled 10452 and 10094 returns 0/2: **not** a complete source. Owner-authorized actual Yahoo player stat integration and live owner UI acceptance remain open.
- Alerts' `deliveredEventKeys` is an **input to a pure candidate evaluator**, not a persistent dispatch log. It requires a future authorized, idempotent delivery service and user opt-in; no automatic notifications are active.
- The calibration audit does **not** fit a model, confer a probability, or authorize Trade/Punt/Playoff moves. Production-calibrated historical records and temporal out-of-sample validation remain unavailable.

### Final verification

- Protected Preview commit `17a6541cb169a10932ce855b7fdaf8e0d2e32dad`: READY, Yahoo health HTTP 200 healthy, NBA health HTTP 200 fresh/0 missing days, Matchup Lineups HTTP 200 7/7, official Yahoo score HTTP 422 pending, player 10452 evaluation HTTP 200 with transient identity provenance, League Rosters 14 teams/206 players, streaming 0 verified FA/538 waivers.
- Local `node --test`: **206 tests / 203 pass / 0 fail / 3 skipped**; six isolated Chrome fixture smoke tests pass, syntax and diff checks clean. These are **not** live owner-authenticated browser acceptance.
- Production deployment ID remained `dpl_83LCXQgJ1R9sGoSciyxKAYG2eL9c`. No production changes, token/cookie access or renewal, fantasy transactions, database writes, or paid resources.


## 2026-11-23 — Owner-free P1 source readiness and outbox design follow-up

**Only committed code and documentation were changed.** No Supabase or public-table writes, OAuth/token/cookie access, Yahoo fantasy transaction, Production 2.0 modification, notification delivery, paid provisioning or scheduler creation.

### Focused changes and acceptance

| Commit | Acceptance |
| --- | --- |
| `bad7c48d42eb7d9c7def8b1f213bfc5141cb3371` | Yahoo player-stat loader reports `nineCatReady`, per-player missing/invalid canonical 9-CAT and shooting-volume keys; returned player IDs are **not** equivalent to model-ready performance evidence. Regression covers incomplete, complete and inconsistent percentage/attempt rows. No model activated. |
| `893e4361f55d39ecc5987f0426789fcca9a7486f` | Duplicate Yahoo player-stat ID rows in one batch cannot silently overwrite each other; ambiguous player source is discarded and a structured batch error returned. Regression first failed, then passed. |
| `faed942c119ca7964b868d1162c0b9b10116ddca` | [Approval-gated 10452→5214640 identity persistence packet](./sc3-10452-link-approval-2026-11-23.md). Read-only schema preflight confirmed both IDs unused, ESPN catalog name/MIL/DOB/jersey matching, unique Yahoo and ESPN indexes. **No INSERT executed**; owner approval required before exact one-row transaction. |
| `c8c197203c82931772f0c0c0e7de82351c925564` | [Pure offline alert outbox planner](./sc3-alert-outbox-design-2026-11-23.md) uses consent, scoped hashed subscriber/event keys, prior persisted-state suppression, failed-event hold and review-only output. `deliveryEnabled=false`; **no sender, storage writer or cron**. |
| `a27bb6adaf83081b5973341870986ba7f47b03ee` | 9-CAT heldout audit now rejects nonexistent ISO dates that JavaScript `Date.parse` silently normalizes, closing a temporal calibration leakage loophole. |
| `230111677abd44a0df9144662714a496c0c9f276` | [Proposed opt-in, atomically persisted outbox architecture](./sc3-alert-outbox-design-2026-11-23.md) documents state transitions, crash/retry caveats and required future approvals. |

### Live coverage and remaining gates

- Last protected Preview reported **READY** at commit `230111677abd44a0df9144662714a496c0c9f276`.
- Yahoo health **HTTP 200 healthy** and NBA health **HTTP 200 fresh**, no missing dates.
- Current official Week 6 9-CAT **HTTP 422 stats pending**, `scoreVerified=false`. Lineups **HTTP 200 7/7 days** but not score-calibrated.
- `live=1&playerStats=1&ids=10452,10094` returned HTTP 200 but `coverage.complete=false`, `requested=2`, `returned=0`, `missingIds=[10452,10094]`; ESPN linked performance is independently fresh, **not a Yahoo player-stat substitute**.
- League Rosters **14 teams/206 players**, Streaming **0 verified FA/538 waivers**.
- SC3 persisted mapping for Yahoo ID **10452** / ESPN ID **5214640** remains absent (0 conflicts on both IDs). Runtime public-profile matching has `persisted=false`.
- Isolated Node suite **215 tests, 212 passed, 0 failed, 3 skipped**; 6/6 Chrome fixture smoke tests pass; JS syntax and diff checks clean. **Owner-authenticated real browser testing remains undone.**
- Production deployment remained `dpl_83LCXQgJ1R9sGoSciyxKAYG2eL9c`; no promotion was performed.

### Gate status

**P0 blocked:** complete official Yahoo 9-CAT current-week scores and actual owner-authenticated browser acceptance.  
**P1 blocked:** genuine owner-authorized Yahoo live player-stat source, non-empty real verified FA samples, and separately approved 10452 one-row SC3 mapping.  
**P2/P3 blocked:** genuine pre-outcome historical calibration, official verified Yahoo playoff rules/future NBA schedule, and opt-in persistent alert/outbox service with provider idempotency. The new dry-run planner is **not** that service.
