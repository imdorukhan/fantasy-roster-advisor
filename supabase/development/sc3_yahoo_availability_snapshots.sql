-- 2026-11-17 Pacific. Verified against the existing Yahoo OAuth session in Chrome.
-- all_rosters stores a complete snapshot only when all 14 teams are present.
-- available_players stores Yahoo's status=A results with explicit coverage metadata.
-- A partial snapshot or missing per-player ownership cannot establish add eligibility.
-- Live verification: 14 teams / 205 distinct rostered players, 7 pages / 175
-- distinct availability results, no overlap, and two history rows confirmed.
-- The live route caps the last requested offset at 150. Coverage is incomplete.
-- SC3's existing database privileges and row-level policies apply to both sections.

alter table sc3.yahoo_league_snapshots
  drop constraint yahoo_league_section_check,
  add constraint yahoo_league_section_check check (
    section in ('settings', 'teams', 'standings', 'scoreboard', 'roster', 'all_rosters', 'available_players')
  );
