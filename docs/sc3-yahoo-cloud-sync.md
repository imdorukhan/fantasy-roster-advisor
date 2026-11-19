# Full Yahoo cloud synchronization

Activation on 2026-11-19: the production configuration registers only the full-sync cron at `30 16 * * *` UTC (08:30 Pacific in winter, 09:30 in summer; Hobby has hourly precision). The legacy five-section cron and temporary access diagnostic are removed. Production enable/write flags are configured for the new deployment. The existing Yahoo automation becomes a read-only results monitor at 09:35 America/Los_Angeles. The earlier preparation/activation procedure below documents the prerequisites and original staging sequence.


Target: Yahoo league **85892**, Supabase **bmsfbcuausbfzheufjtc**, private **sc3** schema.
This branch reuses the existing API function (no additional Hobby function slot) and prepares `/api/auto-data?sc3YahooSync=1`. It does not deploy production,
install schema, change OAuth settings, register a cron, or change existing automations.
The earlier Windows Yahoo daily automation is paused. This is not evidence of a
successful replacement schedule or a completed live full sync.

## Coverage

Each run collects all 14 exact team keys `478.l.85892.t.1` through `.14`, plus all
official Yahoo league player-list pages for explicit `status=FA` and `status=W`.
The list collector remains the source for ownership: no switch to API availability
semantics, no status=A approximation and no inferred NBA team/eligible positions.
It also reads settings, teams, standings and scoreboard, and reuses team 5's fresh
roster response for the existing single-roster section. No stats enrichment or
Yahoo roster transactions run here. NBA logs and ESPN Depth Chart are separate jobs.

Every page must return HTTP 200 without redirection. Offsets advance by 25;
duplicate IDs, changed next-link query scope/sort, missing pagination markers or
incomplete terminal pages reject the run. Only an explicit “No players found”
page makes an empty filter valid. Source-supplied NBA team and position fields
are retained; absent fields stay absent. Expected positions: PG, SG, SF, PF, C.
No historical player total is a threshold.

Two complete observations must agree on membership, roster slots, status, NBA
team and eligible positions. This reduces changes during pagination; Yahoo does
not provide a transaction spanning those source requests. It cannot prove that
the upstream league remained unchanged between every request. Default ordering
is Yahoo's own: effective Next-link parameters are recorded and frozen after the
first link; no rank ordering absent from the source is claimed or invented.

## Storage and failures

No network requests occur inside the write transaction. After validation, the
scoped PostgreSQL client takes `pg_advisory_xact_lock(85892, 3)`, checks that every
observation is strictly newer, then upserts all eight sections with RETURNING.
The returned payloads and timestamps feed history inserts in the same SQL
statement/transaction. Missing returned rows or a history insert failure rolls
back the transaction. User/source strings use PostgreSQL parameters.

Only `sc3.yahoo_league_snapshots` and `sc3.yahoo_league_snapshot_history` receive
snapshot writes. The existing application Yahoo session loader and coordinated
renewal run server-side; valid authorization remains a prerequisite and renewal
may update its existing encrypted session store. Operators must not inspect token
values or bypass expired/revoked authorization. No new OAuth configuration is used.

An independent read-only transaction verifies exact batch timestamps/payloads,
counts, zero group overlap, and matching history. Semantic comparisons exclude
observation time and response order for ownership. NBA team and eligible-position
changes count as changes. Successful unchanged runs emit `notify:false`; the log
still records their result. Actual delivery/suppression belongs to the reporting
consumer, not this HTTP route.

If the COMMIT acknowledgement is lost, the route performs read-back without
repeating the write. A verified exact batch can recover PASS. Otherwise it reports
`committed:null` and `snapshotWrites:null`, because preservation cannot be asserted
after an ambiguous acknowledgement. A post-commit read-back failure is a real
failure report but does not undo an already committed complete batch.

## Activation prerequisites

1. Review the PR and the earlier shared-renewal PR #4. This branch includes that
   prerequisite and is based on commit `837f8fd`.
2. Confirm live server Yahoo access/renewal and official HTML player-list access.
   Fixture tests and the first-page diagnostic do not verify full live access.
3. Use the existing approved server auth environment and scoped SC3 database
   connection. `SC3_SHARED_DB=1` is required; the existing connection validator
   requires `sc3_app`, the fixed project and no public-table access. This does not
   reuse a Supabase service-role key for snapshot writes.
4. Set `SC3_YAHOO_FULL_SYNC_ENABLED=1` in the intended deployment. With no write
   flag, authorized GET runs a complete **dry run** (`VALIDATED`, zero snapshot
   writes), using the existing `Authorization: Bearer <CRON_SECRET>` header. Never
   put the secret in the URL. OAuth renewal can still occur during a dry run.
5. After reviewing that live result, separately activate
   `SC3_YAHOO_FULL_SYNC_WRITE=1` and validate a real transaction/read-back.
6. Only then register the recurring caller for `/api/auto-data?sc3YahooSync=1`, verify the
   actual scheduled result, and retire redundant old callers. This PR deliberately
   leaves `vercel.json` and existing schedules unchanged, including the temporary
   earlier diagnostic cron pending its separate verification/cleanup.

The route requests a 300-second maximum and bounds collection to 180 seconds;
deployment duration/Fluid Compute entitlement must be checked before activation.
Long collections fail closed rather than saving partial progress. If the real
source routinely exceeds that budget, a checkpointed worker is a separate change.
Vercel legacy cron uses UTC and Hobby timing is hourly, so it cannot promise an
exact 08:30 Pacific run year-round. No paid resource is provisioned here.

Logs/HTTP responses contain aggregates only, not raw player data, OAuth values
or upstream error text. Successful history is durable; failed runs still rely on
runtime logs. A permanent failed-run ledger/notification consumer is separate
operational work, not silently installed by this preparation.

## Validation

Run `node --test`. For actual PostgreSQL transaction/concurrency tests, set
`YAHOO_REFRESH_TEST_DATABASE_URL` to a disposable local PostgreSQL server database
named `sc3_refresh_test`; the suite refuses non-local hosts and creates/drops its
own separate fixture database. Never point fixture tests at a hosted database.
GitHub CI supplies PostgreSQL 17. Tests cover full pagination, metadata retention,
cross-group duplicates, source changes, authentication, dry run, rollback, stale
writers, concurrent batches, exact read-back/history and ambiguous acknowledgements.