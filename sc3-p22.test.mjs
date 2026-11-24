import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOfficialPages,officialPublication,selectOfficialReport,officialIndexUrls,discoverOfficialReport,readOfficialInjuries,extractOfficialPages} from './sc3-nba-official-injuries.mjs';
import {settleCBSObservation,cbsBoundMetrics} from './sc3-cbs-settlement.mjs';
import {modelPromotion} from './sc3-model-promotion.mjs';
import {NINE_CAT} from './decision-core.mjs';
import {historicalCoverage,historicalScoreboardPath,readHistoricalCoverage} from './sc3-final-archive.mjs';
import {safeP22SourceFailure,readP22Evidence} from './sc3-p22-source-diagnostics.mjs';
import {p22Cron,writerConfig} from './sc3-p22-writer.mjs';
const url='https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-11-24_01_00PM.pdf';
const publishedAt='2026-11-24T18:00:00.000Z',observedAt='2026-11-24T18:15:00.000Z';
const item=(str,x,y)=>({str,transform:[1,0,0,1,x,y]});
const header=[item('Injury Report: 11/24/26 01:00 PM',289,533)];
const footer=i=>item('Page '+i+' of 2',399,50);
const page1={width:842,items:[...header,footer(1),item('Game Date',23,480),item('Game Time',120,480),item('Matchup',200,480),item('Team',264,480),item('Player Name',425,480),item('Current Status',586,480),item('Reason',666,480),item('11/24/2026',24,459),item('07:00 (ET)',120,459),item('DET@ORL',200,459),item('Detroit Pistons',265,459),item('Cunningham, Cade',426,459),item('Probable',587,459),item('Knee',667,459)]};
const page2={width:842,items:[...header,footer(2),item('Duren, Jalen',426,505),item('Out',587,505),item('Hamstring',667,505),item('Orlando Magic',265,475),item('NOT YET SUBMITTED',667,475)]};
const catalog=[{espnId:'1',name:'Cade Cunningham',team:'DET'},{espnId:'2',name:'Jalen Duren',team:'DET'}];
test('official PDF parser validates real-shaped continuation, publication, team, page count and non-submission',()=>{
 assert.equal(officialPublication(url),publishedAt);
 assert.equal(officialPublication('https://example.org/a.pdf'),null);
 const future=url.replace('01_00PM','02_00PM');
 assert.equal(selectOfficialReport(future+' '+url,new Date(observedAt)).url,url);
 const out=parseOfficialPages([page1,page2],catalog,{url,publishedAt,observedAt});
 assert.equal(out.parsed,2);assert.equal(out.matched,2);assert.equal(out.notSubmitted.length,1);assert.equal(out.rows[1].status,'Out');assert.equal(out.rows[1].nbaTeam,'DET');
 assert.equal(out.rows[0].kind,'GAME_STATUS_NOT_RETURN_ESTIMATE');
 assert.throws(()=>parseOfficialPages([page1],catalog,{url,publishedAt,observedAt}),/sequence/);
 assert.throws(()=>parseOfficialPages([page1,page2],catalog,{url,publishedAt,observedAt:'2026-11-24T17:00Z'}),/provenance/);
 assert.equal(parseOfficialPages([page1,page2],[...catalog,{...catalog[0],espnId:'3'}],{url,publishedAt,observedAt}).matched,1);
});
const observation={id:'abc',espnId:'2',reportDate:'2026-11-24',earliestReturn:'2026-11-28',observedAt,capturedAt:'2026-11-24T18:16:00Z'};
const cutoff='2026-11-28T12:00Z';
const appearance={espn_id:'2',event_id:'77',game_day:'2026-11-27',tipoff:'2026-11-27T23:00Z',observed_at:'2026-11-28T08:00Z',stats:{MIN:25}};
const days=[24,25,26,27].map(d=>({game_day:'2026-11-'+d,status:'complete',coverage_verified:true,observed_at:cutoff}));
test('CBS lower-bound violation requires first observed appearance, complete history and no pre-capture appearance',()=>{
 const s=settleCBSObservation(observation,[appearance],days,cutoff);assert.equal(s.boundViolated,true);assert.equal(s.daysBeforeBound,1);assert.equal(s.daysAfterBound,0);
 assert.equal(settleCBSObservation(observation,[appearance],days.slice(1),cutoff),null);
 assert.equal(settleCBSObservation(observation,[appearance,{...appearance,game_day:'2026-11-24',tipoff:'2026-11-24T10:00Z'}],days,cutoff),null);
 assert.equal(settleCBSObservation({...observation,earliestReturn:'2026-11-23'},[appearance],days,cutoff),null);
 const second={...observation,id:'def',capturedAt:'2026-11-24T19:00Z'};
 const later=settleCBSObservation(second,[appearance],days,cutoff);
 const pending={...observation,id:'pending',espnId:'3'};
 const m=cbsBoundMetrics([observation,second,pending],[s,later],{asOf:new Date(cutoff)});
 assert.equal(m.independentReturnEvents,1);assert.equal(m.violations,1);assert.equal(m.pending,1);assert.equal(m.boundAdherenceLower95,null);
});
test('promotion requires fixed chronology, adequate coverage and improvement over both baselines',()=>{
 const metric=(mae,brier)=>Object.fromEntries(NINE_CAT.map(k=>[k,{n:500,mae,brier}]));
 const phase={L10:metric(1,0.2),SEASON:metric(1,0.2),L14:metric(.97,.19)};
 const c={available:true,split:'calendar',selected:'L14',counts:{validation:500,test:500},phaseDays:{validation:14,test:14},validation:phase,test:phase};
 assert.equal(modelPromotion(c).eligible,true);
 assert.equal(modelPromotion({...c,exploratory:true}).eligible,false);
 assert.equal(modelPromotion({...c,counts:{validation:41,test:664}}).eligible,false);
 const worse={...phase,L14:{...phase.L14,PTS:{n:500,mae:1.1,brier:.19}}};
 assert.equal(modelPromotion({...c,test:worse}).eligible,false);
});
test('legacy Yahoo history identifies targets but cannot prove final provenance',()=>{
 const team=id=>({team:[[{team_key:'478.l.85892.t.'+id}],{}]});
 const raw={league:[{league_key:'478.l.85892'},{scoreboard:{0:{matchups:{0:{matchup:{week:'5',week_start:'2026-11-16',week_end:'2026-11-22',status:'midevent',0:{teams:{0:team(5),1:team(2)}}}}}}}}]};
 const c=historicalCoverage([{payload:raw,observed_at:'2026-11-22T18:00Z'}],new Date(observedAt));
 assert.equal(c.closedTargets.length,1);assert.equal(c.weeks[0].posteventCandidates,0);assert.equal(c.legacySourceVerified,false);
 assert.equal(historicalScoreboardPath(5),'league/478.l.85892/scoreboard;week=5?format=json');
 assert.throws(()=>historicalScoreboardPath('5'),/Invalid/);
});
test('P2 writer route remains inert in preview or without explicit production flags and credentials',async()=>{
 const state={};const res={setHeader(){},status(n){state.http=n;return this;},json(j){state.json=j;return j;}};
 let invoked=0;const makeWriter=async()=>{invoked++;throw Error('must not call');};
 const on={VERCEL_ENV:'production',SC3_P2_COLLECT_ENABLED:'1',SC3_P2_COLLECT_WRITE:'1',SC3_SHARED_DB:'1',CRON_SECRET:'x'.repeat(40)};
 await p22Cron({method:'GET',headers:{}},res,{env:{...on,VERCEL_ENV:'preview'},makeWriter});assert.equal(state.http,404);
 await p22Cron({method:'GET',headers:{}},res,{env:{...on,SC3_P2_COLLECT_WRITE:'0'},makeWriter});assert.equal(state.http,404);
 await p22Cron({method:'GET',headers:{}},res,{env:on,makeWriter});assert.equal(state.http,401);
 await p22Cron({method:'POST',headers:{authorization:'Bearer '+'x'.repeat(40)}},res,{env:on,makeWriter});assert.equal(state.http,405);assert.equal(invoked,0);
 assert.throws(()=>writerConfig({...on,SC3_P2_WRITER_DATABASE_URL:'postgres://sc3_app:fixture@db.bmsfbcuausbfzheufjtc.supabase.co/postgres'}),/role invalid/);
 assert.throws(()=>writerConfig({...on,VERCEL_ENV:'preview'}),/disabled/);
});

test('dual official indices choose newest published candidate and tolerate one unavailable source',async()=>{
 const now=new Date(observedAt);
 const [official,main]=officialIndexUrls(now);
 assert.equal(official,'https://official.nba.com/nba-injury-report-2026-27-season/');
 assert.equal(officialIndexUrls(new Date('2027-01-02T12:00Z'))[0],official);
 const older=url.replace('01_00PM','12_45PM'),future=url.replace('01_00PM','02_00PM');
 const calls=[];
 const fetcher=async u=>{calls.push(u);if(u===official)throw Error('network');if(u===main)return new Response(older+' '+url+' '+future);if(u===url)return new Response('%PDF-fixture');throw Error('unexpected URL');};
 const selected=await discoverOfficialReport({fetcher,now});
 assert.equal(selected.url,url);assert.equal(selected.indexCoverage,1);assert.equal(selected.indexUrl,main);
 const result=await readOfficialInjuries({fetcher,now,transaction:fn=>fn({query:async()=>({rows:catalog})}),extract:async()=>[page1,page2]});
 assert.equal(result.matched,2);assert.equal(result.indexCoverage,1);assert.match(result.documentDigest,/^[a-f0-9]{64}$/);assert.ok(calls.includes(url));
 const newer=url.replace('01_00PM','01_15PM');
 const latest=await discoverOfficialReport({now,fetcher:async u=>new Response(u===official?newer:url)});
 assert.equal(latest.url,newer);assert.equal(latest.indexCoverage,2);
 await assert.rejects(discoverOfficialReport({now,fetcher:async()=>new Response(future)}),/Fresh official report unavailable/);
 await assert.rejects(discoverOfficialReport({now,fetcher:async()=>new Response('x',{status:503})}),/NBA report index unavailable/);
});
test('serverless text extractor actually loads a minimal generated PDF without native rendering',async()=>{
 // Deterministic PDF fixture generated here, not a real NBA report or prediction.
 const stream='BT /F1 12 Tf 50 100 Td (Fixture PDF text) Tj ET';
 const objs=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream'];
 let pdf='%PDF-1.4\n',offsets=[0];
 for(const [i,obj] of objs.entries()){offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+obj+'\nendobj\n';}
 const start=pdf.length;pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF\n';
 const pages=await extractOfficialPages(new TextEncoder().encode(pdf));
 assert.equal(pages.length,1);assert.equal(pages[0].width,842);assert.ok(pages[0].items.some(i=>i.str==='Fixture PDF text'));
});
test('historical coverage retries only transient read errors and does not invent an archive',async()=>{
 const team=id=>({team:[[{team_key:'478.l.85892.t.'+id}],{}]});
 const raw={league:[{league_key:'478.l.85892'},{scoreboard:{0:{matchups:{0:{matchup:{week:'5',week_start:'2026-11-16',week_end:'2026-11-22',status:'midevent',0:{teams:{0:team(5),1:team(2)}}}}}}}}]};
 const malformed=structuredClone(raw);malformed.league[1].scoreboard[0].matchups[0].matchup[0].teams[0].team[0]={bad:true};
 const rows=[{payload:raw,observed_at:'2026-11-22T18:00Z'},{payload:malformed,observed_at:'2026-11-22T19:00Z'}];
 let attempts=0,reads=0;
 const transaction=async fn=>{if(++attempts===1)throw Object.assign(Error('connection timeout'),{code:'08006'});return fn({query:async sql=>{reads++;return {rows:sql.includes('to_regclass')?[{ready:false}]:rows};}});};
 const h=await readHistoricalCoverage({transaction,now:new Date(observedAt),pause:async()=>{}});
 assert.equal(attempts,2);assert.equal(reads,2);assert.equal(h.observations,2);assert.equal(h.unusableObservations,1);assert.equal(h.closedTargets.length,1);assert.equal(h.archiveStatus,'UNAVAILABLE');assert.equal(h.verifiedFinals,null);
 attempts=0;
 await assert.rejects(readHistoricalCoverage({transaction:async()=>{attempts++;throw Object.assign(Error('permission denied'),{code:'42501'});},pause:async()=>{}}),/permission denied/);
 assert.equal(attempts,1);
});
test('source diagnostics expose only a safe category even if provider errors contain secrets',async()=>{
 assert.equal(safeP22SourceFailure(Error('Cannot find package secret-fixture')),'pdf_dependency_unavailable');
 assert.equal(safeP22SourceFailure(Error('opaque secret-fixture')),'unknown_source_failure');
 assert.deepEqual(await readP22Evidence(async()=>{throw Error('permission denied secret-fixture');}),{data:null,failure:'database_permission'});
 assert.deepEqual(await readP22Evidence(async()=>({observations:12})),{data:{observations:12},failure:null});
});
