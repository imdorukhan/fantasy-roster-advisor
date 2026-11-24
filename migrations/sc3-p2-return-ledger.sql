-- PROPOSED MIGRATION. Do not execute on the shared production database during Preview.
-- Run in a separately approved environment as schema owner. Runtime writer
-- has INSERT/SELECT only. Administrative owners can always change a database;
-- this is append-only under application privileges, not cryptographic WORM.
begin;
create table sc3.p2_return_forecasts (
 id text primary key check (id ~ '^[a-f0-9]{64}$'),
 source text not null check (source in ('ESPN','NBA_OFFICIAL')),
 source_url text not null,
 espn_id text not null check (espn_id ~ '^[0-9]{1,12}$'),
 report_at timestamptz not null,
 feed_observed_at timestamptz not null,
 estimated_date date not null,
 status text not null,
 captured_at timestamptz not null default clock_timestamp(),
 unique(source,espn_id,report_at,estimated_date),
 check (report_at<=feed_observed_at and feed_observed_at<=captured_at),
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
revoke all on sc3.p2_return_forecasts,sc3.p2_return_settlements from public, anon, authenticated, sc3_app;
-- Application reads only. A future dedicated writer role must be separately
-- provisioned and authorized; do not grant writing to existing Preview role.
grant select on sc3.p2_return_forecasts,sc3.p2_return_settlements to sc3_app;
commit;
