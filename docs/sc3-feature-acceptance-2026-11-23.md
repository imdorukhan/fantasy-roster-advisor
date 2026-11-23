# Salary CAPtain 3.0 — functional feature acceptance audit (2026-11-23)

**Scope:** GitHub branch `feature/sc3-reliability-20261123`, the existing Vercel project's branch-only protected Preview, and strictly read-only queries of existing Supabase project `bmsfbcuausbfzheufjtc`. Production 2.0 is not changed. No OAuth token/cookie reads, session renewal, fantasy transactions, paid services, or `public` schema writes.

## Verification strategy

- Real protected Preview read-only GETs through the authorized Vercel connection; unprivileged anonymous browser requests must remain protected.
- Separate isolated Chrome regression tests with synthetic fixtures for 401/422, navigation, player dialogs, roster stats, and free-agent sorting/filtering.
- Node.js `node --test`: **167 total; 164 pass, 0 fail, 3 skipped** after the last fix.
- Production anonymous smoke (31 safe interactions, 15 player modal opens) is *not* positive authenticated acceptance. The real Yahoo owner must sign in interactively; do not inspect or refresh their token.

## Verified live Preview endpoints and features

| Feature | Evidence | Status |
| --- | --- | --- |
| Yahoo league source of truth | `live=1&leagueData=1`, 15 own roster members, 14 league teams, 5 Yahoo snapshot sections | Working / latest snapshot |
| NBA source health | `sc3Health=1`, 34 days, 5,529 player game logs, 249 verified Yahoo↔ESPN links, `fresh=true`, 0 missing days | Working |
| My Roster | Yahoo membership plus 13/15 mapped complete ESPN season averages through 2026-11-22, labeled by provider and date; 2 missing remain unavailable | Repaired, verified by mocked browser / live API |
| Injury Radar | 4 live Yahoo injury-status flags in own roster; player evaluation read-only 200 | Existing flags working; actual return forecasting not verified |
| Keep / Cut | Read-only last-3 / trend workflow; 13/15 mapped ESPN histories | Partial: no unverified drop recommendations |
| Player profiles | Read-only `sc3Player=1` for owned, injury-flagged and waiver players; valid three-drop comparison GET | Working API / isolated modal coverage |
| League roster browser | `sc3LeagueRosters=1` 14 teams, 206 players, 0 errors; weekly adds 7/7 and $86 FAB available | Repaired, working |
| Streaming Optimizer | `sc3Streaming=1` HTTP 200, plan `available=true`, seven daily Yahoo/ESPN schedule windows | Repaired, working |
| Waiver Watch | 538 verified Yahoo waiver players, 538 evaluated, top 25 displayed | Working; category impact blocked pending official 9-CAT |
| Free Agents | Yahoo reports 0 verified free agents; no pickups can legitimately be ranked at this observation | Data-correct zero; future FA filter/sort regression fixed |
| Free-agent sorting | Isolated browser verified name A-Z, Yahoo eligibility position filter, and explicit missing ESPN depth-rank messaging | Repaired; rank/stat accuracy needs verified upstream data |
| Source Health | Yahoo `live=1&health=1` returns `healthy`, all 5 sections `fresh` | Working |
| ESPN depth chart | Existing `depthTeam=GSW` read returned 36 rows and `fresh=true` | Working API |
| Matchup Intelligence | League week 6 (Nov 23–29), owner team #5 vs opponent #2 verified | Working metadata; 9-CAT not yet published |
| Matchup Lineups | `sc3MatchupLineups=1&projection=1` HTTP 200; both teams (15 players each), all seven days Yahoo lineups and ESPN dates independently verified, `complete=true` | Repaired |
| Matchup score / projection | `officialMatchup=1` HTTP 422, `YAHOO_OFFICIAL_MATCHUP_STATS_PENDING`, `scoreVerified=false`; projection deliberately blocked | Blocked by unpublished Yahoo nine-category values |
| Public matchup scraper | `/api/yahoo-matchup` HTTP 503; never used to certify the current week | External source unavailable; no fabricated fallback |
| Yahoo live player stat API | Existing bridge returns zero Yahoo player-stat records; labeled unavailable | Limited upstream coverage; ESPN history used only when verified |
| Strategy / trade / punt / playoff / alerts / forecast accuracy | Existing core logic and partial UI stages in ROADMAP_3.0.md; live calibrated forecast and action requirements are not satisfied | Not accepted; requires verified source coverage and separate tests |

## Repaired in this audit session

1. `668a307ad37ac37830f03aca784634c46b0f1f4a` — weekly acquisition and schedule/waiver planning no longer require Yahoo 9-CAT scores. Score-dependent waiver impact remains blocked.
2. `b207645c7681a87e9964dc286583a4bb21c12656` — week-verified daily Yahoo team lineups and ESPN schedule checks work without scoring values; no invented score projections.
3. `f2ae390904c5d66b29c60b360d9851e199141c70` — 13/15 verified own-roster ESPN season averages can populate 9-CAT presentation with clear provider/date provenance; insufficient histories remain blank.
4. `2b8878a185a71e41e08ce00d712dff31c6a1a633` — verified SC3 FA mode now obeys name sort and Yahoo eligible-position filtering; unavailable depth/stat rankings are explained, not silently presented as verified.

## Remaining dependencies and next acceptance gates

1. **Owner-authenticated UI:** user signs in interactively on the canonical domain (no shared passwords or tokens). Verify all private routes, player dialogs, 3-drop comparisons, search and filters in an owned session, without fantasy transactions.
2. **Official 9-CAT values:** when Yahoo publishes all nine nonempty category totals and stat winners for Nov 23–29, verify exact league/week/team/opponent/categorical winner score agreement before enabling scoring, win-probability or matchup impacts.
3. **Yahoo free-agent source:** on the day real FA records appear, re-test the rank/stat sort controls with verified ESPN depth and a complete stat source. Current zero is a legitimate source result, not a test fixture.
4. **2 unmapped ESPN identities:** verify with independent evidence; never guess a name-based player link.
5. **Predictive features:** injury recovery, trade, punt, playoff, calibrated category impact and forecast accuracy need a provenance-checked forecast ledger, complete statistics and a new positive browser acceptance suite before release.
6. **Release:** re-test private/anonymous gates, get explicit production approval, verify the rollback deployment and avoid promoting the Preview automatically.

Do not claim the app is fully repaired until the owner-authenticated and scored-week gates pass.


## Follow-up repairs and release-quality checks (November 23, 2026)

The original matrix above is a point-in-time baseline. The following later work has been committed on the same isolated branch:

| Commit | Change | Acceptance |
| --- | --- | --- |
| `b27e86796106a51134de7f7b9f72b4f11deca249` | Exact verified Yahoo→ESPN identity and NBA-team checks before showing full-depth ranks on any future free-agent row; invalid/stale/colliding ranks fail closed | Three pure regressions, synthetic Chrome position/rank filters, protected Preview `sc3Streaming=1` HTTP 200 |
| `4743eb2dd4e9dad9a91fbcf26e2fab7fd853a37c` | Injury Radar separates Yahoo roster injury flags and ESPN full-depth IL markers with read-only Refresh; neither source is a verified return-date forecast | Three injury evidence regressions; Chrome refresh flow; live Preview roster reports 4 Yahoo injury flags and 14/15 verified depth identities |
| `308092ef35ad6a4b26409abc14c2e5586bc99146` | Injury alert core refuses static October roster-name matches unless live Yahoo ownership is explicitly verified | Old behavior reproduced 2 false alerts; corrected regression passes |
| `d94efb5268ee41c4751fad8bd255decd72f3ff6e` | Keep/Cut last-three ESPN evidence requires fresh complete history with the expected latest day; Yahoo injury/IL flags visible; never makes a drop action | Three pure regressions, synthetic Chrome Keep/Cut and injury navigation, protected Preview READY |

### Consolidated checks

- Node suite: **176 tests, 173 passed, 0 failed, 3 skipped**. Six isolated, authenticated-fixture browser smoke scripts all passed (owner 401 handling, valid/expired official Yahoo matchup, current week with pending 9-CAT, optimizer auth, dashboard auth, roster/FA/waiver/injury/Keep-Cut navigation and refresh).
- JavaScript syntax check for repository JS/MJS sources completed without reported failures.
- Preview root, matchup, optimizer, public matchup and new module routes HTTP 200.
- Anonymous Preview private league-data request returned HTTP 302 to deployment authentication; **do not weaken this protection**.
- Live Preview Yahoo league roster is 15 players, league all-rosters 14 teams/206 players, waiver pool 538, available free agents 0. Consequently real ESPN depth rank coverage for future free agents is still untested against a nonempty live FA list; synthetic tests have checked it and the database contains verified ID links.
- Injury source evidence: 4 Yahoo roster flags; for those players the ESPN full-depth source has no IL marker. This **does not mean they are medically cleared**; all return dates remain unknown.
- Yahoo week 6 (Nov 23–29) is verified, but **all nine official category totals remain unpublished**, so `officialMatchup=1` returns safe HTTP 422 with `scoreVerified=false`. `sc3MatchupLineups=1&projection=1` returns HTTP 200 with 7/7 date coverage and score-dependent projection explicitly blocked.
- NBA health HTTP 200 fresh and zero missing dates; Production 2.0 deployment ID remains `dpl_83LCXQgJ1R9sGoSciyxKAYG2eL9c` at this check.
- No paid services or database migrations, no changes to `public` tables, no token/cookie reads or renewal, and no Yahoo fantasy transactions.

### Still not accepted (do not release automatically)

1. Owner-signed-in browser acceptance of the real protected league pages (user must complete Yahoo sign-in interactively); synthetic Chrome tests are not the same.
2. Publish and verify genuine Yahoo 9-CAT totals and category-winner cross-check before score, calibrated win probability, matchup impact or full projections can activate.
3. Wait for actual verified nonempty free-agent availability to test real depth ranking and player-stat sorting. Never infer ownership.
4. Confirm two unresolved Yahoo→ESPN player identities independently; do not guess a mapping.
5. Injury-return news, prediction confidence/accuracy ledger, trade/punt/playoff forecasts, and alerts are not fully production-ready. Separate verified-source and owner acceptance is required.
6. Promotion/rollback requires an explicit production release decision.

## Strategy, forecasts and alerts audit — continuation (2026-11-23)

**Scope:** Feature-branch source audit, isolated Node regressions, authenticated-connector protected Preview API reads, and local Chrome fixtures. No owner-authenticated browser acceptance was performed. No production updates, paid provision, OAuth/token/cookie reads, Yahoo fantasy transactions, or data writes.

| Area | Confirmed defect and repair | Commit | Remaining gate |
| --- | --- | --- | --- |
| Player Evaluation | Impossible FG/FT makes greater than attempts could produce FG% greater than 100%; incomplete net add/drop operands yielded NaN. Both fail closed. | `71b0f640b8f246ed87a7d39e78cbb609cc3abe17` | Live Yahoo/ESPN source consistency for all players; existing player profile API HTTP 200, but no 9-CAT projections without official score |
| Trade Impact | Baseline projections with impossible field-goal totals and outgoing projected stats exceeding roster totals were accepted. Validated before/after and shooting volumes. | `4501c8243a7229a7ff98aa3d94f69e25ae465147` | Pure read-only calculation only, **not** a live proposed trade or integrated calibrated matchup forecast |
| Punt Strategy | Any nine category names could be treated as nine official categories. Now requires exactly FG%, FT%, 3PM, PTS, REB, AST, STL, BLK, TO; returns no calibrated probability or actionable advice. | `447aed81b91ba7997ae274787ba71ae09a10b1e0` | Current Yahoo 9-CAT scores and verified, calibrated player-category scenarios |
| Playoff Planner | Duplicate ESPN rows inflated schedule counts; impossible dates and repeated IDs were accepted. Calendar scenarios now deduplicate and label their schedule *unverified*. | `49ff72376c8f3e9699378da54649a2796e49b88f` | Official Yahoo playoff weeks, complete future NBA schedules, lineup availability and fantasy matchup rules |
| Injury forecast accuracy | Invalid normalized dates were accepted and later settled revisions could be cherry-picked when the earliest episode forecast remained unsettled. Requires episode identity and scores the first recorded forecast only after verified outcome evidence. | `8892ea6a1b2790816b29c18ce0b8e64a4f56acf0` | External timestamped medical/news source verification, prospective ledger and real completed returns |
| Alert filtering | Old roster ownership, stale/undated news, duplicate events and conflicts across ownership scopes could produce candidate alerts. Now explicitly requires live Yahoo ownership, dated HTTPS source, unique candidate and human approval; delivery disabled. | `324dff811fe4169d414467d5c0f3e93dc6e7681b` | No running alert delivery/notification service was implemented or activated; owner acceptance and monitoring design still required |

### Latest verification

- **188 Node tests: 185 passing, 0 failing, 3 skipped.** Regression tests were intentionally observed failing before each fix.
- **Six isolated Chrome smoke scripts: six passed.** These exercise sign-in-required states and synthetic matched data; they are not equivalent to a real owner-signed-in browser session.
- Protected Preview at commit `324dff811fe4169d414467d5c0f3e93dc6e7681b` was **READY**. Root, Matchup Intelligence and Optimizer pages returned HTTP 200 via authorized Vercel connection.
- Yahoo health: HTTP 200 healthy; NBA health: HTTP 200 fresh, zero missing days; SC3 player evaluation: HTTP 200; League Rosters: HTTP 200, 14 teams; Streaming: HTTP 200, 538 waivers and 0 verified free agents; Matchup Lineups: HTTP 200 with 7/7 dates.
- Official Week 6 Yahoo matchup: **HTTP 422, `scoreVerified=false`**, because official 9-CAT category totals remain unpublished. Do not calculate current win probability or unlock score-based trade/punt projections from this.
- Anonymous protected Preview private API request: **HTTP 302** authentication redirect; do not relax this.
- Production 2.0 deployment remained **`dpl_83LCXQgJ1R9sGoSciyxKAYG2eL9c`** at the verification point.

**Release remains blocked** on owner-authenticated UI acceptance, official complete Yahoo week 9-CAT data, a non-empty verified FA pool for live ranking acceptance, verified source-linked injury-return reports, prediction calibration, and an explicit production-release decision.

## Source-integrity and calibration follow-up — 2026-11-23

See the detailed, evidence-separated audit: [SC3 source contracts, calibration and alert gates](./sc3-source-calibration-alert-gates-2026-11-23.md).

**Additional separate feature-branch commits:**
- `c37020443765c0a7f78369a20a3cd635a938f896`: a duplicated Yahoo ID can no longer be marked verified against two different ESPN identities. Current own roster has **14/15** verified identity links; Yahoo player **10452** remains unresolved; no guess was written.
- `bec8142f81569d74674e5024aa555a050bd14fdf`: Yahoo player-stat batches expose missing IDs and `complete=false` when an upstream HTTP 200 silently omits a requested player.
- `382723a5bd5d7560f6a7941544c3fe5dbd964f48`: Punt Z-score pools reject duplicate player IDs, invalid/duplicate categories and physically impossible `3PM > FGM` observations.
- `fa4b44642a78c4a0cdb21251cd360301eea2e0a2`: local injury forecast ledger can write safely to a nested custom path; no cloud notification was activated.
- `0efa509b026ad0d57b35e25ee0c0ea560e9c8afd`: sourced injury forecasts and verified outcomes require HTTPS evidence URLs before local ledger scoring; URL syntax alone is **not** independent verification.
- `415d0d63cb9acd7caedc60d50461470b36b81653`: explicit release-blocker and architecture document (link above).

**Read-only source verification:** Yahoo health 200 healthy; NBA health 200 fresh/zero missing dates; official Yahoo Week 6 score still 422 with `scoreVerified=false`; full lineup dates 7/7; league 14 teams/206 players; 0 verified FA and 538 waiver players. The SC3 database contains 249 verified Yahoo–ESPN identity links overall and 1,012 ESPN depth rows. These checks do **not** authorize promotion.

**Still not accepted:** owner-signed-in real browser flow, live complete Yahoo 9-CAT, all roster identity links, calibrated Trade/Punt probabilities, Yahoo-verified playoff date coverage, verified NBA injury-return forecasts and opted-in alert delivery. Do not change Production 2.0.

## November 23 P0/P1 source fixes and delivery safety

Continuation after `2576c94`; the full independent evidence and remaining release requirements are in [Source calibration and alert gates](./sc3-source-calibration-alert-gates-2026-11-23.md).

- `9c34d4b` corrected source mismatch acceptance: official Yahoo FG%/FT% values are checked against made/attempt pairs when present; contradictory or partial source rows are rejected by regression tests.
- `9f396fb` makes snapshot-only Yahoo player stat coverage explicitly unavailable (`complete=false`, missing IDs), instead of silently treating HTTP 200 as full player coverage.
- `f4ba751` labels verified-but-transient Yahoo 10452 → ESPN 5214640 separately from a stored `sc3.sc3_player_identity` link. Yahoo public DOB, ESPN catalog DOB/name/team and NBA official profile corroborate the identity. **No DB link was added.**
- `bbbe9a7` suppresses duplicate same-episode/same-status alert candidates and rejects URL credential-host confusion; notification sending remains off.
- `17a6541` adds strict, offline temporal holdout assessment for genuine nine-category forecast/observed results, including Brier and log-loss diagnostics; never marks a model calibrated or actionable.
- `f6be245` updates detailed verification requirements and source findings.

**Verification:** 206 Node tests (203 passed, 0 failed, 3 skipped), 6/6 isolated Chrome smoke scripts, clean syntax and diff checks; newest feature Preview READY. Yahoo official week 6 remains 422 stats pending, lineups 7/7 complete, NBA 200 fresh, Yahoo health 200 healthy, Yahoo per-player stats 0/2 incomplete, player 10452 identity verified at runtime but *not persisted*. No owner-authenticated browser acceptance has occurred. Production 2.0 unchanged.

**Blocking the next release:** Owner login and protected UI acceptance, official fully observed 9-CAT, owner-authorized complete Yahoo per-player stats, durable approved identity mapping, real chronologically held-out model dataset, Yahoo-confirmed playoff settings and explicitly opted-in injury alert delivery. None of these were simulated as successfully completed.
