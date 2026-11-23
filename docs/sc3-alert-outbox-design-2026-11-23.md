# SC3 Injury Alerts: idempotent outbox design (NOT ACTIVATED)

**Scope:** Existing feature branch only. No database table, sender, cron, recipient, paid service, or fantasy operation created.

## Implemented and tested

- `strategy-core.mjs` produces review-only alert candidates from live-verified Yahoo ownership and timestamped source assertions. For known injury episodes, the event key is `playerId|injuryEpisodeId|injuryStatus`.
- `sc3-alert-outbox.mjs` is a **pure dry-run planner**, not a sender. Its SHA-256 key includes league `85892`, team `5`, subscriber ID, channel, and event key. It deduplicates candidates and caller-supplied persisted states, requires consent for proposing review items, suppresses prior `sent`, `pending_review`, `sending`, `failed`, or `suppressed` records, and **never retries failures automatically**.
- Every proposal has `sendAllowed=false` and `requiresApproval=true`; all results have `deliveryEnabled=false`. Source URLs must be HTTPS with no embedded username/password. A source assertion is **not independent content verification**.
- The pure planner's `existing` parameter simulates persistent state. Without an atomic database writer it does **not** guarantee idempotency across processes or deploys.

## Approval-gated production architecture (proposed, not implemented)

1. **Private outbox schema:** `sc3.alert_outbox` (not created) with SHA-256 `idempotency_key` unique, subscriber/league/team, event key, player, episode, status, channel, source, observed time, consent version, reviewer, state, retries, provider key, receipt, and timestamps. Recipient addresses should remain in a separately authorized, access-controlled store. Avoid exposing `sc3` through public APIs.
2. **Atomic event acquisition:** Store a pending event with `INSERT ... ON CONFLICT DO NOTHING RETURNING`; claim it under transaction/lease, checking current opt-in, current verified Yahoo ownership, independent source provenance, fresh data and manual review.
3. **Sending:** Only after user opts in, recipient is verified, source is independently checked, and a stop switch is tested. Use a provider's native idempotency support; record receipt before treating an event as sent. If a crash happens after send but before ack, reconcile with provider. Do **not claim exactly-once delivery** without provider support.
4. **Suppression and safety:** Ignore unchanged statuses, duplicate articles, empty reports and ambiguous injury episodes. Different statuses generate distinct keys. A failed delivery is held for explicit review; never auto-retry. Revoking consent stops all future sends. Yahoo add/drop/waiver/trade operations are always forbidden.
5. **Acceptance:** Race/crash tests, tenant isolation, replay tests, protected owner UI, retention/privacy review, opt-in, independent NBA injury-report evidence, no secrets in logs, and separate approval for all DB writes, scheduling and possible spending.

**Current result:** Only deterministic planning and tests. No notification is active or scheduled.

Related: [source calibration gates](./sc3-source-calibration-alert-gates-2026-11-23.md), [SC3 acceptance report](./sc3-feature-acceptance-2026-11-23.md), [issue #7](https://github.com/imdorukhan/fantasy-roster-advisor/issues/7).
