-- PROPOSED MIGRATION. Do not execute on the shared production database during Preview.
-- Run in a separately approved environment as schema owner. Runtime writer
-- has INSERT/SELECT only. Administrative owners can always change a database;
-- this is append-only under application privileges, not cryptographic WORM.
begin;
create table sc3.p2_return_forecasts (
 id text primary key check (id ~ '^[a-f0-9]{64}$'),
 source text not null check (source in ('ESPN','NBA_OFFICIAL')),
 source_url text not null,
 check ((source='ESPN' and source_url='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries') or (source='NBA_OFFICIAL' and source_url='https://www.nba.com/players/injury-report')),
 espn_id text not null check (espn_id ~ '^[0-9]{1,12}$'),
 report_at timestamptz not null,
 feed_observed_at timestamptz not null,
 estimated_date date not null,
 status text not null check (lower(status) in ('out','day-to-day','doubtful','questionable')),
 captured_at timestamptz not null default clock_timestamp(),
 unique(source,espn_id,report_at,estimated_date),
 check (report_at<=feed_observed_at and feed_observed_at<=captured_at and captured_at-feed_observed_at<=interval '24 hours'),
 check (estimated_date >= (captured_at at time zone 'America/New_York')::date)
);
create table sc3.p2_return_settlements (
 forecast_id text primary key references sc3.p2_return_forecasts(id),
 event_id text not null check(event_id ~ '^[0-9]+$'),
 actual_date date not null,
 actual_tipoff timestamptz not null,
 evidence_observed_at timestamptz not null,
 settled_at timestamptz not null default clock_timestamp(),
 check(actual_tipoff<=evidence_observed_at and evidence_observed_at<=settled_at)
);
create function sc3.p2_reject_mutation() returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'P2 ledger is append-only'; end; $$;
create trigger p2_forecast_no_mutation before update or delete or truncate on sc3.p2_return_forecasts for each statement execute function sc3.p2_reject_mutation();
create trigger p2_settlement_no_mutation before update or delete or truncate on sc3.p2_return_settlements for each statement execute function sc3.p2_reject_mutation();
-- Settlement is accepted only against an existing recorded positive-minute game.
create function sc3.p2_verify_settlement() returns trigger language plpgsql set search_path=pg_catalog,sc3 as $p2$
declare f sc3.p2_return_forecasts%rowtype;
begin
 select * into strict f from sc3.p2_return_forecasts where id=new.forecast_id;
 if new.actual_tipoff<=f.captured_at or not exists(
  select 1 from sc3.sc3_nba_game_logs g join sc3.sc3_nba_sync_days d using(game_day)
  where g.espn_id=f.espn_id and g.event_id=new.event_id and g.game_day=new.actual_date
   and g.tipoff=new.actual_tipoff and g.observed_at=new.evidence_observed_at
   and d.status='complete' and d.observed_at<=new.settled_at and (g.stats->>'MIN')::numeric>0
 ) then raise exception 'P2 settlement does not match completed post-capture appearance'; end if;
 return new;
end; $p2$;
create trigger p2_verify_settlement before insert on sc3.p2_return_settlements for each row execute function sc3.p2_verify_settlement();
revoke all on sc3.p2_return_forecasts,sc3.p2_return_settlements from public, anon, authenticated, sc3_app;
-- Application reads only. The NOLOGIN writer role cannot be used until a
-- dedicated identity is separately provisioned and explicitly authorized.
create role sc3_p2_writer nologin;
grant usage on schema sc3 to sc3_p2_writer;
grant select on sc3.p2_return_forecasts,sc3.p2_return_settlements to sc3_app,sc3_p2_writer;
grant select on sc3.sc3_nba_game_logs,sc3.sc3_nba_sync_days to sc3_p2_writer;
-- Column grants deliberately exclude database-generated capture/settlement timestamps.
grant insert(id,source,source_url,espn_id,report_at,feed_observed_at,estimated_date,status) on sc3.p2_return_forecasts to sc3_p2_writer;
grant insert(forecast_id,event_id,actual_date,actual_tipoff,evidence_observed_at) on sc3.p2_return_settlements to sc3_p2_writer;
commit;
