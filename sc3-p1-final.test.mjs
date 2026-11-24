import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveProfileOwnership,excludeAvailableFromRoster,observeProfileOwnership} from './sc3-profile-ownership.mjs';
import {parseEspnCatalogProfile,recoverHistoryCatalog} from './sc3-catalog-recovery.mjs';
import {resolveRosterBirthFallback} from './sc3-roster-identity.mjs';
import {planWaiverIdentityChecks,waiverImpactCoverage} from './sc3-waiver-impact.mjs';
const stamp='2026-11-24T12:00:00Z',now=new Date('2026-11-24T12:30:00Z');
const player={yahooId:'10333',name:'Jamal Shead',nbaTeam:'TOR',jersey:'1'};
const w={...player,availability:'WAIVERS',yahooRosterStatus:'W (Nov 25)'};
const teams=Array.from({length:14},(_,i)=>({key:'478.l.85892.t.'+(i+1),name:'Team '+(i+1),players:[i===4?player:{yahooId:String(i+1),name:'Other'}]}));
const rows={all_rosters:{observed_at:stamp,payload:{leagueId:85892,mode:'YAHOO_ALL_ROSTERS',complete:true,teamCount:14,playerCount:14,teams}}};
const group=players=>({players,count:players.length,observedAt:stamp});
const observation=(fa,waivers,status='LIVE_VERIFIED')=>({status,live:{freeAgents:group(fa),waivers:group(waivers)}});
test('live waiver overrides stale roster and removes stale drop option',()=>{
 const live=observation([],[w]);
 const result=resolveProfileOwnership(rows,'10333',live,now);
 assert.equal(result.ownership,'WAIVERS');assert.equal(result.player.yahooRosterStatus,'W (Nov 25)');
 assert.equal(result.teamKey,undefined);
 assert.deepEqual(excludeAvailableFromRoster([player],live),[]);
 assert.equal(resolveProfileOwnership(rows,'10333',observation([],[]),now).ownership,'ROSTERED');
});
test('newly available player can open a profile and unknown or unstable ownership fails closed',()=>{
 const newPlayer={...w,yahooId:'99999'};
 assert.equal(resolveProfileOwnership(rows,'99999',observation([],[newPlayer]),now).ownership,'WAIVERS');
 assert.equal(resolveProfileOwnership(rows,'99999',observation([],[]),now),null);
 assert.throws(()=>resolveProfileOwnership(rows,'10333',observation([],[],'UNSTABLE'),now),/unavailable/);
 assert.throws(()=>resolveProfileOwnership(rows,'10333',observation([w],[w]),now),/Conflicting/);
});
test('profile ownership observer uses complete verified snapshots and refuses unavailable source',async()=>{
 const groupRow=(filter,players)=>({section:filter==='FA'?'free_agents':'waivers',observed_at:stamp,payload:{leagueId:85892,sourceFilter:filter,complete:true,individualOwnershipVerified:true,count:players.length,players}});
 const saved={free_agents:groupRow('FA',[]),waivers:groupRow('W',[w])};
 const result=await observeProfileOwnership(saved,{now,observer:async s=>{assert.equal(s.waivers.count,1);return observation([],[w]);}});
 assert.equal(result.status,'LIVE_VERIFIED');
 await assert.rejects(observeProfileOwnership(saved,{now,observer:async()=>({status:'UNSTABLE',live:null})}),/unavailable/);
});
const seed={espnId:'4431734',name:'Tristan Enaruna',team:'CLE',games:3};
const bio={athlete:{id:'4431734',displayName:'Tristan Enaruna',team:{abbreviation:'CLE'},displayDOB:'6/26/2001',active:false}};
test('missing ESPN history catalog is independently verified and never treated as active merely because games exist',async()=>{
 assert.equal(parseEspnCatalogProfile(bio,seed).birthDate,'2001-06-26');
 assert.equal(parseEspnCatalogProfile(bio,seed).active,false);
 assert.equal(parseEspnCatalogProfile({...bio,athlete:{...bio.athlete,id:'99'}},seed),null);
 assert.equal(parseEspnCatalogProfile({...bio,athlete:{...bio.athlete,displayDOB:'2/30/2001'}},seed),null);
 const players=[{yahooId:'10392',name:seed.name,nbaTeam:'CLE',extraStarts:2}];
 const r=await recoverHistoryCatalog(players,[seed],async u=>{assert.match(u,/4431734\?lang=en&region=us$/);return {ok:true,json:async()=>bio};});
 assert.equal(r.attempted,1);assert.equal(r.profiles.length,1);
 assert.equal(planWaiverIdentityChecks(players,[],r.profiles).reasons.get('10392'),'NBA_PROFILE_INACTIVE');
});
test('catalog diagnostics distinguish missing names, team mismatch, collision, unverified history and inactive NBA player',()=>{
 const players=['A','B','C','D','E'].map((name,i)=>({name,yahooId:String(i+1),nbaTeam:'CLE',extraStarts:1}));
 const catalog=[{name:'A',team:'TOR',espnId:'100',games:5},{name:'B',team:'CLE',espnId:'101',games:5},{name:'C',team:'CLE',espnId:'102',games:5,active:false}];
 const pre=planWaiverIdentityChecks(players,[],catalog,{occupied:[{espn_id:'101'}],missingSeeds:[{name:'D',team:'CLE'}]});
 assert.deepEqual([...pre.reasons.values()],['CATALOG_TEAM_MISMATCH','ESPN_ID_LINKED_TO_OTHER_YAHOO','NBA_PROFILE_INACTIVE','HISTORY_PROFILE_UNVERIFIED','NO_CATALOG_MATCH']);
 assert.equal(waiverImpactCoverage(players,[],[],[],pre).unresolved.length,5);
});
test('jersey mismatch requires matching independent DOB and does not overwrite existing ESPN link',async()=>{
 const catalog=[{espnId:'4432241',name:'Jamal Shead',team:'TOR',jersey:'23',birthDate:'2002-07-24'}];
 const yahoo=async()=>({ok:true,text:async()=>'<title>Jamal Shead (PG) Stats</title> '+String.raw`\"birthDate\":\"2002-07-24\"`});
 const matches=await resolveRosterBirthFallback([player],[],catalog,yahoo);
 assert.equal(matches.length,1);assert.equal(matches[0].espn_id,'4432241');assert.equal(matches[0].persisted,false);
 assert.equal((await resolveRosterBirthFallback([player],[{yahoo_id:'88',espn_id:'4432241'}],catalog,yahoo)).length,0);
});
