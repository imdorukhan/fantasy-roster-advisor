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
