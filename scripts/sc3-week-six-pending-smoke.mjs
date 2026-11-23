// Based on the 2026-11-23 Yahoo Week 6 scoreboard: team 5 vs 2, no 9-CAT values yet.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,join} from 'node:path';
import puppeteer from 'puppeteer-core';
const root=resolve(import.meta.dirname,'..');
const fixture={
 mode:'YAHOO_OFFICIAL_MATCHUP_STATS_PENDING',
 leagueId:85892,teamId:5,week:6,weekStart:'2026-11-23',weekEnd:'2026-11-29',
 weekVerified:true,scoreVerified:false,
 observedAt:new Date().toISOString(),readOnly:true,
 ourTeam:{id:5,name:'Salary CAPtain'},
 opponent:{id:2,name:'Verified Week Six Opponent'},
 error:'Yahoo current-week category totals not published'
};
const files=new Set(['/matchup.html','/optimizer.html','/player-dialog.mjs','/decision-core.mjs','/matchup-source-health.mjs']);
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://127.0.0.1').pathname;
 if(path==='/api/auto-data'){
  const lineup=req.url.includes('sc3MatchupLineups');
  res.writeHead(422,{'content-type':'application/json','cache-control':'private,no-store'});
  res.end(JSON.stringify(lineup?{mode:'YAHOO_CURRENT_WEEK_STATS_PENDING',error:'Yahoo has not published current-week 9-CAT totals yet',readOnly:true}:fixture));
  return;
 }
 if(path==='/api/yahoo-matchup'){res.writeHead(503,{'content-type':'application/json'});res.end('{}');return;}
 if(path==='/api/public-matchup'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({rosters:{ours:[],opponent:[]},sources:[]}));return;}
 if(!files.has(path)){res.writeHead(404);res.end();return;}
 const file=await readFile(join(root,path));
 res.writeHead(200,{'content-type':path.endsWith('.html')?'text/html':'text/javascript'});res.end(file);
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const browser=await puppeteer.launch({executablePath:process.env.SC3_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-first-run','--disable-extensions']});
try{
 const base='http://127.0.0.1:'+server.address().port;
 for(const path of ['/matchup.html','/optimizer.html']){
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+path,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.querySelector('#refresh').disabled,{timeout:9000});
  if(path==='/matchup.html'){
   assert.equal(await page.$eval('#opponent-name',e=>e.textContent),fixture.opponent.name);
   assert.match(await page.$eval('#matchup-week-label',e=>e.textContent),/Week 6.*2026-11-23.*2026-11-29/);
   assert.equal(await page.$eval('#score-summary',e=>e.textContent),'Stats pending');
   assert.match(await page.$eval('#health',e=>e.textContent),/WEEK VERIFIED \/ CATEGORY TOTALS PENDING/);
   assert.match(await page.$eval('#categories',e=>e.textContent),/not been published/i);
  } else {
   assert.match(await page.$eval('#matchup-teams',e=>e.textContent),/Week 6/);
   assert.equal(await page.$eval('#score',e=>e.textContent),'—');
   assert.match(await page.$eval('#matchup-source',e=>e.textContent),/totals are not yet published/i);
   assert.match(await page.$eval('#lineup-status',e=>e.textContent),/totals are not yet published/i);
  }
  assert.deepEqual(errors,[]);
  await page.close();
 }
 console.log('PASS 2026-11-23 week-six pending: verified opponent/date visible; no 9-CAT score or projections; zero browser JS errors.');
}finally{await browser.close();await new Promise(ok=>server.close(ok));}
