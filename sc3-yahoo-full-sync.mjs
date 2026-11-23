import {createHash, timingSafeEqual} from 'node:crypto';
import {collect} from './scripts/collect-yahoo-ownership.mjs';
import {withScopedTransaction} from './sc3-postgres.mjs';

export const leagueId = 85892;
const leagueKey = '478.l.85892';
const teamKeys = Array.from({length:14}, (_,i) => `${leagueKey}.t.${i+1}`);
const apiSource = 'Yahoo Fantasy Sports API';
const listSource = 'Yahoo Fantasy Basketball league player list';
export const sections = ['all_rosters','free_agents','waivers','settings','teams','standings','scoreboard','roster'];
const core = sections.slice(0,3);
const fail = code => Object.assign(Error(code), {code});
const allowed = new Set(['invalid_yahoo_batch','incomplete_ownership_pages','ownership_changed_during_collection','source_unavailable','older_observation','snapshot_write_failed','snapshot_readback_failed','owner_authorization_unavailable','refresh_store_unavailable','refresh_busy','refresh_outcome_uncertain','invalid_refresh_response','refresh_save_failed','session_changed_during_refresh','sync_deadline']);
const category = error => allowed.has(error?.code) ? error.code : 'source_unavailable';

function count(node, key) {
  if (!node || typeof node !== 'object') return null;
  if (Object.hasOwn(node,key)) {
    const n=node[key]?.count;
    return /^(0|[1-9]\d*)$/.test(String(n)) ? Number(n) : null;
  }
  for (const value of Object.values(node)) { const n=count(value,key); if(n!==null)return n; }
  return null;
}
function timestamp(value, now) {
  const time=Date.parse(value);
  if (!Number.isFinite(time) || time>now || now-time>5*60_000) throw fail('invalid_yahoo_batch');
}
function playersValid(players, seen, ownership=false) {
  if (!Array.isArray(players)) throw fail('invalid_yahoo_batch');
  for (const p of players) {
    if (typeof p.yahooId!=='string' || !/^[1-9]\d*$/.test(p.yahooId) || typeof p.name!=='string' || !p.name.trim() || seen.has(p.yahooId)) throw fail('invalid_yahoo_batch');
    seen.add(p.yahooId);
    if (ownership && (p.nbaTeam!==undefined && !/^[A-Z]{2,3}$/.test(p.nbaTeam) ||
        p.eligiblePositions!==undefined && (!Array.isArray(p.eligiblePositions) || !p.eligiblePositions.length || new Set(p.eligiblePositions).size!==p.eligiblePositions.length || p.eligiblePositions.some(x=>!['PG','SG','SF','PF','C'].includes(x))))) throw fail('invalid_yahoo_batch');
  }
}
export function validateBatch(batch, now=Date.now()) {
  if (!Array.isArray(batch) || batch.length!==sections.length || new Set(batch.map(r=>r.section)).size!==sections.length || batch.some(r=>!sections.includes(r.section))) throw fail('invalid_yahoo_batch');
  const rows=Object.fromEntries(batch.map(r=>[r.section,r]));
  for (const row of batch) timestamp(row.observed_at, now);
  const r=rows.all_rosters.payload;
  if (r?.mode!=='YAHOO_ALL_ROSTERS' || r.leagueId!==leagueId || r.complete!==true || r.teamCount!==14 || !Array.isArray(r.errors) || r.errors.length || r.observedAt!==rows.all_rosters.observed_at || !Array.isArray(r.teams) || r.teams.length!==14 || new Set(r.teams.map(t=>t.key)).size!==14 || r.teams.some(t=>!teamKeys.includes(t.key)||!t.players?.length)) throw fail('invalid_yahoo_batch');
  const seen=new Set();
  for (const team of r.teams) playersValid(team.players,seen);
  if (seen.size!==r.playerCount || rows.all_rosters.source!==apiSource) throw fail('invalid_yahoo_batch');
  for (const [section,filter] of [['free_agents','FA'],['waivers','W']]) {
    const row=rows[section], p=row.payload;
    if (row.source!==listSource || p?.leagueId!==leagueId || p.sourceFilter!==filter || p.complete!==true || p.individualOwnershipVerified!==true || !Array.isArray(p.players) || p.count!==p.players.length || !Number.isInteger(p.pageCount) || p.pageCount<1 || p.sourceUrl!==`https://basketball.fantasysports.yahoo.com/nba/85892/players?status=${filter}` || p.players.some(x=>x.availability!==(filter==='FA'?'FREE_AGENT':'WAIVERS') || (filter==='FA' ? x.yahooRosterStatus!=='FA' : !/^W \([A-Z][a-z]{2} \d{1,2}\)$/.test(x.yahooRosterStatus)))) throw fail('invalid_yahoo_batch');
    playersValid(p.players,seen,true);
  }
  for(const section of sections.slice(3))if(rows[section].source!==apiSource || !rows[section].payload || typeof rows[section].payload!=='object')throw fail('invalid_yahoo_batch');
  return batch;
}

// Compare meaning, not timestamps, source formatting or API response ordering.
function canonical(value) {
  if(Array.isArray(value))return value.map(canonical);
  if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).filter(k=>!['observedAt','observed_at','startedAt','completedAt'].includes(k)).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
export function membership(payload, section) {
  const player=p=>({id:p.yahooId,availability:p.availability??null,rosterStatus:p.yahooRosterStatus??null,status:p.status??null,slot:p.slot??null,nbaTeam:p.nbaTeam??null,positions:p.eligiblePositions ? [...p.eligiblePositions].sort() : null});
  const sort=list=>list.map(player).sort((a,b)=>a.id.localeCompare(b.id));
  if(section==='all_rosters')return payload?.teams?.map(t=>({key:t.key,players:sort(t.players)})).sort((a,b)=>a.key.localeCompare(b.key))??null;
  return payload?.players ? sort(payload.players) : null;
}
const fingerprint=(payload, section)=>createHash('sha256').update(JSON.stringify(core.includes(section)?membership(payload,section):canonical(payload??null))).digest('hex');

async function ownership(filter, {collector,now,signal}) {
  const pages=[];
  const result=await collector(filter,page=>pages.push(page),{now:()=>new Date(now()),signal});
  if(result.complete!==true || !pages.length || result.pageCount!==pages.length || pages.some((p,i)=>p.filter!==filter || p.offset!==i*25 || p.http!==200 || p.complete!==(i===pages.length-1) || !Array.isArray(p.players) || p.players.length>25 || (i<pages.length-1 && p.players.length!==25))) throw fail('incomplete_ownership_pages');
  const players=pages.flatMap(p=>p.players);
  if(result.count!==players.length || result.observedAt!==pages.at(-1).observedAt)throw fail('incomplete_ownership_pages');
  return {section:filter==='FA'?'free_agents':'waivers',source:listSource,observed_at:result.observedAt,payload:{leagueId,sourceFilter:filter,complete:true,individualOwnershipVerified:true,count:players.length,pageCount:pages.length,sourceUrl:result.sourceUrl,paginationScope:result.paginationScope,players}};
}

export async function collectBatch({client,findTeams,findPlayers,collector=collect,now=Date.now,signal}) {
  const read=async path=>{if(signal?.aborted)throw fail('sync_deadline');return client.read(path)};
  const rawTeams=await read(`league/${leagueKey}/teams?format=json`), teams=findTeams(rawTeams);
  if(count(rawTeams,'teams')!==14 || teams.length!==14 || new Set(teams.map(t=>t.key)).size!==14 || teams.some(t=>!teamKeys.includes(t.key)))throw fail('invalid_yahoo_batch');
  const output=[], rawRoster={};
  for(let start=0;start<14;start+=4){
    const results=await Promise.all(teams.slice(start,start+4).map(async team=>{
      const raw=await read(`team/${team.key}/roster?format=json`), players=findPlayers(raw);
      if(count(raw,'players')!==players.length)throw fail('invalid_yahoo_batch');
      rawRoster[team.key]=raw;
      return {...team,players};
    }));
    output.push(...results);
  }
  const observedAt=new Date(now()).toISOString();
  const batch=[{section:'all_rosters',source:apiSource,observed_at:observedAt,payload:{mode:'YAHOO_ALL_ROSTERS',leagueId,observedAt,teamCount:14,playerCount:output.reduce((n,t)=>n+t.players.length,0),errors:[],teams:output,complete:true}}];
  for(const filter of ['FA','W'])batch.push(await ownership(filter,{collector,now,signal}));
  batch.push({section:'teams',source:apiSource,payload:rawTeams,observed_at:observedAt});
  batch.push({section:'roster',source:apiSource,payload:rawRoster[`${leagueKey}.t.5`],observed_at:observedAt});
  for(const section of ['settings','standings','scoreboard']) {
    const raw=await read(`league/${leagueKey}/${section}?format=json`);
    const meta=Array.isArray(raw.league)?raw.league.find(x=>x?.league_key):null;
    const contains=node=>node && typeof node==='object' && (Object.hasOwn(node,section) || Object.values(node).some(contains));
    if(meta?.league_key!==leagueKey || !contains(raw.league))throw fail('invalid_yahoo_batch');
    batch.push({section,source:apiSource,payload:raw,observed_at:new Date(now()).toISOString()});
  }
  return validateBatch(batch,now());
}

export async function saveBatch(batch,{transaction=withScopedTransaction,now=Date.now}={}) {
  validateBatch(batch,now());
  return transaction(async c=>{
    await c.query('select pg_advisory_xact_lock(85892, 3)');
    const prior=(await c.query('select section,payload,observed_at from sc3.yahoo_league_snapshots where league_id=85892 and section=any($1::text[]) for update',[sections])).rows;
    if(prior.some(p=>new Date(batch.find(r=>r.section===p.section).observed_at).getTime()<=new Date(p.observed_at).getTime()))throw fail('older_observation');
    const changed=batch.filter(r=>fingerprint(r.payload,r.section)!==fingerprint(prior.find(p=>p.section===r.section)?.payload,r.section)).map(r=>r.section);
    const result=await c.query(`with snapshots as (
      insert into sc3.yahoo_league_snapshots(league_id,section,payload,observed_at,source)
      select 85892,section,payload,observed_at,source from jsonb_to_recordset($1::jsonb) as r(section text,payload jsonb,observed_at timestamptz,source text)
      on conflict(league_id,section) do update set payload=excluded.payload,observed_at=excluded.observed_at,source=excluded.source
      where sc3.yahoo_league_snapshots.observed_at<excluded.observed_at
      returning section,payload,observed_at
    ), history as (
      insert into sc3.yahoo_league_snapshot_history(league_id,section,payload,observed_at)
      select 85892,section,payload,observed_at from snapshots returning section
    ) select (select count(*)::int from snapshots) as snapshots,(select count(*)::int from history) as history`,[JSON.stringify(batch)]);
    if(result.rows[0]?.snapshots!==sections.length || result.rows[0]?.history!==sections.length)throw fail('snapshot_write_failed');
    return {changedSections:changed};
  },{readOnly:false});
}

export async function verifyBatch(expected,{transaction=withScopedTransaction,now=Date.now}={}) {
  return transaction(async c=>{
    const rows=(await c.query(`select s.section,s.payload,s.observed_at,s.source,
      exists(select 1 from sc3.yahoo_league_snapshot_history h where h.league_id=s.league_id and h.section=s.section and h.observed_at=s.observed_at and h.payload=s.payload) as history_match
      from sc3.yahoo_league_snapshots s where s.league_id=85892 and s.section=any($1::text[])`,[sections])).rows;
    validateBatch(rows.map(r=>({...r,observed_at:new Date(r.observed_at).toISOString()})),now());
    if(rows.some(r=>!r.history_match || !expected.some(e=>e.section===r.section && new Date(e.observed_at).getTime()===new Date(r.observed_at).getTime() && JSON.stringify(canonical(e.payload))===JSON.stringify(canonical(r.payload)) && e.source===r.source)))throw fail('snapshot_readback_failed');
    const data=Object.fromEntries(rows.map(r=>[r.section,r.payload]));
    return {teamCount:data.all_rosters.teamCount,playerCount:data.all_rosters.playerCount,freeAgents:data.free_agents.count,waivers:data.waivers.count,overlap:0,historyMatches:rows.length};
  },{readOnly:true});
}

export function authorized(req,secret) {
  if(typeof secret!=='string'||secret.length<32||typeof req.headers?.authorization!=='string')return false;
  const a=Buffer.from(req.headers.authorization), b=Buffer.from('Bearer '+secret);
  return a.length===b.length&&timingSafeEqual(a,b);
}
export async function fullSync(req,res,{env=process.env,now=Date.now,loadSession,createClient,findTeams,findPlayers,collector=collect,save=saveBatch,verify=verifyBatch,log=console.info}={}) {
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Method not allowed'})}
  if(!authorized(req,env.CRON_SECRET))return res.status(401).json({error:'Unauthorized'});
  if(env.SC3_YAHOO_FULL_SYNC_ENABLED!=='1'||env.SC3_SHARED_DB!=='1')return res.status(404).json({error:'Sync disabled'});
  const startedAt=new Date(now()).toISOString(),write=env.SC3_YAHOO_FULL_SYNC_WRITE==='1';
  let client, committed=false, saveAttempted=false;
  const finish=(http,result)=>{
    const summary={mode:'SC3_YAHOO_FULL_SYNC',leagueId,startedAt,completedAt:new Date(now()).toISOString(),snapshotWriteEnabled:write,committed,oauthRefreshAttempted:Boolean(client?.refreshAttempted),oauthRefreshed:Boolean(client?.refreshed),...result};
    log('SC3_YAHOO_FULL_SYNC '+JSON.stringify(summary));return res.status(http).json(summary);
  };
  try{
    const owner=await loadSession();if(!owner?.tokens)throw fail('owner_authorization_unavailable');
    client=createClient(owner);await client.ready();
    const signal=AbortSignal.timeout(180_000),deps={client,findTeams,findPlayers,collector,now,signal};
    // Two complete observations catch membership, team, status and position changes
    // during pagination. Yahoo does not offer an upstream transactional snapshot.
    const first=await collectBatch(deps), batch=await collectBatch(deps);
    if(core.some(section=>fingerprint(first.find(r=>r.section===section).payload,section)!==fingerprint(batch.find(r=>r.section===section).payload,section)))throw fail('ownership_changed_during_collection');
    if(signal.aborted)throw fail('sync_deadline');
    const observations=batch.map(r=>({section:r.section,observedAt:r.observed_at,source:r.source,...(core.includes(r.section)?{count:r.payload.count??r.payload.playerCount,pageCount:r.payload.pageCount??null}:{})}));
    if(!write)return finish(200,{status:'VALIDATED',complete:true,dryRun:true,observations,teamCount:14,playerCount:batch.find(r=>r.section==='all_rosters').payload.playerCount,freeAgents:batch.find(r=>r.section==='free_agents').payload.count,waivers:batch.find(r=>r.section==='waivers').payload.count,overlap:0,snapshotWrites:0});
    saveAttempted=true;
    let saved;
    try{saved=await save(batch);committed=true}
    catch(error){
      // A lost COMMIT acknowledgement is ambiguous. Read back this exact batch;
      // never issue a second write or claim that the old snapshot was preserved.
      try{
        const checked=await verify(batch);committed=true;
        return finish(200,{status:'PASS',complete:true,...checked,observations,snapshotWrites:sections.length,changedSections:null,notify:true,category:'write_ack_recovered'});
      }catch{if(error?.code==='older_observation')throw error;committed=null;throw fail('snapshot_write_failed')}
    }
    const checked=await verify(batch);
    return finish(200,{status:'PASS',complete:true,...checked,...saved,observations,snapshotWrites:sections.length,notify:saved.changedSections.length>0});
  }catch(error){return finish(503,{status:'FAILED',complete:false,category:committed===true?'snapshot_readback_failed':category(error),snapshotWrites:committed===null&&saveAttempted?null:committed?sections.length:0,notify:true})}
}
