import test from 'node:test';
import assert from 'node:assert/strict';
import {buildInjuryEvidence} from './sc3-injury-evidence.mjs';
const now=Date.parse('2026-11-23T12:30:00Z'),observed='2026-11-23T12:00:00Z';
const roster=[
 {yahooId:'10',name:'A',nbaTeam:'SAS',status:'Q',slot:'C'},
 {yahooId:'11',name:'B',nbaTeam:'GSW',status:'O',slot:'IL'},
 {yahooId:'12',name:'C',nbaTeam:'GSW',status:'A',slot:'PG'},
 {yahooId:'13',name:'D',nbaTeam:'LAL',status:'A',slot:'BN'}
];
const row=(id,team,injury_marker=null)=>({
 yahoo_id:id,espn_id:id,status:'verified',nba_team:team,position:'PG',rank:1,
 observed_at:observed,injury_marker
});
test('Yahoo flags and ESPN full depth IL markers stay separate with no invented return date',()=>{
 const report=buildInjuryEvidence(roster,[row('10','SA'),row('11','GS'),row('12','GS','IL')],observed,now);
 assert.deepEqual(report.players.map(p=>p.yahooId),['10','11','12']);
 assert.equal(report.players[0].yahooStatus,'Q');
 assert.equal(report.players[0].espnDepthVerified,true);
 assert.equal(report.players[0].espnDepthIL,false);
 assert.equal(report.players[1].onInjuryList,true);
 assert.equal(report.players[2].yahooFlagged,false);
 assert.equal(report.players[2].espnDepthIL,true);
 assert.ok(report.players.every(p=>p.returnDate===null&&!p.returnDateVerified&&!p.executable));
});
test('unverified or stale ESPN identity never silently clears a real Yahoo injury flag',()=>{
 const stale={...row('10','SA','IL'),observed_at:'2026-11-20T00:00:00Z'};
 const result=buildInjuryEvidence(roster,[stale],observed,now);
 assert.equal(result.players[0].yahooFlagged,true);
 assert.equal(result.players[0].espnDepthVerified,false);
 assert.equal(result.players[0].espnDepthIL,false);
});
test('stale or duplicate Yahoo roster is not accepted as live injury evidence',()=>{
 assert.throws(()=>buildInjuryEvidence(roster,[], '2026-11-20T12:00:00Z',now),/stale/);
 assert.throws(()=>buildInjuryEvidence([...roster,roster[0]],[],observed,now),/roster/);
});
