import test from 'node:test';
import assert from 'node:assert/strict';
import {createYahooSessionClient} from './yahoo-session-client.mjs';

const instant = Date.parse('2026-11-18T22:00:00Z');
const fresh = () => ({access_token: 'fixture-old-access', refresh_token: 'fixture-old-refresh', expires_at: instant + 3600000});
const expired = () => ({...fresh(), expires_at: instant - 1});
function fixture(tokens = expired()) {
  let stored = structuredClone(tokens), held, serial = 0;
  const calls = {exchange: 0, finish: 0, reads: [], uncertain: 0};
  const store = {
    async claim() {
      if (held?.state === 'uncertain') return {state: 'uncertain'};
      if (held) return {state: 'busy'};
      held = {state: 'acquired', serial: ++serial, tokens: structuredClone(stored)};
      return held;
    },
    async finish(claim, replacement) {
      calls.finish++;
      if (held !== claim) return false;
      if (replacement) stored = structuredClone(replacement);
      held = undefined;
      return true;
    },
    async uncertain(claim) { calls.uncertain++; if (held === claim) held.state = 'uncertain'; }
  };
  const deps = {
    store, now: () => instant, pause: () => new Promise(resolve => setTimeout(resolve, 1)),
    async exchange() {
      calls.exchange++;
      await new Promise(resolve => setTimeout(resolve, 5));
      return {access_token: 'fixture-new-access', refresh_token: 'fixture-new-refresh', expires_in: 3600, token_type: 'bearer'};
    },
    async read(token, path) { calls.reads.push([token,path]); return {ok:true}; }
  };
  const client = overrides => createYahooSessionClient({hash:'fixture-hash',tokens:structuredClone(tokens)}, {...deps,...overrides});
  return {client, calls, deps, stored: () => stored, replace: value => { stored = value; }};
}

test('fresh access reads without a refresh claim or exchange', async () => {
  const f=fixture(fresh());
  await f.client().read('fixture-path');
  assert.equal(f.calls.exchange,0);
  assert.equal(f.calls.finish,0);
  assert.deepEqual(f.calls.reads,[['fixture-old-access','fixture-path']]);
});

test('expired, missing and malformed expiry renew and persist rotated tokens before the first read', async () => {
  for (const expires_at of [instant-1,undefined,'invalid',NaN]) {
    const f=fixture({...fresh(),expires_at});
    const client=f.client();
    await client.read('fixture-path');
    assert.equal(f.calls.exchange,1);
    assert.equal(f.stored().refresh_token,'fixture-new-refresh');
    assert.equal(f.stored().expires_at,instant+3600000);
    assert.deepEqual(f.calls.reads,[['fixture-new-access','fixture-path']]);
    assert.equal(client.refreshAttempted,true);
    assert.equal(client.refreshed,true);
  }
});

test('separate clients and a manual force refresh share one exchange for the same observed token', async () => {
  const f=fixture(), clients=[f.client(),f.client(),f.client()];
  await Promise.all([clients[0].ready(),clients[1].ready(),clients[2].ready({force:true})]);
  assert.equal(f.calls.exchange,1);
  assert.equal(f.stored().refresh_token,'fixture-new-refresh');
});

test('a manual force refresh renews a valid token while concurrent reads coalesce', async () => {
  const f=fixture(fresh()),client=f.client();
  await Promise.all([client.ready({force:true}),client.read('fixture-path')]);
  assert.equal(f.calls.exchange,1);
  assert.equal(f.calls.reads[0][0],'fixture-new-access');
});

test('parallel early 401s trigger a single renewal and one retry per read', async () => {
  const f=fixture(fresh());
  const client=f.client({read:async token=>{
    if(token==='fixture-old-access')throw Object.assign(Error('fixture rejection'),{status:401});
    return 'success';
  }});
  const results=await Promise.all(Array.from({length:6},()=>client.read('fixture-path')));
  assert.deepEqual(results,Array(6).fill('success'));
  assert.equal(f.calls.exchange,1);
});

test('a second 401 propagates and a 403 never triggers renewal', async () => {
  for(const status of [401,403]){
    const f=fixture(fresh());let attempts=0;
    const client=f.client({read:async()=>{attempts++;throw Object.assign(Error('fixture'),{status})}});
    await assert.rejects(client.read('fixture-path'),error=>error.status===status);
    assert.equal(attempts,status===401?2:1);
    assert.equal(f.calls.exchange,status===401?1:0);
  }
});

test('an omitted replacement refresh token preserves the prior refresh token', async()=>{
  const f=fixture();
  await f.client({exchange:async()=>({access_token:'fixture-access',expires_in:3600})}).ready();
  assert.equal(f.stored().refresh_token,'fixture-old-refresh');
});

test('invalid token responses stop before reads and mark the outcome uncertain',async()=>{
  for(const value of [{expires_in:3600},{access_token:'new',expires_in:-1},{access_token:'new',expires_in:'invalid'},{access_token:'new',expires_in:3600,refresh_token:''},{access_token:'new',expires_in:3600,token_type:'other'}]){
    const f=fixture();
    await assert.rejects(f.client({exchange:async()=>value}).read('fixture-path'),{code:'invalid_refresh_response'});
    assert.equal(f.calls.uncertain,1);
    assert.equal(f.calls.reads.length,0);
  }
});

test('persistence failures retry the same result without repeating the OAuth exchange',async()=>{
  const f=fixture(), finish=f.deps.store.finish, replacements=[];
  let attempts=0;
  f.deps.store.finish=async(claim,replacement)=>{
    replacements.push(replacement);
    if(++attempts<3)throw Error('fixture storage outage');
    return finish(claim,replacement);
  };
  await f.client().ready();
  assert.equal(f.calls.exchange,1);
  assert.equal(attempts,3);
  assert.ok(replacements.every(value=>value===replacements[0]));
});

test('unrecoverable persistence failure blocks a second refresh and never serves the unsaved token',async()=>{
  const f=fixture();let attempts=0;
  f.deps.store.finish=async()=>{attempts++;throw Error('fixture storage outage')};
  await assert.rejects(f.client().read('fixture-path'),{code:'refresh_save_failed'});
  assert.equal(attempts,3);
  assert.equal(f.calls.exchange,1);
  assert.equal(f.calls.reads.length,0);
  await assert.rejects(f.client().ready(),{code:'refresh_outcome_uncertain'});
  assert.equal(f.calls.exchange,1);
});

test('an ambiguous exchange failure is sanitized and never automatically re-exchanged',async()=>{
  const f=fixture();
  const client=f.client({exchange:async()=>{throw Error('fixture-secret upstream timeout')}});
  await assert.rejects(client.ready(),error=>error.code==='refresh_outcome_uncertain'&&!error.message.includes('fixture-secret'));
  await assert.rejects(f.client().ready(),{code:'refresh_outcome_uncertain'});
});

test('a concurrent session change cannot be overwritten by a completed exchange',async()=>{
  const f=fixture();
  f.deps.store.finish=async()=>false;
  await assert.rejects(f.client().ready(),{code:'session_changed_during_refresh'});
  assert.equal(f.calls.reads.length,0);
  assert.equal(f.calls.exchange,1);
});

test('missing coordination fails closed before any exchange',async()=>{
  const f=fixture();
  f.deps.store.claim=async()=>{throw Error('fixture missing migration')};
  await assert.rejects(f.client().ready(),{code:'refresh_store_unavailable'});
  assert.equal(f.calls.exchange,0);
});

test('a newly stored refresh token coalesces manual renewal even if the access token is unchanged',async()=>{
  const f=fixture(fresh());
  f.replace({...fresh(),refresh_token:'fixture-already-rotated'});
  const client=f.client();
  await client.ready({force:true});
  assert.equal(f.calls.exchange,0);
  assert.equal(client.coordinationAttempted,true);
});

test('waiting for another worker is bounded and cannot start an exchange without a claim',async()=>{
  const f=fixture();let attempts=0;
  f.deps.store.claim=async()=>{attempts++;return {state:'busy'}};
  await assert.rejects(f.client({pause:async()=>{}}).ready(),{code:'refresh_busy'});
  assert.equal(attempts,100);
  assert.equal(f.calls.exchange,0);
});
