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
