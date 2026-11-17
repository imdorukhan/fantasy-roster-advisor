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
| 1. Source architecture | Dynamic public opponent, current matchup adapter, historical endpoint isolated, fresh category normalization | Authenticated week/opponent/category validation and account refresh integration | **In progress** |
| 2. Player statistics | Yahoo MPG parser using game stat categories and average_season; backend paging parameter | Live Yahoo MPG verified for owned and FA players; full pagination; 3/7/14 logs and all nine categories | **In progress** |
| 3. Matchup / daily lineup | Current public category table, Category Swing foundation | Correct Yahoo start/bench/IL and lineup locks; calibrated probabilities | **In progress** |
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

- Authenticated Yahoo current week and official scoreboard parsing must be validated against live session; anonymous 401 is expected.
- `/api/yahoo-matchup` uses Yahoo public matchup observation and labels the week unverified.
- Yahoo MPG API availability and exact response format need authenticated integration testing, despite synthetic parser tests.
- All-player FA pagination, roster MPG, 3/7/14 game log ingestion and automatic replacement/category projection feeds are not yet complete.
- Injury return prediction ledger, FAB waiver transactions, lineup optimizer execution and fantasy win-probability calibration are not complete.
- Preview deployments are protected by Vercel Authentication; synthetic/local browser checks do not replace authenticated staging end-to-end tests.

## Quality gates

- `node --test` must pass without tokens/secrets.
- `node --check` all server JS/MJS files must pass.
- Every page must boot without browser runtime errors; every internal link must resolve.
- No static opponents, fixed historical weeks or fake category outputs in production-oriented APIs.
- All writable operations require explicit authorization and are out of scope for 3.0.
- Production release must be a separate authorized action after review of the draft pull request and a rollback plan.
