import test from 'node:test';
import assert from 'node:assert/strict';
import {maxStarts,rankWaiverOpportunities,readWaiverOpportunities} from './sc3-waiver-plan.mjs';
const guard={nbaTeam:'GSW',eligiblePositions:['PG'],occupied:true,slot:'BN'};
const swing={nbaTeam:'GSW',eligiblePositions:['SG','SF'],occupied:true,slot:'SG'};
const candidate={yahooId:'1',name:'Candidate',nbaTeam:'GS',eligiblePositions:['SF'],yahooRosterStatus:'W (Nov 18)'};
test('bench and flexible assignments maximize starts',()=>{
 assert.equal(maxStarts([swing,guard],['G','SF']),2);
});
test('a waiver candidate adds only marginal starts after processing date and IL is excluded',()=>{
 const slots=[{count:1,position:'G'},{count:1,position:'SF'}];
 const day=(date,lineup)=>({date,lineup,schedule:{teams:new Set(['GSW'])}});
 const report=rankWaiverOpportunities([candidate],[day('2026-11-18',[guard]),day('2026-11-19',[guard,swing]),day('2026-11-20',[guard,{...swing,slot:'IL'}])],slots);
 assert.deepEqual(report[0].dates,['2026-11-20']);
 assert.equal(report[0].extraStarts,1);
});

test('complete snapshot ranks the full pool and limits displayed results',async()=>{
 const players=Array.from({length:50},(_,i)=>({...candidate,yahooId:String(i+1),name:'Candidate '+i}));
 const days=[{date:'2026-11-18',lineup:[guard],schedule:{teams:new Set(['GSW'])}},{date:'2026-11-19',lineup:[guard],schedule:{teams:new Set(['GSW'])}}];
 const all=await readWaiverOpportunities({players,count:50},days,[{count:1,position:'G'},{count:1,position:'SF'}],{remaining:5},()=>{throw Error('unexpected live fetch');});
 assert.equal(all.evaluated,50);
 assert.equal(all.rankable,50);
 assert.equal(all.rows.length,25);
 assert.equal(all.rows[0].extraStarts,1);
});
