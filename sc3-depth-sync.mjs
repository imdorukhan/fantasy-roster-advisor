import {depthSource, teams, validateDepth} from './sc3-depth-store.mjs';
import {withScopedTransaction} from './sc3-postgres.mjs';
import {authorized} from './sc3-yahoo-full-sync.mjs';

const teamNames = ['Atlanta','Boston','Brooklyn','Charlotte','Chicago','Cleveland','Dallas','Denver','Detroit','Golden State','Houston','Indiana','LA Clippers','LA Lakers','Memphis','Miami','Milwaukee','Minnesota','New Orleans','New York','Oklahoma City','Orlando','Philadelphia','Phoenix','Portland','Sacramento','San Antonio','Toronto','Utah','Washington'];
const fail = code => Object.assign(new Error(code), {code});

export function parseTables(tables) {
  if (!Array.isArray(tables) || tables.length !== 30) throw fail('invalid_team_coverage');
  const rows = tables.flatMap(table => {
    const nba_team = teams[teamNames.indexOf(table.header)];
    if (!nba_team || !Array.isArray(table.rows)) throw fail('invalid_team_coverage');
    return table.rows.map(row => {
      const label = row.text?.match(/^(PG|SG|SF|PF|C)(\d+)\s*-\s*(.+)$/);
      const espn_id = row.href?.match(/^https:\/\/www\.espn\.com\/nba\/player\/_\/id\/(\d+)\//)?.[1];
      if (!label || !espn_id || !row.name || (label[3] !== row.name && label[3] !== row.name + ' (IL)')) throw fail('invalid_player_row');
      return {nba_team, position:label[1], rank:Number(label[2]), espn_id, player_name:row.name, injury_marker:label[3].endsWith(' (IL)') ? 'IL' : null};
    });
  });
  validateRows(rows);
  return rows;
}

export function validateRows(rows) {
  validateDepth(rows);
  const seen = new Set();
  for (const row of rows) {
    const key = [row.nba_team,row.position,row.espn_id].join('|');
    if (!/^[1-9]\d*$/.test(row.espn_id) || ![null,'IL'].includes(row.injury_marker) || seen.has(key)) throw fail('invalid_player_identity');
    seen.add(key);
  }
  return rows;
}

export async function collectDepth() {
  const [{default:puppeteer},{default:chromium}] = await Promise.all([import('puppeteer-core'),import('@sparticuz/chromium')]);
  const browser = await puppeteer.launch({args:await puppeteer.defaultArgs({args:chromium.args,headless:'shell'}),executablePath:await chromium.executablePath(),headless:'shell'});
  try {
    const page = await browser.newPage();
    const response = await page.goto(depthSource,{waitUntil:'domcontentloaded',timeout:45000});
    if (response?.status() !== 200 || page.url() !== depthSource) throw fail('source_http_unavailable');
    await page.waitForSelector('table',{timeout:20000});
    const tables = await page.evaluate(() => [...document.querySelectorAll('table')].filter(table => !table.querySelector('table')).map(table => ({
      header:table.rows[0]?.innerText.trim(),
      rows:[...table.rows].slice(1).map(row => ({text:row.innerText.trim(),name:row.querySelector('a')?.innerText.trim(),href:row.querySelector('a')?.href}))
    })));
    return {rows:parseTables(tables),observedAt:new Date().toISOString(),source:depthSource,http:200};
  } finally { await browser.close(); }
}

const semantic = rows => JSON.stringify(rows.map(row => [row.nba_team,row.position,row.rank,row.espn_id,row.injury_marker]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));

export async function saveDepth(batch,{transaction=withScopedTransaction}={}) {
  validateRows(batch.rows);
  if (batch.source !== depthSource || !Number.isFinite(Date.parse(batch.observedAt)) || Math.abs(Date.now()-Date.parse(batch.observedAt))>300000) throw fail('invalid_observation');
  return transaction(async client => {
    await client.query('lock table sc3.nba_depth_chart in exclusive mode');
    const previous = (await client.query('select nba_team,position,rank,espn_id,injury_marker,observed_at from sc3.nba_depth_chart')).rows;
    if (previous.some(row => new Date(row.observed_at).getTime() >= Date.parse(batch.observedAt))) throw fail('older_observation');
    const changed = semantic(previous) !== semantic(batch.rows);
    await client.query('delete from sc3.nba_depth_chart');
    const inserted = await client.query(`insert into sc3.nba_depth_chart(nba_team,position,rank,espn_id,player_name,injury_marker,observed_at,source)
      select nba_team,position,rank,espn_id,player_name,injury_marker,$2::timestamptz,$3
      from jsonb_to_recordset($1::jsonb) as r(nba_team text,position text,rank integer,espn_id text,player_name text,injury_marker text)`,[JSON.stringify(batch.rows),batch.observedAt,depthSource]);
    if (inserted.rowCount !== batch.rows.length) throw fail('incomplete_database_write');
    return {changed};
  },{readOnly:false});
}

export async function verifyDepth(batch,{transaction=withScopedTransaction}={}) {
  return transaction(async client => {
    const stored = (await client.query('select nba_team,position,rank,espn_id,player_name,injury_marker,observed_at,source from sc3.nba_depth_chart')).rows;
    validateRows(stored);
    if (stored.length !== batch.rows.length || semantic(stored) !== semantic(batch.rows) || stored.some(row => new Date(row.observed_at).getTime() !== Date.parse(batch.observedAt) || row.source !== depthSource)) throw fail('readback_failed');
    return {teams:30,positions:150,rows:stored.length,observedAt:batch.observedAt,source:depthSource};
  },{readOnly:true});
}

export async function depthSync(req,res,{env=process.env,collect=collectDepth,save=saveDepth,verify=verifyDepth,log=console.info}={}) {
  res.setHeader('Cache-Control','private, no-store');
  if (req.method !== 'GET') {res.setHeader('Allow','GET');return res.status(405).json({error:'Method not allowed'});}
  if (!authorized(req,env.CRON_SECRET)) return res.status(401).json({error:'Unauthorized'});
  if (env.SC3_SHARED_DB !== '1' || env.SC3_DEPTH_SYNC_ENABLED !== '1') return res.status(404).json({error:'Sync disabled'});
  let committed = false;
  let stage = 'collect';
  const finish = (http,body) => {const result={mode:'SC3_DEPTH_SYNC',completedAt:new Date().toISOString(),committed,...body};log('SC3_DEPTH_SYNC '+JSON.stringify(result));return res.status(http).json(result);};
  try {
    const batch = await collect();
    stage = 'validate';
    validateRows(batch.rows);
    if (env.SC3_DEPTH_SYNC_WRITE !== '1') return finish(200,{status:'VALIDATED',teams:30,positions:150,rows:batch.rows.length,observedAt:batch.observedAt,source:batch.source,snapshotWrites:0});
    stage = 'save';
    let saved;
    try {saved=await save(batch);committed=true;}
    catch {try {stage = 'verify';const checked=await verify(batch);committed=true;return finish(200,{status:'PASS',...checked,snapshotWrites:1,changed:null,notify:true});} catch {committed=null;throw fail('write_outcome_unverified');}}
    stage = 'verify';
    const checked = await verify(batch);
    return finish(200,{status:'PASS',...checked,...saved,snapshotWrites:1,notify:saved.changed});
  } catch (error) {
    const codes=['invalid_team_coverage','invalid_player_row','invalid_player_identity','source_http_unavailable','invalid_observation','older_observation','incomplete_database_write','readback_failed','write_outcome_unverified'];
    const knownValidationErrors = new Map([
      ['Incomplete depth chart','incomplete_depth_coverage'],
      ['Incomplete team/position coverage','incomplete_depth_coverage'],
      ['Invalid depth row','invalid_depth_row'],
      ['Invalid depth ordering','invalid_depth_ordering']
    ]);
    const category = codes.includes(error?.code)?error.code:(knownValidationErrors.get(error?.message)||'depth_sync_unavailable');
    return finish(503,{status:'FAILED',stage,category,snapshotWrites:committed===null?null:committed?1:0,notify:true});
  }
}
