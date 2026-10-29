# Fantasy Roster Advisor

A private, non-commercial, single-user decision-support tool for Yahoo Fantasy Basketball.

## Project status

Early read-only prototype. Yahoo Fantasy Sports API approval is pending. This application does not modify rosters, add or drop players, place waiver claims, or submit trades.

## Intended use

- Read authorized fantasy league settings, player roster, matchups, and available free agents.
- Analyze strengths and weaknesses under the league's scoring rules.
- Produce explainable player add/drop and streaming recommendations for manual review.
- Keep all personal account data and OAuth credentials local; never publish retrieved Yahoo data.

## Technology

Node.js 24+; official Yahoo Fantasy Sports API over OAuth 2.0 (pending approval).

## Getting started

1. Obtain Yahoo Fantasy Sports API read-only approval at https://sports.yahoo.com/developer/access/ .
2. Complete local OAuth setup (not yet implemented in this prototype).
3. Set the short-lived OAuth access token in your local environment as `YAHOO_ACCESS_TOKEN`.
4. Run `node bot.mjs` on your own computer. Without a token it safely reports `SETUP_REQUIRED`.

## Safety

Read-only by design. No write operations. Never commit secrets or player/account snapshots. Recommendations will require explicit manual review.

## Audience

One personal user, one Yahoo Fantasy NBA league (league ID 85892, team ID 5). Not public-facing and not monetized.

## Disclaimer

Independent personal project, not endorsed by or affiliated with Yahoo. Access and permitted uses are subject to Yahoo's approval and developer terms.

### Yahoo connection and access checks

Start owner enrollment at `/api/auth/yahoo/setup` with the private setup code. A plain
`/api/auth/yahoo/login` request redirects there instead of starting an enrollment
that cannot finish. Setup explicitly requests `fspt-r`, fresh consent and PKCE.

For a read-only access test, open `/api/auth/yahoo/login?diagnostic=1` and complete
Yahoo authorization. Its callback exchanges the code, checks NBA game metadata
and the authenticated Fantasy user independently, then returns only HTTP statuses
and fixed error classifications. It does not bind an owner, save tokens, create a
session, or return user data. A successful diagnostic is not a completed setup.
Normal setup still requires the setup code and verifies the enrolled owner.

On a Fantasy identity failure, setup performs the same independent game check.
Raw upstream bodies, authorization codes, GUIDs and credentials are never included
in diagnostic responses or logs. Run `node --test api/auth/yahoo/oauth.test.mjs` to
verify this flow, including successful encrypted session storage and failure cases.

## Recommendation engine (offline testing)

Run `node engine.test.mjs` to verify the category evaluator without Yahoo API credentials. The `rankMoves({roster, agents, config})` function accepts explicit player stat projections and remaining games. It calculates weighted nine-category deltas (including team-level attempt-weighted FG% and FT%), excludes protected drops and waiver-only additions, and returns read-only, approval-required recommendations.

**Limitations:** All projections, category weights and league settings must be provided and verified. The current tests use invented players and do not represent actual Yahoo roster or free-agent data. No OAuth flow, automated scheduling, transaction execution, or approval interface has been implemented yet.

## Verified Game of Trolls league rules (October 2026)

The league settings supplied by the team manager are recorded in `league.config.json`: 14-team H2H nine-category (FG%, FT%, 3PM, PTS, REB, AST, STL, BLK, TO); seven weekly acquisitions, unlimited season acquisitions; daily-today deadlines; continuous FAB waivers with daily processing; two IL slots and Yahoo can't-cut restrictions.

`rules.mjs` wraps the offline ranking engine with a weekly transaction-limit guard, a fail-closed can-cut check, and a separate FAB waiver watchlist. Run `node rules.test.mjs` for guardrail tests. All simulated category target scales remain estimates and must be recalibrated before real recommendations. Yahoo's actual waiver clearing, FAB balances, acquisition counts, eligibility and roster/player statuses must be verified via authorized league data. Nothing submits transactions.

## Injury Return Radar (prototype)

The independent `injury-radar.mjs` evaluator compares externally supplied, timestamped injury reports against a **live-Yahoo-verified** player availability signal, 14-day estimated return horizon, value thresholds, and the historical 14-team roster snapshot. Run `node injury-radar.test.mjs` for offline tests.

Source hierarchy: [NBA official injury reports](https://official.nba.com/nba-injury-report-2026-27-season/) and team announcements (participation and confirmed updates), [ESPN](https://www.espn.com/nba/injuries), [CBS Sports](https://www.cbssports.com/nba/injuries/), Rotowire, and reputable beat reporters. Game status is not a confirmed return date; estimates must retain their attribution and uncertainty. Source disagreements force a watch-only result. Results are non-executable and require review.

**Not yet implemented in this repository:** automated licensed source ingestors, persistent source-change history, current Yahoo FA/waiver ownership access, verified projections, or a running notification daemon. A separate scheduled ChatGPT injury-news watch can send informational alerts; it does not establish Yahoo ownership or execute transactions. Respect each publisher's terms, robots and licensing requirements before automating collection.

## Injury Return Radar — scoped

Only two sets of players may appear: the manager's Salary CAPtain roster, and players whose **current Yahoo free-agent status has been verified**. Other managers' rostered players, waiver-only players, and unknown ownership are not alert targets. Snapshot-based own-team identification is provisional until refreshed.

The injury return module accepts sourced reports; it does **not yet fetch Yahoo, NBA, ESPN, CBS, or Rotowire feeds automatically**. Alerts and category values require up-to-date source inputs. All suggestions remain manual-review-only.

## Source reliability / immutable evidence ledger

`source-reliability.mjs` records a forecast with its original source URL, publication date, predicted return date, player and injury-episode ID. Following a **verified actual game appearance**, `settleForecast` records actual date and evidence. Reports are scored with mean absolute error in days, fraction of first forecasts within ±3 days, and a smoothed, sample-size-adjusted provisional confidence (20 episodes minimum before flag clears). Multiple updates for the same source/player/injury episode count **only the first forecast**.

Windows local persistence is provided by `injury-ledger.mjs`, which writes to `data/injury-forecast-history.local.json` (excluded from Git). Usage:
- `node injury-ledger.mjs show`
- `node injury-ledger.mjs forecast forecast.json`
- `node injury-ledger.mjs settle forecastId outcome.json`

`forecast.json` must include `forecastId,source,player,injuryEpisodeId,publishedAt,predictedReturn,url`. `outcome.json` must include `actualReturn,actualEvidence,verifiedAt` (all dates YYYY-MM-DD). This is an audit trail for future verified inputs, not a claim that historic source predictions have already been collected. Run `node injury-scope.test.mjs`.

## Drop Risk / Keep-or-Cut (offline prototype)

`drop-risk.mjs` ranks **our own roster only** by the last three *played* NBA games versus a verified longer-term per-game baseline across the nine league categories. FG% and FT% calculations use makes/attempts (not naive averages), and turnovers are reversed. Injury, minutes restriction, short sample size, Yahoo can't-cut restrictions and star/keeper protection prevent a three-game slump from being treated as an automatic drop. `DROP_REVIEW` requires verified fringe/streamer role and can-cut status, plus a human review and a real replacement comparison before any roster action. Run `node drop-risk.test.mjs` to test. There is **no live Yahoo or NBA box-score ingestion yet**, so no actual players have been scored with this module.

## Injury-aware Keep-or-Cut

`injury-drop-crosscheck.mjs` combines `rankDropRisk` with source-attributed injury reports. It compares reported injury timelines against each player's most recent three **dated** games and outputs `INJURY_REVIEW` instead of `DROP_REVIEW` when evidence suggests a possible link. It distinguishes corroborated reporting from a single secondary source, includes dated URLs, and never asserts medical causation. Run `node injury-drop-crosscheck.test.mjs`.

Inputs must contain actual box scores with game dates and properly attributed injury reports; **the scraper/feed ingestion is not implemented yet**. Missing news is not evidence of health. No roster transaction is executed, and any eventual recommendation requires verification of current ownership, roster restrictions and a real replacement.

## Deployment

Production dashboard: https://salarycaptain.vercel.app/ . The intended production branch is `main`; Git-connected deployments should be verified in the Vercel project deployment history.

## Public matchup fallback

`/public-matchup.html` fetches `/api/public-matchup` on demand. The server reads public Yahoo league 85892/team 5 matchup and both current roster pages, discovers the opponent from the category table, and compares all nine observed categories (lower TO wins). Yahoo remaining-game counts are observations, not guaranteed future starts. NBA.com schedule is cross-checked with ESPN scoreboard when accessible; failed/changed/blocked sources are labeled, with single-source or conflict status retained. ESPN game scores are not Yahoo category totals. Scheduled game scores remain unknown. Player box-score/stat cross-validation and reliable projections are still pending.

No OAuth access is implied. Public observations do not verify free agents, waiver status, can-cut rules, remaining acquisitions or FAB balance, and are never promoted to `liveYahooVerified`. The endpoint accepts GET only and returns `private, no-store`; neither raw HTML nor roster snapshots are committed. Refresh failures clear displayed scores rather than re-labeling stale data as current. Source timestamps indicate retrieval, not publisher update times. The dashboard is public: this view uses only anonymously accessible Yahoo information. No transactions occur.

Run `node --test *.test.mjs`. Live verification can run `node --input-type=module -e "import {ingest} from './matchup-data.mjs'; console.log(await ingest())"` locally; do not commit the output. Vercel serves the `.mjs` API route with its Node runtime.
