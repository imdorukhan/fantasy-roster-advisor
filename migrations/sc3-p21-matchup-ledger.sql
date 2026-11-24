-- Proposed only. Depends on sc3-p2-return-ledger.sql. No production application.
begin;
create table sc3.p2_matchup_forecasts (
 id text primary key check(id ~ '^[a-f0-9]{64}$'),
 league_id integer not null check(league_id=85892),
 week integer not null check(week>0),
 opponent_id integer not null check(opponent_id between 1 and 14 and opponent_id<>5),
 week_start date not null,week_end date not null,
 model_version text not null,forecast_as_of timestamptz not null,
 baseline_observed_at timestamptz not null,history_through date not null,
 inputs_digest text not null check(inputs_digest ~ '^[a-f0-9]{64}$'),
 payload jsonb not null,captured_at timestamptz not null default clock_timestamp(),
 check(week_start<=week_end and baseline_observed_at<=forecast_as_of and forecast_as_of<=captured_at),
 check((forecast_as_of at time zone 'America/Los_Angeles')::date between week_start and week_end),
 check(payload->>'modelVersion'=model_version and payload->>'inputsDigest'=inputs_digest)
);
create table sc3.p2_matchup_settlements(
 forecast_id text primary key references sc3.p2_matchup_forecasts(id),
 final_observed_at timestamptz not null,outcome jsonb not null,
 settled_at timestamptz not null default clock_timestamp(),
 check(final_observed_at<=settled_at)
);
create table sc3.p2_cbs_observations(
 id text primary key check(id ~ '^[a-f0-9]{64}$'),
 espn_id text not null check(espn_id ~ '^[0-9]{1,12}$'),
 report_date date not null,earliest_return date,
 observed_at timestamptz not null, payload jsonb not null,
 captured_at timestamptz not null default clock_timestamp(),
 check(observed_at<=captured_at and (earliest_return is null or earliest_return>=report_date))
);
create trigger p2_matchup_immutable before update or delete or truncate on sc3.p2_matchup_forecasts for each statement execute function sc3.p2_reject_mutation();
create trigger p2_matchup_result_immutable before update or delete or truncate on sc3.p2_matchup_settlements for each statement execute function sc3.p2_reject_mutation();
create trigger p2_cbs_immutable before update or delete or truncate on sc3.p2_cbs_observations for each statement execute function sc3.p2_reject_mutation();
revoke all on sc3.p2_matchup_forecasts,sc3.p2_matchup_settlements,sc3.p2_cbs_observations from public,anon,authenticated,sc3_app;
grant select on sc3.p2_matchup_forecasts,sc3.p2_matchup_settlements,sc3.p2_cbs_observations to sc3_app,sc3_p2_writer;
grant insert(id,league_id,week,opponent_id,week_start,week_end,model_version,forecast_as_of,baseline_observed_at,history_through,inputs_digest,payload) on sc3.p2_matchup_forecasts to sc3_p2_writer;
grant insert(forecast_id,final_observed_at,outcome) on sc3.p2_matchup_settlements to sc3_p2_writer;
grant insert(id,espn_id,report_date,earliest_return,observed_at,payload) on sc3.p2_cbs_observations to sc3_p2_writer;
commit;
