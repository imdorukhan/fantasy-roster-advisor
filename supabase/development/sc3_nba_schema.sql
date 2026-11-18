-- Proposed isolated development schema. NOT applied to production.
begin;
create table public.sc3_nba_sync_days (
 game_day date primary key,
 observed_at timestamptz not null,
 completed_events integer not null check (completed_events >= 0),
 player_rows integer not null check (player_rows >= 0),
 status text not null check (status in ('complete','partial','failed')),
 errors jsonb not null default '[]'::jsonb check (jsonb_typeof(errors)='array'),
 check (status <> 'complete' or jsonb_array_length(errors)=0)
);
create table public.sc3_nba_game_logs (
 event_id text not null check (event_id ~ '^[0-9]+$'),
 espn_id text not null check (espn_id ~ '^[0-9]+$'),
 game_day date not null references public.sc3_nba_sync_days(game_day),
 tipoff timestamptz not null,
 player_name text,
 nba_team text,
 stats jsonb not null check (jsonb_typeof(stats)='object'),
 observed_at timestamptz not null,
 primary key(event_id,espn_id)
);
create index sc3_nba_game_logs_player_date on public.sc3_nba_game_logs(espn_id,tipoff desc);
create table public.sc3_player_identity (
 yahoo_id text primary key check (yahoo_id ~ '^[0-9]+$'),
 espn_id text unique check (espn_id ~ '^[0-9]+$'),
 status text not null check(status in ('verified','candidate','unresolved')),
 evidence text not null,
 candidate_ids jsonb not null default '[]'::jsonb,
 observed_at timestamptz not null default now(),
 check ((status='verified')=(espn_id is not null))
);
alter table public.sc3_nba_sync_days enable row level security;
alter table public.sc3_nba_game_logs enable row level security;
alter table public.sc3_player_identity enable row level security;
revoke all on public.sc3_nba_sync_days, public.sc3_nba_game_logs, public.sc3_player_identity from public, anon, authenticated;
grant select,insert,update,delete on public.sc3_nba_sync_days, public.sc3_nba_game_logs, public.sc3_player_identity to service_role;
-- Atomic daily replacement; failed batches never overwrite last good collection.
create function public.sc3_store_completed_day(p_day date,p_observed timestamptz,p_events integer,p_rows jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 if jsonb_typeof(p_rows) is distinct from 'array' or p_events<0 then raise exception 'Invalid batch'; end if;
 n:=jsonb_array_length(p_rows);
 if (p_events=0 and n<>0) or (p_events>0 and n=0) then raise exception 'Incomplete batch'; end if;
 if (select count(distinct r->>'event_id') from jsonb_array_elements(p_rows) r)<>p_events then raise exception 'Event coverage mismatch'; end if;
 if exists(select 1 from jsonb_array_elements(p_rows) r where r->>'game_day' is distinct from p_day::text) then raise exception 'Date mismatch'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('sc3-nba:'||p_day::text));
 if exists(select 1 from public.sc3_nba_sync_days where game_day=p_day and observed_at>p_observed) then raise exception 'Older snapshot'; end if;
 insert into public.sc3_nba_sync_days values(p_day,p_observed,p_events,n,'complete','[]'::jsonb)
 on conflict(game_day) do update set observed_at=excluded.observed_at,completed_events=excluded.completed_events,player_rows=excluded.player_rows,status='complete',errors='[]'::jsonb;
 delete from public.sc3_nba_game_logs where game_day=p_day;
 insert into public.sc3_nba_game_logs(event_id,espn_id,game_day,tipoff,player_name,nba_team,stats,observed_at)
 select r.event_id,r.espn_id,r.game_day,r.tipoff,r.player_name,r.nba_team,r.stats,p_observed from jsonb_to_recordset(p_rows)
 as r(event_id text,espn_id text,game_day date,tipoff timestamptz,player_name text,nba_team text,stats jsonb);
 return n;
end $$;
revoke all on function public.sc3_store_completed_day(date,timestamptz,integer,jsonb) from public,anon,authenticated;
grant execute on function public.sc3_store_completed_day(date,timestamptz,integer,jsonb) to service_role;
commit;
