-- Apply after sc3_yahoo_availability_snapshots.sql.
-- Verified on 2026-11-17 Pacific: Yahoo FA returned 0 and Yahoo W returned 539
-- distinct players over 22 pages. All 175 earlier status=A samples matched W.
-- Zero matches between the waiver list and the 205 stored rostered player IDs.
-- An explicit empty FA result is a successful observation.
alter table sc3.yahoo_league_snapshots
  drop constraint yahoo_league_section_check,
  add constraint yahoo_league_section_check check (
    section in ('settings', 'teams', 'standings', 'scoreboard', 'roster',
      'all_rosters', 'available_players', 'free_agents', 'waivers')
  );
