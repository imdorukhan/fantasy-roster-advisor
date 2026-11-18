# SC3 production readiness

**Decision:** keep production on 2.0. This audit tested commit `2f1106480a642dbd3ca4c7d29105870e48a4b442` in the authenticated Vercel preview on November 18, 2026 Pacific.

| Check | Result |
| --- | --- |
| SC3 and Yahoo OAuth workflows | Passed |
| Windows Chrome Streaming Optimizer | Passed with a verified empty free-agent list, five-day schedule, and weekly acquisitions |
| Windows Chrome Waiver Watch | Passed with 539 verified waiver rows |
| Windows Chrome Matchup Optimizer | Passed with the fresh Yahoo matchup baseline and two-team scenario |
| Streaming, matchup projection and NBA health endpoints | HTTP 200; NBA health OK through November 17 |
| Anonymous preview request | HTTP 302; SC3 response unavailable without preview authentication |
| Production homepage | HTTP 200 on existing commit `773d4dad2c6c4366e49d3157818d835ab1953c85` |
| Production environment gate | Blocked. Local verification showed the Yahoo bridge rejects production even with both SC3 flags enabled |
| Unattended SC3 jobs | Enabled. No scheduled run was recorded at the time of the audit |

The verified live free-agent pool was empty, so the audit confirms the real empty-state flow. Positive streaming ranking is covered by regression tests.

The Yahoo bridge and SC3 optimizer routes currently rely on the protected preview. Production readiness requires an existing-owner authentication check, scoped database access, and deployment-specific tests for both authorized and anonymous requests. The public production domain must stay on 2.0 until the release gate passes and the release is explicitly authorized.
