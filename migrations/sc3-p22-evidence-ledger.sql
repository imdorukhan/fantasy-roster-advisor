-- P2.2 proposed migration; requires P2 and P2.1 migrations first.
-- Do not run against production or register a cron until owner approves.
begin;
create table sc3.p2_cbs_settlements(
 observation_id text primary key references sc3.p2_cbs_observations(id),
 event_id text not null check(event_id ~ '^[0-9]+$'),
 actual_date date not null,actual_tipoff timestamptz not null,evidence_observed_at timestamptz not null,
 settled_at timestamptz not null default clock_timestamp(),
 check(actual_tipoff<=evidence_observed_at and evidence_observed_at<=settled_at)
);
create table sc3.p2_official_injury_observations(
 id text primary key check(id ~ '^[a-f0-9]{64}$'),
 espn_id text not null check(espn_id ~ '^[0-9]{1,12}$'),
 game_date date not null,
 published_at timestamptz not null, observed_at timestamptz not null,
 document_digest text not null check(document_digest ~ '^[a-f0-9]{64}$'),
 source_url text not null check(source_url ~ '^https://(ak-static\.cms|official)\.nba\.com/referee/injury/Injury-Report_[0-9-]+_[0-9_]+[AP]M\.pdf$'),
 status text not null check(status in ('Out','Doubtful','Questionable','Probable','Available')),
 payload jsonb not null,captured_at timestamptz not null default clock_timestamp(),
 check(published_at<=observed_at and observed_at<=captured_at and observed_at-published_at<=interval '24 hours')
);
create table sc3.p2_yahoo_final_observations(
 id text primary key check(id ~ '^[a-f0-9]{64}$'),
 league_id integer not null check(league_id=85892),week integer not null check(week between 1 and 30),
 opponent_id integer not null check(opponent_id between 1 and 14 and opponent_id<>5),
 week_start date not null,week_end date not null,observed_at timestamptz not null,
 source text not null check(source='Yahoo Fantasy Sports API'),
 payload jsonb not null,captured_at timestamptz not null default clock_timestamp(),
 check(week_start<=week_end and observed_at<=captured_at and (observed_at at time zone 'America/Los_Angeles')::date>week_end)
);
create index p2_final_fixture_idx on sc3.p2_yahoo_final_observations(week,opponent_id,observed_at desc);
create trigger p2_cbs_result_immutable before update or delete or truncate on sc3.p2_cbs_settlements for each statement execute function sc3.p2_reject_mutation();
create trigger p2_nba_report_immutable before update or delete or truncate on sc3.p2_official_injury_observations for each statement execute function sc3.p2_reject_mutation();
create trigger p2_final_immutable before update or delete or truncate on sc3.p2_yahoo_final_observations for each statement execute function sc3.p2_reject_mutation();
create function sc3.p2_verify_cbs_settlement() returns trigger language plpgsql set search_path=pg_catalog,sc3 as $p22$
declare o sc3.p2_cbs_observations%rowtype;
begin
 select * into strict o from sc3.p2_cbs_observations where id=new.observation_id;
 if o.earliest_return is null or o.earliest_return<(o.captured_at at time zone 'America/New_York')::date or new.actual_tipoff<=o.captured_at or not exists(
  select 1 from sc3.sc3_nba_game_logs g join sc3.sc3_nba_sync_days d using(game_day)
  where g.espn_id=o.espn_id and g.event_id=new.event_id and g.game_day=new.actual_date and g.tipoff=new.actual_tipoff and g.observed_at=new.evidence_observed_at and (g.stats->>'MIN')::numeric>0
   and d.status='complete' and d.observed_at<=new.settled_at
 ) or exists(select 1 from sc3.sc3_nba_game_logs g where g.espn_id=o.espn_id and (g.stats->>'MIN')::numeric>0 and g.tipoff>=(o.report_date::timestamp at time zone 'America/New_York') and g.tipoff<new.actual_tipoff and g.observed_at<=new.settled_at)
 or exists(select 1 from generate_series(o.report_date::timestamp,new.actual_date::timestamp,interval '1 day') day where not exists(
  select 1 from sc3.sc3_nba_sync_days d where d.game_day=day::date and d.status='complete' and d.observed_at<=new.settled_at
  and d.player_rows=(select count(*) from sc3.sc3_nba_game_logs g where g.game_day=d.game_day)
  and d.completed_events=(select count(distinct event_id) from sc3.sc3_nba_game_logs g where g.game_day=d.game_day)
 )) then raise exception 'Unverified CBS return evidence';end if;
 return new;
end; $p22$;
create trigger p2_verify_cbs before insert on sc3.p2_cbs_settlements for each row execute function sc3.p2_verify_cbs_settlement();
create function sc3.p2_verify_matchup_final() returns trigger language plpgsql set search_path=pg_catalog,sc3 as $p22$
begin
 if not exists(select 1 from sc3.p2_matchup_forecasts f join sc3.p2_yahoo_final_observations a on a.league_id=f.league_id and a.week=f.week and a.opponent_id=f.opponent_id and a.week_start=f.week_start and a.week_end=f.week_end
 where f.id=new.forecast_id and a.observed_at=new.final_observed_at and a.observed_at>f.forecast_as_of and a.observed_at<=new.settled_at)
 then raise exception 'No archived final Yahoo observation'; end if;
 return new;
end; $p22$;
create trigger p2_verify_final before insert on sc3.p2_matchup_settlements for each row execute function sc3.p2_verify_matchup_final();
revoke all on sc3.p2_cbs_settlements,sc3.p2_official_injury_observations,sc3.p2_yahoo_final_observations from public,anon,authenticated,sc3_app;
grant select on sc3.p2_cbs_settlements,sc3.p2_official_injury_observations,sc3.p2_yahoo_final_observations to sc3_app,sc3_p2_writer;
grant insert(observation_id,event_id,actual_date,actual_tipoff,evidence_observed_at) on sc3.p2_cbs_settlements to sc3_p2_writer;
grant insert(id,espn_id,game_date,published_at,observed_at,document_digest,source_url,status,payload) on sc3.p2_official_injury_observations to sc3_p2_writer;
grant insert(id,league_id,week,opponent_id,week_start,week_end,observed_at,source,payload) on sc3.p2_yahoo_final_observations to sc3_p2_writer;
-- Writer never needs the private legacy snapshot history or OAuth tables.
revoke select on sc3.yahoo_league_snapshot_history from sc3_p2_writer;
-- RLS defense-in-depth: only named reader/writer group, no broad authenticated access.
do $p22$
declare t text;
begin
 foreach t in array array['p2_return_forecasts','p2_return_settlements','p2_matchup_forecasts','p2_matchup_settlements','p2_cbs_observations','p2_cbs_settlements','p2_official_injury_observations','p2_yahoo_final_observations'] loop
  execute format('alter table sc3.%I enable row level security',t);
  execute format('create policy p2_read on sc3.%I for select to sc3_app,sc3_p2_writer using (true)',t);
  execute format('create policy p2_insert on sc3.%I for insert to sc3_p2_writer with check (true)',t);
 end loop;
end; $p22$;
commit;
