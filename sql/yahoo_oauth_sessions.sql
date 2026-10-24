-- Apply only to a dedicated Salary CAPtain Supabase project.
-- Keep this table inaccessible to browser/API roles.
create table if not exists public.yahoo_oauth_sessions (
  session_hash text primary key check (session_hash ~ '^[0-9a-f]{64}$'),
  token_ciphertext text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.yahoo_oauth_sessions enable row level security;
revoke all on table public.yahoo_oauth_sessions from public, anon, authenticated;
grant select, insert, update, delete on table public.yahoo_oauth_sessions to service_role;
-- No anon/authenticated policies; only privileged server-side service access.
create index if not exists yahoo_oauth_sessions_expiry_idx on public.yahoo_oauth_sessions(expires_at);
-- Periodically delete expired rows with an authorized maintenance job.
