import test from 'node:test';
import assert from 'node:assert/strict';
import handler from './api/auto-data.js';
import manualRefresh from './api/auth/yahoo/refresh.js';
import {sessionHash,tokenEncrypt,tokenDecrypt} from './api/auth/yahoo/_store.js';

const sid='a'.repeat(43),hash=sessionHash(sid);
const cronSecret='fixture-cron-secret-at-least-32-characters';
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v},status(code){this.code=code;return this},json(body){this.body=body;return this}}}
function install({expired=true,failSave=false,early401=false,loseClaimAck=false,loseSaveAck=false}={}){
  const previous={...process.env},oldFetch=globalThis.fetch;
  Object.assign(process.env,{VERCEL_ENV:'production',SC3_ISOLATED:'0',YAHOO_CLIENT_ID:'fixture-id',YAHOO_CLIENT_SECRET:'fixture-client-secret',YAHOO_SESSION_SECRET:'fixture-session-secret-at-least-32-characters',SALARYCAPTAIN_SUPABASE_URL:'https://fixture.supabase.co',SALARYCAPTAIN_SUPABASE_SECRET_KEY:'fixture-db-key',CRON_SECRET:cronSecret,YAHOO_CLOUD_CHECK_UNTIL:new Date(Date.now()+86400000).toISOString()});
  let cipher=tokenEncrypt({access_token:'fixture-old',refresh_token:'fixture-old-refresh',expires_at:Date.now()+(expired?-1:3600000)}),held,last;
  const calls={exchange:0,claim:0,finish:0,snapshotWrites:0,fantasy:0};
  const json=value=>new Response(JSON.stringify(value));
  const player=id=>({player:[[{player_id:String(id)},{name:{full:'Fixture player'}},{eligible_positions:[{position:'PG'}]}],{selected_position:[{position:'PG'}]}]});
  globalThis.fetch=async(url,options={})=>{
    url=String(url);
    if(url==='https://api.login.yahoo.com/oauth2/get_token'){
      calls.exchange++;await new Promise(resolve=>setTimeout(resolve,5));
      const params=new URLSearchParams(options.body);
      assert.equal(params.get('redirect_uri'),'https://salarycaptain.vercel.app/api/auth/yahoo/callback');
      return json({access_token:'fixture-new',refresh_token:'fixture-rotated',expires_in:3600});
    }
    if(url.startsWith('https://fixture.supabase.co/rest/v1/rpc/yahoo_refresh_')){
      const params=JSON.parse(options.body);
      assert.equal(params.p_hash,hash);
      if(url.endsWith('_claim')){
        calls.claim++;
        if(held?.state==='uncertain')return json({state:'uncertain'});
        if(held?.id===params.p_claim)return json({state:'acquired',ciphertext:cipher});
        if(held)return json({state:'busy'});
        held={id:params.p_claim,state:'refreshing'};
        if(loseClaimAck&&calls.claim===1)throw Error('fixture lost claim acknowledgement');
        return json({state:'acquired',ciphertext:cipher});
      }
      if(url.endsWith('_uncertain')){if(held?.id===params.p_claim)held.state='uncertain';return json(true)}
      calls.finish++;
      if(failSave)throw Error('fixture private storage failure');
      if(!held)return json(last?.id===params.p_claim&&last?.cipher===cipher);
      if(held.id!==params.p_claim||cipher!==params.p_expected)return json(false);
      cipher=params.p_replacement??cipher;
      last={id:held.id,cipher};held=undefined;
      if(loseSaveAck&&calls.finish===1)throw Error('fixture lost save acknowledgement');
      return json(true);
    }
    if(url.startsWith('https://fixture.supabase.co/rest/v1/yahoo_oauth_sessions')){
      assert.ok(!options.method||options.method==='GET');
      return json([{session_hash:hash,token_ciphertext:cipher}]);
    }
    if(url.startsWith('https://fixture.supabase.co/rest/v1/yahoo_league_')){
      if(options.method==='POST'){calls.snapshotWrites++;return new Response(null,{status:204})}
      return json([]);
    }
    if(url.startsWith('https://fantasysports.yahooapis.com/fantasy/v2/')){
      calls.fantasy++;
      if(early401&&options.headers.Authorization==='Bearer fixture-old')return new Response('{}',{status:401});
      const team=url.match(/\.t\.(\d+)\/roster/);
      if(team)return json({fantasy_content:{team:[{team_key:'478.l.85892.t.'+team[1]},{roster:{players:{0:player(team[1]),count:1}}}]}});
      if(url.includes('/teams?'))return json({fantasy_content:{league:[{league_key:'478.l.85892'},{teams:Object.assign(Object.fromEntries(Array.from({length:14},(_,i)=>[i,{team:[{team_key:`478.l.85892.t.${i+1}`},{name:'Fixture team'}]}])),{count:14})}]}});
      if(url.includes('status=FA;'))return json({fantasy_content:{league:[{players:{count:0}}]}});
      if(url.includes('status=W;'))return json({fantasy_content:{league:[{players:{0:player(100),count:1}}]}});
      return json({fantasy_content:{fixture:true}});
    }
    throw Error('Unexpected fixture request');
  };
  return {calls,tokens:()=>tokenDecrypt(cipher),restore(){process.env=previous;globalThis.fetch=oldFetch}};
}

test('cron, live health and manual refresh use the same production coordination RPC',async()=>{
  const f=install();
  try{
    const cron=response(),live=response(),manual=response();
    await Promise.all([
      handler({method:'GET',query:{cron:'1'},headers:{authorization:'Bearer '+cronSecret}},cron),
      handler({method:'GET',query:{live:'1',health:'1'},headers:{cookie:'yahoo_session='+sid}},live),
      manualRefresh({method:'POST',headers:{origin:'https://salarycaptain.vercel.app',cookie:'yahoo_session='+sid}},manual)
    ]);
    assert.deepEqual([cron.code,live.code,manual.code],[200,200,200]);
    assert.equal(f.calls.exchange,1);
    assert.equal(f.tokens().refresh_token,'fixture-rotated');
    assert.doesNotMatch(JSON.stringify([cron.body,live.body,manual.body]),/fixture-old|fixture-new|fixture-rotated/);
  }finally{f.restore()}
});

test('the normal cloud diagnostic refreshes and persists before collecting all rosters',async()=>{
  const f=install(),oldInfo=console.info,logs=[];
  console.info=value=>logs.push(value);
  try{
    const res=response();
    await handler({method:'GET',query:{yahooCloudCheck:'1'},headers:{authorization:'Bearer '+cronSecret}},res);
    assert.equal(res.code,200);
    assert.equal(res.body.status,'PASS');
    assert.equal(res.body.teamCount,14);
    assert.equal(res.body.playerCount,14);
    assert.equal(res.body.oauthRefreshAttempted,true);
    assert.equal(res.body.oauthRefreshed,true);
    assert.equal(res.body.readOnly,false);
    assert.equal(res.body.snapshotWrites,0);
    assert.equal(f.calls.snapshotWrites,0);
    assert.equal(f.calls.exchange,1);
    assert.equal(logs.length,1);
    assert.doesNotMatch(logs[0],/fixture-old|fixture-new|fixture-rotated/);
  }finally{console.info=oldInfo;f.restore()}
});

test('parallel early API 401s in the actual cron renew once',async()=>{
  const f=install({expired:false,early401:true});
  try{
    const res=response();
    await handler({method:'GET',query:{cron:'1'},headers:{authorization:'Bearer '+cronSecret}},res);
    assert.equal(res.code,200);
    assert.equal(f.calls.exchange,1);
    assert.equal(f.calls.fantasy,10);
  }finally{f.restore()}
});

test('a failed OAuth save stops the actual cloud diagnostic before snapshots or Yahoo reads',async()=>{
  const f=install({failSave:true}),oldInfo=console.info,logs=[];
  console.info=value=>logs.push(value);
  try{
    const res=response();
    await handler({method:'GET',query:{yahooCloudCheck:'1'},headers:{authorization:'Bearer '+cronSecret}},res);
    assert.equal(res.code,502);
    assert.equal(res.body.category,'refresh_save_failed');
    assert.equal(f.calls.finish,3);
    assert.equal(f.calls.exchange,1);
    assert.equal(f.calls.fantasy,0);
    assert.equal(f.calls.snapshotWrites,0);
    assert.doesNotMatch(logs.join('\n'),/fixture private|fixture-old|fixture-new|fixture-rotated/);
  }finally{console.info=oldInfo;f.restore()}
});

test('lost claim and save acknowledgements recover through the real store adapter without a second exchange',async()=>{
  const f=install({loseClaimAck:true,loseSaveAck:true}),oldInfo=console.info;
  console.info=()=>{};
  try{
    const res=response();
    await handler({method:'GET',query:{yahooCloudCheck:'1'},headers:{authorization:'Bearer '+cronSecret}},res);
    assert.equal(res.code,200);
    assert.equal(f.calls.claim,2);
    assert.equal(f.calls.finish,2);
    assert.equal(f.calls.exchange,1);
    assert.equal(f.tokens().refresh_token,'fixture-rotated');
  }finally{console.info=oldInfo;f.restore()}
});
