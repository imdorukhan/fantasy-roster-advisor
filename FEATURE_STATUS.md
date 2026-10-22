# Salary CAPtain 2.0 — Implementation Status

## Verified deployment
- Dashboard: https://salarycaptain.vercel.app/
- Optimization Lab: https://salarycaptain.vercel.app/optimizer.html
- Git source: `imdorukhan/fantasy-roster-advisor`, branch `main`
- The deployment uses automatic GitHub → Vercel builds.

## Data integrity
The data currently available is a dated roster snapshot from October 22, 2026 and screenshots of Yahoo waiver/add counts. **This is not a live Yahoo data feed.** Yahoo Fantasy API read access approval has not been confirmed. Do not label any imported player as a verified free agent unless live Yahoo ownership has been verified.

`optimizer-core.mjs` requires source, observation time, distinct player IDs, positive valid projections and a schedule. Its `actionable` gate additionally checks recency, independently verified Yahoo ownership, schedule and projections. Human approval remains mandatory. Importing JSON in the web app does not transmit data or write to Yahoo.

## Feature stages

| Feature | Current status | Next external data needed |
| --- | --- | --- |
| 1. Verified data ingestion | Manual JSON input and provenance/freshness validation built | Yahoo OAuth, NBA schedule and game stats, update scheduler |
| 2. Daily optimal lineup | Position-constrained calculation built; web display | Verified active statuses and current game schedule |
| 3. Smart streaming | Read-only candidate pair calculation built | Live FA ownership, remaining adds, game projections |
| 4. Matchup win probabilities | Category-margin model built; web display | Current opponent matchup, calibrated uncertainty |
| 5. Injury-aware keep/cut | Drop-risk and injury report crosscheck built | Current three-game box scores + verified injury source feed |
| 6. Replacement value | Read-only streaming pair comparison built | Position eligibility, reliable category projections |
| 7. FAB planning | Budget ceiling heuristic built and viewable with input | Current Yahoo FAB, remaining weeks, past bid history |
| 8. Breakout detector | Minutes increase signal built and viewable with input | Recent games, role/usage indicators |
| 9. Punt simulator | Expected retained-category wins calculator built | Alternative roster projections; reoptimization not yet automated |
| 10. Playoff planner | Playoff game-count comparison built | Verified postseason week dates, schedules, rests |
| 11. Prediction accuracy | Mean absolute error for verified outcomes built | Append-only historical forecast ledger + official results ingestion |
| 12. Smart alerts | Scoped candidate alert filtering and separate ChatGPT injury watch exist | Automated authenticated feed sync, dedupe and delivery integration |

## Tests

Run in Node.js 22+:
```powershell
node optimizer-core.test.mjs
node strategy-core.test.mjs
node drop-risk.test.mjs
node injury-drop-crosscheck.test.mjs
node injury-scope.test.mjs
node rules.test.mjs
node ownership.test.mjs
node scenario.test.mjs
```

The frontend's ES module syntax can also be checked with `node --check` after extracting its inline module script.

## Safety and limitations
- No add/drop, waiver claim, bidding or other Yahoo write operations.
- No recommendation is executable until ownership, eligibility and add counts are verified.
- Three-game slumps are **signals**, not sufficient grounds alone to release valuable players.
- Injury reports that coincide with a slump indicate possible temporal association, **not proven causality**.
- Confidence/probability values are model results, not factual game outcomes. Uncertainty is not calibrated to this league yet.
- The web dashboard is not yet connected to a persistent database, OAuth or a live sports-feed collector.
