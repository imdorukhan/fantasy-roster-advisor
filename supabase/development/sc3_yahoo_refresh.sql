-- Apply before deploying the shared refresh client. No existing session is read or changed during setup.
begin;

create table sc3.yahoo_refresh_locks (
  store_schema text not null check (store_schema in ('public', 'sc3')),
  session_hash text not null check (session_hash ~ '^[a-f0-9]{64}$'),
  state text not null check (state in ('idle', 'refreshing', 'uncertain')),
  claim_id uuid,
  token_fingerprint text not null,
  lease_until timestamptz,
  primary key (store_schema, session_hash)
);
alter table sc3.yahoo_refresh_locks enable row level security;
revoke all on sc3.yahoo_refresh_locks from public, anon, authenticated;
grant usage on schema sc3 to service_role;
grant select, insert, update on sc3.yahoo_refresh_locks to service_role, sc3_app;
create policy yahoo_refresh_scoped on sc3.yahoo_refresh_locks for all to sc3_app
  using (store_schema = 'sc3') with check (store_schema = 'sc3');

create function sc3.yahoo_refresh_claim(p_schema text, p_hash text, p_claim uuid)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, sc3 as $$
declare
  cipher text;
  held sc3.yahoo_refresh_locks%rowtype;
begin
  if p_schema not in ('public', 'sc3') or p_schema is null or
     p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_claim is null then
    raise exception 'Invalid refresh claim';
  end if;
  -- The invoker must already have access to the selected session store.
  execute format('select token_ciphertext from %I.yahoo_oauth_sessions where session_hash=$1 and expires_at>clock_timestamp() for update', p_schema)
    into cipher using p_hash;
  if cipher is null then return jsonb_build_object('state', 'missing'); end if;
  insert into sc3.yahoo_refresh_locks(store_schema, session_hash, state, token_fingerprint)
    values(p_schema, p_hash, 'idle', md5(cipher)) on conflict do nothing;
  select * into held from sc3.yahoo_refresh_locks
    where store_schema=p_schema and session_hash=p_hash for update;
  -- A replaced session ciphertext invalidates every previous claim.
  if held.token_fingerprint <> md5(cipher) then
    update sc3.yahoo_refresh_locks set state='idle', claim_id=null, lease_until=null, token_fingerprint=md5(cipher)
      where store_schema=p_schema and session_hash=p_hash;
    held.state := 'idle';
  end if;
  if held.state='refreshing' and held.lease_until <= clock_timestamp() then
    update sc3.yahoo_refresh_locks set state='uncertain'
      where store_schema=p_schema and session_hash=p_hash;
    held.state := 'uncertain';
  end if;
  if held.state='uncertain' then return jsonb_build_object('state', 'uncertain'); end if;
  if held.state='refreshing' then
    if held.claim_id=p_claim then return jsonb_build_object('state','acquired','ciphertext',cipher); end if;
    return jsonb_build_object('state', 'busy');
  end if;
  update sc3.yahoo_refresh_locks set state='refreshing', claim_id=p_claim, lease_until=clock_timestamp()+interval '90 seconds'
    where store_schema=p_schema and session_hash=p_hash;
  return jsonb_build_object('state','acquired','ciphertext',cipher);
end;
$$;

create function sc3.yahoo_refresh_finish(p_schema text, p_hash text, p_claim uuid, p_expected text, p_replacement text)
returns boolean language plpgsql security invoker set search_path = pg_catalog, sc3 as $$
declare
  cipher text;
  held sc3.yahoo_refresh_locks%rowtype;
begin
  if p_schema not in ('public','sc3') or p_schema is null or p_hash is null or
     p_hash !~ '^[a-f0-9]{64}$' or p_claim is null or p_expected is null or p_replacement='' then
    raise exception 'Invalid refresh finalization';
  end if;
  execute format('select token_ciphertext from %I.yahoo_oauth_sessions where session_hash=$1 and expires_at>clock_timestamp() for update',p_schema)
    into cipher using p_hash;
  if cipher is null then return false; end if;
  select * into held from sc3.yahoo_refresh_locks
    where store_schema=p_schema and session_hash=p_hash for update;
  if not found or held.claim_id is distinct from p_claim then return false; end if;
  -- Repeating the same finalization after a lost HTTP acknowledgement is safe.
  if held.state='idle' and cipher=coalesce(p_replacement,p_expected) then return true; end if;
  if held.state not in ('refreshing','uncertain') or cipher<>p_expected or held.token_fingerprint<>md5(cipher) then return false; end if;
  if p_replacement is not null then
    execute format('update %I.yahoo_oauth_sessions set token_ciphertext=$2,expires_at=clock_timestamp()+interval ''30 days'' where session_hash=$1',p_schema)
      using p_hash,p_replacement;
  end if;
  update sc3.yahoo_refresh_locks set state='idle', lease_until=null, token_fingerprint=md5(coalesce(p_replacement,cipher))
    where store_schema=p_schema and session_hash=p_hash;
  return true;
end;
$$;

create function sc3.yahoo_refresh_uncertain(p_schema text,p_hash text,p_claim uuid)
returns boolean language plpgsql security invoker set search_path = pg_catalog, sc3 as $$
begin
  update sc3.yahoo_refresh_locks set state='uncertain'
    where store_schema=p_schema and session_hash=p_hash and claim_id=p_claim and state='refreshing';
  return found;
end;
$$;

-- REST entry points use the existing backend service role and only the legacy session store.
create function public.yahoo_refresh_claim(p_hash text,p_claim uuid)
returns jsonb language sql security invoker set search_path = pg_catalog, sc3
as $$ select sc3.yahoo_refresh_claim('public',p_hash,p_claim); $$;
create function public.yahoo_refresh_finish(p_hash text,p_claim uuid,p_expected text,p_replacement text)
returns boolean language sql security invoker set search_path = pg_catalog, sc3
as $$ select sc3.yahoo_refresh_finish('public',p_hash,p_claim,p_expected,p_replacement); $$;
create function public.yahoo_refresh_uncertain(p_hash text,p_claim uuid)
returns boolean language sql security invoker set search_path = pg_catalog, sc3
as $$ select sc3.yahoo_refresh_uncertain('public',p_hash,p_claim); $$;

revoke all on function sc3.yahoo_refresh_claim(text,text,uuid), sc3.yahoo_refresh_finish(text,text,uuid,text,text), sc3.yahoo_refresh_uncertain(text,text,uuid)
  from public,anon,authenticated;
grant execute on function sc3.yahoo_refresh_claim(text,text,uuid), sc3.yahoo_refresh_finish(text,text,uuid,text,text), sc3.yahoo_refresh_uncertain(text,text,uuid)
  to service_role,sc3_app;
revoke all on function public.yahoo_refresh_claim(text,uuid), public.yahoo_refresh_finish(text,uuid,text,text), public.yahoo_refresh_uncertain(text,uuid)
  from public,anon,authenticated;
grant execute on function public.yahoo_refresh_claim(text,uuid), public.yahoo_refresh_finish(text,uuid,text,text), public.yahoo_refresh_uncertain(text,uuid)
  to service_role;
notify pgrst, 'reload schema';
commit;
