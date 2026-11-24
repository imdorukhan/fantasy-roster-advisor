import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifiedAcquisitionSummary} from './sc3-acquisition-summary.mjs';

const now=new Date('2026-11-24T01:00:00Z');
const base={mode:'YAHOO_ALL_ROSTERS',complete:true,leagueId:85892,teamCount:14,playerCount:206,
 acquisitions:{limit:7,used:0,remaining:7,fab:86,observedAt:'2026-11-24T00:48:31Z'}};
test('owner verified acquisition source supplies a real 7-add budget and $86 FAB',()=>{
 const result=verifiedAcquisitionSummary(base,now);
 assert.equal(result.used,0);
 assert.equal(result.remaining,7);
 assert.equal(result.limit,7);
 assert.equal(result.fab,86);
 assert.equal(result.source,'Yahoo Fantasy Sports API');
});
test('stale, mismatched, contradictory or unverified acquisition data never renders as verified',()=>{
 const cases=[
 {...base,complete:false},
 {...base,leagueId:1},
 {...base,acquisitions:{...base.acquisitions,used:8}},
 {...base,acquisitions:{...base.acquisitions,remaining:6}},
 {...base,acquisitions:{...base.acquisitions,fab:-1}},
 {...base,acquisitions:{...base.acquisitions,observedAt:'2026-11-21T00:00:00Z'}},
 {...base,acquisitions:{...base.acquisitions,observedAt:'2026-11-24T02:00:00Z'}}
 ];
 for(const x of cases)assert.equal(verifiedAcquisitionSummary(x,now),null);
});
test('dashboard has dedicated live values; static em dashes cannot survive verified source refresh',async()=>{
 const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
 assert.match(html,/id="live-adds-used"/);
 assert.match(html,/id="live-fab-balance"/);
 assert.match(html,/verifiedAcquisitionSummary\(d\)/);
});
