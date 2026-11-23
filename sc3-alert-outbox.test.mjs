import test from 'node:test';
import assert from 'node:assert/strict';
import {planAlertOutbox} from './sc3-alert-outbox.mjs';
const candidate=(status='Q')=>({
 playerId:'10452',scope:'MY_TEAM',eventKey:'10452|injury-20261123|'+status,
 message:'Injury status changed',sourceUrl:'https://www.nba.com/news/injury',
 observedAt:'2026-11-23T18:00:00Z',sourceVerified:true,requiresApproval:true,deliveryEnabled:false,executable:false
});
const input={leagueId:85892,teamId:5,subscriberId:'owner-1',now:'2026-11-23T20:00:00Z',candidates:[candidate()]};
test('outbox refuses to deliver without explicit opt-in and retains review-only preview',()=>{
 const out=planAlertOutbox(input);
 assert.equal(out.deliveryEnabled,false);
 assert.equal(out.operations.length,0);
 assert.equal(out.preview.length,1);
 assert.equal(out.status,'consent_required');
 assert.ok(!('deliveries' in out));
});
test('a persisted sent or pending event key prevents duplicate planning across runs',()=>{
 const permitted={...input,consent:{approved:true,channel:'in_app'}};
 const first=planAlertOutbox(permitted);
 assert.equal(first.operations.length,1);
 assert.equal(first.operations[0].state,'pending_review');
 const key=first.operations[0].idempotencyKey;
 assert.ok(/^[a-f0-9]{64}$/.test(key));
 for(const state of ['sent','pending_review','sending']){
  const repeated=planAlertOutbox({...permitted,existing:[{idempotencyKey:key,state}]});
  assert.equal(repeated.operations.length,0);
 }
});
test('a failed event is not retried automatically, and a new injury status uses a new key',()=>{
 const opts={...input,consent:{approved:true,channel:'in_app'}};
 const key=planAlertOutbox(opts).operations[0].idempotencyKey;
 assert.equal(planAlertOutbox({...opts,existing:[{idempotencyKey:key,state:'failed'}]}).operations.length,0);
 const changed=planAlertOutbox({...opts,candidates:[candidate('O')],existing:[{idempotencyKey:key,state:'sent'}]});
 assert.equal(changed.operations.length,1);
 assert.notEqual(changed.operations[0].idempotencyKey,key);
 const secondOwner=planAlertOutbox({...opts,subscriberId:'owner-2'});
 assert.notEqual(secondOwner.operations[0].idempotencyKey,key);
});
test('only verified, qualified candidate status events are eligible for an outbox plan',()=>{
 const r=planAlertOutbox({...input,consent:{approved:true,channel:'in_app'},candidates:[
  candidate(),candidate(),{...candidate(),eventKey:'bad'}, {...candidate(),executable:true}
 ]});
 assert.equal(r.operations.length,1);
 assert.equal(r.skipped,3);
});
