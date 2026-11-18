# Salary CAPtain 3.0 cutover and rollback

Preflight on 2026-11-18 Pacific.

| Item | Verified value |
| --- | --- |
| Project | `salarycaptain`, `prj_Ein05vKAOuJny0d1JRL1EvjNeuI7` |
| Live domain | `salarycaptain.vercel.app` |
| Current 2.0 and rollback target | `dpl_DHB7w5tEkGrmpNCU6aikffckGRhP`, commit `773d4dad2c6c4366e49d3157818d835ab1953c85`, READY and rollback candidate |
| Tested 3.0 application commit | `1f5d9d934a69b073a64a3e51227d1c26a53759a9`, READY preview `dpl_BQvXJ9UWKAUUYAp6qF5ZJ4bHjcW5` |
| GitHub SC3 and OAuth workflows | Passed for tested application commit |
| Restricted database role | `sc3_app`, four connections, reads SC3 snapshots and cannot read legacy public snapshots |
| Production SC3 setup | Missing `SC3_PRODUCTION_READS`, `SC3_SHARED_DB` and production-scoped `SC3_DATABASE_URL` |

## Before assigning traffic

1. Reconfirm the live domain, current 2.0 deployment ID and candidate commit. Keep the existing production Yahoo OAuth configuration. Set the three SC3 variables only in the Production environment, with `SC3_PRODUCTION_READS=1`, `SC3_SHARED_DB=1` and a sensitive connection string for the approved scoped database role. Keep `SC3_ISOLATED` disabled. Obtain the scoped credential through an authorized secret channel. Do not read preview OAuth credentials or copy browser session data.
2. Build the approved commit with `vercel deploy --prod --skip-domain`. A protected preview is evidence for application behavior and does not substitute for a production-target build. Confirm that the staged deployment is READY and that the live domain still resolves to 2.0. Use the staged host for basic startup and deployment protection checks. A host-bound owner session must be verified on the canonical domain after traffic assignment.
3. Check that Yahoo and NBA jobs have recent successful runs, or establish fresh SC3 reads before proceeding. At preflight all three SC3 schedules were enabled and no unattended run had been recorded. The previous on-demand syncs were verified.
4. Assign traffic only after explicit release approval. Promote the exact staged production deployment as opposed to relying on a Git branch push.

## Canonical-domain acceptance

- Confirm the main page and optimizer route showed the intended deployment and return HTTP 200.
- In the existing owner Chrome session, verify HTTP 200 for the SC3 streaming, matchup lineup/projection and official Yahoo matchup endpoints. Inspect Streaming Optimizer, Waiver Watch and Matchup Optimizer.
- In an independent anonymous client, check HTTP 401 and no data for all three private reads. Confirm private, no-store caching and an unchanged legacy Yahoo owner sign-in.
- Confirm current league and week, freshness, and no repeated 503 responses. A verified empty free-agent list is a valid result. An unavailable week-end figure is valid when the app identifies the coverage or schedule reason.

## Rollback

If canonical-domain authentication, data privacy or a core SC3 read fails, point production back to `dpl_DHB7w5tEkGrmpNCU6aikffckGRhP` with `vercel rollback dpl_DHB7w5tEkGrmpNCU6aikffckGRhP` or the Vercel rollback action for this project. Verify the public domain serves 2.0, the home page returns HTTP 200 and the existing Yahoo session works. Preserve SC3 database data. Check production auto-assignment status after rollback before any subsequent release.

During preflight, production environment settings and domain assignment were left unchanged. There was no staged production build, promotion or rollback execution.
