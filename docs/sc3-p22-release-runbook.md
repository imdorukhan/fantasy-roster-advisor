# SC3 P2.2 release runbook — NOT ACTIVATED

Scope: Yahoo NBA league 85892/team 5 only. Production remains on the P1 commit.
No migrations, login, secrets, cron registration, or paid resources have been
created by this branch. Protected Preview is read-only.

## Before owner-approved rollout

1. Verify the exact PR head, complete CI including disposable PostgreSQL, the
   protected Preview read-only API, real official PDF and seven-model coverage.
   Keep the previous production deployment as rollback target.
2. Review PostgreSQL grants and schema exposure. Apply the proposed migrations
   in order: sc3-p2-return-ledger.sql, sc3-p21-matchup-ledger.sql,
   sc3-p22-evidence-ledger.sql. Verify append-only triggers and RLS. No existing
   Yahoo snapshot migration or backfill is required. The old history has no
   source column; use it only to discover closed week targets.
3. Separately provision a NOINHERIT dedicated LOGIN sc3_p2_runner with membership
   in NOLOGIN sc3_p2_writer (ability to SET ROLE, no admin option). No access to
   OAuth sessions, public schema tables, or legacy history. Verify the role and
   privileges in a separate controlled test before enabling anything. Put its
   connection URL in SC3_P2_WRITER_DATABASE_URL as an encrypted production-only
   setting. Never reuse SC3_DATABASE_URL or service role credentials.
4. Deploy with SC3_P2_READ_ENABLED, SC3_P2_COLLECT_ENABLED and
   SC3_P2_COLLECT_WRITE absent/0. Verify owner and anonymous access. Optionally
   enable READ only after migration and owner approval. Never enable Preview
   writer. Confirm the existing four Vercel cron schedules are unchanged.
5. After explicit approval, enable both collection flags and register one daily
   GET /api/auto-data?sc3P22Collect=1 using the existing CRON_SECRET and a
   supported free-plan cron slot after NBA/scoreboard refresh, before games.
   Proposed 16:00 UTC (08:00 PST / 09:00 PDT); confirm plan capacity and timing
   before registration. No extra paid service. If the free plan cannot support
   it, leave the schedule disabled and request an alternative approval.
6. Validate first real collection: current source observation times, NBA
   non-submission counts, CBS lower-bound rows, all seven versioned models
   only when complete verified starter coverage exists, exact completed Yahoo
   week query /scoreboard;week=N, counts and database readback. A missing
   forecast or final remains unavailable/pending, never synthesized.
   Deduplicate report/forecast digests. Only compare CBS bounds with first
   verified post-capture NBA appearance, and never treat pending as correct.
7. Monitor source outages, role errors, coverage and repeated no-data runs.
   Only alert on material changes/failures. Weekly calibration requires
   independently captured settled weeks; no forecast promotion from a tiny or
   retrospectively selected validation period.

## Stop / rollback

First disable both collection flags and remove only the P2 cron; revoke
dedicated writer login membership if needed. Disable P2 reads. Roll back the
app to the verified P1 deployment. Preserve immutable ledger records rather
than deleting them. Do not disable existing P1 cron jobs. Review corrections
to final Yahoo results separately; never edit prior forecasts/settlements.

## Known limitations

Current week is not finished. Legacy snapshots cannot prove historical final
provenance. Official NBA statuses apply only to the specific reported game;
the source may not have submitted a team report yet. CBS lower bounds and ESPN
point estimates are different metrics. Seven weighted empirical simulations
are conditional on verified starters, not calibrated matchup probabilities.
Model promotion thresholds are an operational conservative policy, not
statistical significance or proof of performance.
