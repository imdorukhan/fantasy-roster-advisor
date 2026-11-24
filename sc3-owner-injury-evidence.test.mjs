import test from 'node:test';
import assert from 'node:assert/strict';
import {attachOwnerInjuryEvidence} from './sc3-owner-injury-evidence.mjs';

const roster=[{yahooId:'10452',name:'Kasparas Jakučionis',status:'Q',slot:'BN'}];
const observedAt='2026-11-24T00:48:31.064Z';
test('verified production owner roster gets same timestamped independent ESPN injury evidence as preview',async()=>{
 const calls=[];
 const result=await attachOwnerInjuryEvidence(roster,observedAt,{enabled:true,
  read:async(players,at)=>{calls.push({players,at});return {
   mode:'SC3_INJURY_EVIDENCE',status:'verified',yahooObservedAt:at,players:[
    {yahooId:'10452',yahooFlagged:true,espnDepthVerified:true,returnDate:null,returnDateVerified:false,executable:false}
   ],readOnly:true
  };}});
 assert.equal(calls.length,1);
 assert.equal(calls[0].at,observedAt);
 assert.equal(result.status,'verified');
 assert.equal(result.players[0].returnDate,null);
 assert.equal(result.players[0].executable,false);
});
test('missing source, invalid response or disabled SC3 scope fail closed without inferred injury return dates',async()=>{
 const nope=()=>{throw Error('Must not call');};
 assert.equal((await attachOwnerInjuryEvidence(roster,observedAt,{enabled:false,read:nope})).status,'unavailable');
 assert.equal((await attachOwnerInjuryEvidence([],observedAt,{enabled:true,read:nope})).status,'unavailable');
 assert.equal((await attachOwnerInjuryEvidence(roster,'bad',{enabled:true,read:nope})).status,'unavailable');
 assert.equal((await attachOwnerInjuryEvidence(roster,observedAt,{enabled:true,read:async()=>{throw Error('DB unavailable')}})).status,'unavailable');
 assert.equal((await attachOwnerInjuryEvidence(roster,observedAt,{enabled:true,read:async()=>({mode:'SC3_INJURY_EVIDENCE',status:'verified',players:[{returnDate:'2026-12-01',returnDateVerified:true,executable:true}]})})).status,'unavailable');
});
