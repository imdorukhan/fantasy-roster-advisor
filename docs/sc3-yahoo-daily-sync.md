# SC3 Yahoo daily sync

The **SC3 Yahoo Daily Sync** automation runs daily at 08:30 America/Los_Angeles for Yahoo league 85892. It uses the existing authorized Chrome session on Windows for the official roster API and the repository's Yahoo league player list collector for the explicit free-agent and waiver filters. An explicit empty free-agent result is valid.

A run validates all 14 team IDs, complete filter pagination and disjoint player IDs before writing. It updates the three SC3 snapshots and their history in one transaction, using a league advisory lock and requiring each observation to be newer than its previous snapshot. A failed source or incomplete batch preserves the previous snapshot. The automation reports changes and failures.

The on-demand run on November 17, 2026 Pacific verified 14 teams, 205 rostered players, 0 free agents and 539 waiver players. All 23 Yahoo player-list pages returned HTTP 200. Database read-back reported zero cross-group duplicates and one matching history row for each of the three updated snapshots. This verifies the on-demand flow. The unattended daily schedule is enabled.

Production remains on 2.0. The scheduled sync requires the Windows device and authorized Chrome session to be available.
