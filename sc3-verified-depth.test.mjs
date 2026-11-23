import test from 'node:test';
import assert from 'node:assert/strict';
import {attachVerifiedDepth} from './sc3-verified-depth.mjs';
const now=Date.parse('2026-11-23T13:00:00Z'),stamp='2026-11-23T12:00:00Z';
const snapshot={freeAgents:{count:3,players:[
 {yahooId:'10',name:'Same Name',nbaTeam:'GSW',eligiblePositions:['PG']},
 {yahooId:'11',name:'Same Name',nbaTeam:'LAL',eligiblePositions:['PG']},
 {yahooId:'12',name:'Unlinked',nbaTeam:'GSW',eligiblePositions:['C']}
]}};
const row=(id,team='GS',position='PG',rank=1,espn='123')=>({
 yahoo_id:id,espn_id:espn,status:'verified',nba_team:team,position,rank,observed_at:stamp,injury_marker:null
});
test('only verified exact Yahoo-to-ESPN links and matching NBA team get ranked',()=>{
 const out=attachVerifiedDepth(snapshot,[row('10'),row('11','GS'),row('12','GS','C',2)],now);
 assert.deepEqual(out.freeAgents.players[0].depthRanks.map(x=>[x.position,x.rank]),[['PG',1]]);
 assert.deepEqual(out.freeAgents.players[1].depthRanks,[]);
 assert.deepEqual(out.freeAgents.players[2].depthRanks.map(x=>[x.position,x.rank]),[['C',2]]);
 assert.equal(out.depthCoverage.verifiedPlayers,2);
});
test('unverified links, stale depth, duplicate positions and mismatched IDs fail closed',()=>{
 const bad=[{...row('10'),status:'candidate'},row('11','LAL','PG',1,'125')];
 bad[1].observed_at='2026-11-20T12:00:00Z';
 const out=attachVerifiedDepth(snapshot,bad,now);
 assert.equal(out.depthCoverage.verifiedPlayers,0);
 const duplicate=attachVerifiedDepth(snapshot,[row('10'),row('10','GS','PG',2)],now);
 assert.deepEqual(duplicate.freeAgents.players[0].depthRanks,[]);
 const confused=attachVerifiedDepth(snapshot,[row('10'),row('10','GS','SG',1,'999')],now);
 assert.deepEqual(confused.freeAgents.players[0].depthRanks,[]);
});
test('empty verified Yahoo free-agent list stays zero without making up player rankings',()=>{
 const out=attachVerifiedDepth({freeAgents:{count:0,players:[]}},[],now);
 assert.equal(out.depthCoverage.verifiedPlayers,0);
 assert.deepEqual(out.freeAgents.players,[]);
});
