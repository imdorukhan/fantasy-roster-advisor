import test from 'node:test';
import assert from 'node:assert/strict';
import {rosterIdentityFallback,profileCoverage,readRosterIdentityInputs} from './sc3-roster-identity.mjs';
import {compareOwnership,recheckOwnership,stableLiveOwnership} from './sc3-ownership-check.mjs';
import {parseEspnInjuryFeed,attachInjuryReports} from './sc3-injury-feed.mjs';
import {buildInjuryEvidence} from './sc3-injury-evidence.mjs';
import {planWaiverIdentityChecks,waiverImpactCoverage} from './sc3-waiver-impact.mjs';
const stamp='2026-11-24T12:00:00Z',now=new Date('2026-11-24T12:30:00Z');
const player={yahooId:'10',name:'Maxime Raynaud',nbaTeam:'SAC',jersey:'42',status:'O',slot:'IL'};
const catalog=[{espnId:'4898371',name:'Maxime Raynaud',team:'SAC',jersey:'42',birthDate:'2003-04-07'}];
test('complete roster plus name, team and jersey produces transient verified evidence; existing links cannot be reused',()=>{
 const linked=rosterIdentityFallback([player],[],catalog);
 assert.equal(linked.length,1);assert.equal(linked[0].espn_id,'4898371');assert.equal(linked[0].persisted,false);
 assert.equal(rosterIdentityFallback([{...player,jersey:'99'}],[],catalog).length,0);
 assert.equal(rosterIdentityFallback([player],[{yahoo_id:'99',espn_id:'4898371'}],catalog).length,0);
 assert.equal(rosterIdentityFallback([player],[],[...catalog,{...catalog[0],espnId:'123'}]).length,0);
 const info=profileCoverage([player,{yahooId:'11'}],linked,new Map());
 assert.equal(info[0].reason,'NO_REGULAR_SEASON_SAMPLE');assert.equal(info[0].games,0);assert.equal(info[0].persisted,false);
 assert.equal(info[1].reason,'IDENTITY_UNRESOLVED');assert.equal(info[1].games,null);
});
test('roster catalog read rejects stale, incomplete and duplicate league rosters before any fallback',async()=>{
 const teams=Array.from({length:14},(_,i)=>({key:'478.l.85892.t.'+(i+1),players:[{...player,yahooId:String(i+1)}]}));
 const payload={mode:'YAHOO_ALL_ROSTERS',leagueId:85892,complete:true,teamCount:14,teams,playerCount:14};
 let calls=0;
 const client={query:async()=>{calls++;return {rows:calls===1?[{payload,observed_at:stamp}]:catalog}}};
 assert.equal((await readRosterIdentityInputs(client,+now)).players.length,14);
 assert.equal(calls,2);
 const stale={query:async()=>({rows:[{payload,observed_at:'2026-11-20T00:00:00Z'}]})};
 assert.deepEqual(await readRosterIdentityInputs(stale,+now),{players:[],catalog:[]});
 const duplicate={query:async()=>({rows:[{payload:{...payload,teams:[...teams.slice(0,13),teams[0]]},observed_at:stamp}]})};
 assert.deepEqual(await readRosterIdentityInputs(duplicate,+now),{players:[],catalog:[]});
});
const fa={yahooId:'2',name:'Free',yahooRosterStatus:'FA',nbaTeam:'SAC',eligiblePositions:['C','PF']};
const w={yahooId:'3',name:'Waiver',yahooRosterStatus:'W (Nov 24)',nbaTeam:'SAC',eligiblePositions:['C']};
test('live recheck includes explicitly empty FA and full W pages, detects membership/status changes and conflicting IDs',async()=>{
 const snapshot={freeAgents:{count:0,players:[]},waivers:{count:1,players:[w]}};
 const collect=(faRows,wRows)=>async(filter,onPage)=>{const players=filter==='FA'?faRows:wRows;onPage({players});return {count:players.length,pageCount:1,complete:true,observedAt:stamp}};
 const same=await recheckOwnership(snapshot,{collector:collect([],[w])});
 assert.equal(same.status,'MATCH');assert.equal(same.freeAgents.count,0);
 const changed=await recheckOwnership(snapshot,{collector:collect([fa],[{...w,yahooRosterStatus:'W (Nov 25)'}])});
 assert.equal(changed.status,'CHANGED');assert.equal(changed.freeAgents.added,1);assert.equal(changed.waivers.changed,1);
 assert.deepEqual(compareOwnership([fa],[{...fa,eligiblePositions:['PF','C']}]),{added:0,removed:0,changed:0});
 await assert.rejects(recheckOwnership(snapshot,{collector:collect([{...fa,yahooId:w.yahooId}],[w])}),/Conflicting/);
 await assert.rejects(recheckOwnership(snapshot,{collector:async()=>({complete:false,count:0})}),/Incomplete/);
});
const injury={id:'539684',status:'Out',date:'2026-11-18T05:54Z',details:{type:'Knee',returnDate:'2026-12-01'},shortComment:'Ruled out.',athlete:{displayName:'Maxime Raynaud',team:{id:'23',abbreviation:'SAC'},links:[{rel:['playercard','desktop','athlete'],href:'https://www.espn.com/nba/player/_/id/4898371/maxime-raynaud'}]}};
const source={timestamp:stamp,status:'success',season:{year:2027,type:2},injuries:[{id:'23',injuries:[injury]}]};
test('real ESPN-shaped injury report joins only by verified athlete identity, name and team; estimates stay unconfirmed',()=>{
 const parsed=parseEspnInjuryFeed(source,now);
 const links=[{yahoo_id:'10',espn_id:'4898371',status:'verified'}];
 assert.equal(parsed.rows.get('4898371').reportedReturnDate,'2026-12-01');
 assert.equal(attachInjuryReports([player],links,parsed)[0].espnReport.status,'Out');
 assert.equal(attachInjuryReports([{...player,nbaTeam:'LAL'}],links,parsed)[0].espnReport,null);
 assert.equal(attachInjuryReports([player],[],parsed)[0].espnReport,null);
 const report=buildInjuryEvidence([player],[],stamp,+now,{feed:parsed,identities:links});
 assert.equal(report.injuryFeed.matched,1);
 assert.equal(report.players[0].returnDate,null);assert.equal(report.players[0].returnDateVerified,false);assert.equal(report.players[0].executable,false);
 assert.throws(()=>parseEspnInjuryFeed({...source,timestamp:'2026-11-20T00:00Z'},now),/unavailable/);
 assert.equal(parseEspnInjuryFeed({...source,injuries:[{id:'23',injuries:[injury,injury]}]},now).rows.size,0);
});
test('waiver coverage prioritizes exact sample-backed candidates and accounts for every missing reason',()=>{
 const c=[{yahooId:'1',name:'A',nbaTeam:'GSW',extraStarts:1},{yahooId:'2',name:'B',nbaTeam:'SAC',extraStarts:2},{yahooId:'3',name:'C',nbaTeam:'SAC',extraStarts:3},{yahooId:'4',name:'D',nbaTeam:'SAC',extraStarts:3},{yahooId:'5',name:'E',nbaTeam:'SAC',extraStarts:1}];
 const catalog=[{name:'A',team:'GS',games:5},{name:'B',team:'SAC',games:5},{name:'C',team:'SAC',games:2}];
 const known=[{yahoo_id:'5',espn_id:'55'}];
 const p=planWaiverIdentityChecks(c,known,catalog,{limit:1});
 assert.deepEqual(p.checked.map(r=>r.yahooId),['2']);assert.equal(p.reasons.get('1'),'VERIFICATION_BUDGET');assert.equal(p.reasons.get('3'),'CATALOG_SAMPLE_LT_3');assert.equal(p.reasons.get('4'),'NO_CATALOG_MATCH');
 const summary=waiverImpactCoverage(c,[{yahooId:'5',impact:{}}],known,[],p);
 assert.equal(summary.reasons.READY,1);assert.equal(summary.reasons.IDENTITY_UNVERIFIED,1);assert.equal(Object.values(summary.reasons).reduce((a,b)=>a+b,0),5);
});

test('changed ownership requires two matching complete live passes; unstable lists never replace snapshot',async()=>{
 const snapshot={freeAgents:{count:0,players:[]},waivers:{count:1,players:[w]}};
 const updated={...w,yahooRosterStatus:'W (Nov 25)'};
 const run=async(rows)=>{
  let pass=0;
  const collector=async(filter,onPage)=>{
   const players=filter==='FA'?[]:rows[pass++];
   onPage({players});return {count:players.length,pageCount:1,complete:true,observedAt:stamp};
  };
  const result=await stableLiveOwnership(snapshot,{collector});return {result,pass};
 };
 const same=await run([[w]]);
 assert.equal(same.pass,1);assert.equal(same.result.status,'MATCH');
 const stable=await run([[updated],[updated]]);
 assert.equal(stable.pass,2);assert.equal(stable.result.status,'LIVE_VERIFIED');
 assert.equal(stable.result.live.waivers.players[0].yahooRosterStatus,'W (Nov 25)');
 assert.equal(snapshot.waivers.players[0].yahooRosterStatus,'W (Nov 24)');
 const unstable=await run([[updated],[w]]);
 assert.equal(unstable.result.status,'UNSTABLE');assert.equal(unstable.result.live,null);
});
