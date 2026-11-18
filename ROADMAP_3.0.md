# Salary CAPtain 3.0 — Expanded implementation tracker

**Branch:** `feature/salarycaptain-3-expanded`  
**Production:** do not merge or deploy without explicit approval.  
**Target:** read-only, Yahoo-first fantasy decision intelligence for league 85892 / team 5.

## Provenance and release rules

- Yahoo Fantasy OAuth is the canonical source for league ownership, eligibility, matchup week, active roster, FAAB/FAB, acquisitions and official 9-CAT results.
- Public Yahoo pages may contribute *observed* matchup/roster data. Their selected week is not automatically certified as current.
- ESPN supplements NBA schedule, game logs and depth chart; an NBA appearance is **not** a fantasy lineup appearance.
- Missing/expired data is unavailable, not zero. Every proposed decision must be read-only until independently verified.
- Historical October 2026 samples are regression fixtures or explicit archives only.
- Keep the Vercel Hobby allowance of **12 deployable API functions**; put tests and reusable modules outside `api/`.

## Phase status

| Phase | Implementation | Acceptance gate | Status |
| --- | --- | --- | --- |
| 1. Source architecture | Dynamic public opponent, authenticated official scoreboard week/opponent + stat winner cross-check, public fallback, historical endpoint isolated | Authenticated end-to-end Yahoo session test plus owner token-refresh integration | **In progress** |
| 2. Player statistics | Shared Yahoo all-category statistics and batched player IDs; FA paging; ESPN completed-game collector, 1/3/7/14 windows, trends and volume-adjusted 9-CAT Z-score cores | Live Yahoo player stats verified for owned and FA players; durable daily game-log storage, identity mapping, complete date coverage, UI and Z-score pool integration | **In progress** |
| 3. Matchup / daily lineup | Current public and official Yahoo 9-CAT category tables, Category Swing foundation | Correct Yahoo start/bench/IL and lineup locks; calibrated probabilities | **In progress** |
| 4. Streaming and Keep/Cut | Pure streaming calendar with ownership guard; existing keep/cut core | Full FA coverage, games and add limits, 3/7/14 trends, verified injury feed | **Partial** |
| 5. Strategy | Pure trade-impact projection engine; existing FAB, punt, playoff and replacement-value algorithms | Real projections, matchup calibration and FAB/playoff boundaries | **Partial** |
| 6. Monitoring and UX | Data Health Monitor, authenticated snapshot inspection, read-only gating | Repeated job tests, deduplicated alerts, UI end-to-end tests | **In progress** |
| 7. Release | Isolated branch, preview builds and unit tests | All gates green, security audit, manual acceptance, single production release | **Not authorized** |

## Expanded features

1. **Category Swing Detector:** compares verified 9-CAT margins; uncalibrated category gaps cannot be compared across units; probabilities disabled.
2. **Streaming Calendar Optimizer:** ranks verified free-agent schedule opportunities; requires acquisition count and independently verified ownership; action disabled.
3. **Trade Impact Simulator:** computes attempt-weighted 9-CAT projected deltas only from complete projections; no proposed trades when inputs missing.
4. **Data Health Monitor:** authenticated Yahoo snapshot freshness in Sources; no OAuth credentials or cached payloads are returned.

## Unresolved blockers

- Official Yahoo scoreboard parser was matched to Supabase snapshot structure (week 5, Nov 16–22, opponent team 8) and synthetic fixtures; still requires authenticated end-to-end browser test. Anonymous 401 is expected.
- `/api/yahoo-matchup` uses Yahoo public matchup observation and labels the week unverified.
- Yahoo all-category player-stat API availability and response format still require an authenticated integration test; synthetic parser tests pass.
- Automatic FA pagination and all-player stat display are implemented; live authenticated pool coverage is not verified. NBA log collection, exact 1/3/7/14 appearance windows, performance trends and Z-score math are implemented and tested in isolation. Persistent incremental storage, daily scheduling, Yahoo↔ESPN player identity validation, complete history coverage and UI integration remain open.
- Injury return prediction ledger, FAB waiver transactions, lineup optimizer execution and fantasy win-probability calibration are not complete.
- Preview deployments are protected by Vercel Authentication. Local browser smoke tests passed without runtime JS errors, but protected preview and authenticated Yahoo workflows require separate end-to-end tests.

## Latest validation (Nov 17, 2026)

- 56/56 Node regression tests pass in isolated development checkout, including all-category Yahoo stats, game logs and Z-scores. A live ESPN collection on Nov 16 produced 8 completed events and 183 player-game records with no reported collection errors.
- Headless Chrome local mock-API smoke test: dashboard, optimizer and matchup load without JS errors; official-category fallback displays nine rows.
- Latest branch Vercel preview build READY; Hobby 12-Function limit respected after consolidating health into existing API.
- **No production release was made.**

## Quality gates

- `node --test` must pass without tokens/secrets.
- `node --check` all server JS/MJS files must pass.
- Every page must boot without browser runtime errors; every internal link must resolve.
- No static opponents, fixed historical weeks or fake category outputs in production-oriented APIs.
- All writable operations require explicit authorization and are out of scope for 3.0.
- Production release must be a separate authorized action after review of the draft pull request and a rollback plan.

## Player-performance core — current scope

`nba-game-logs.mjs` ingests completed ESPN box scores; `scripts/collect-nba-logs.mjs` supports incremental per-date collection into an isolated local cache, not an active production cron. `fantasy-zscore.mjs` requires explicit comparison-pool size and sufficient complete per-game stat coverage; no fantasy recommendation is generated from partial/unmapped data. The 1/3/7/14 windows count appearances, not calendar days. A full window is not proof of full source-history coverage; date continuity and upstream success must also be validated before recommendation use.
