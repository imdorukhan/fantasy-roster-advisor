// Regression: official Yahoo snapshot (verified by server) can be >5 minutes old.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join,resolve} from 'node:path';
import puppeteer from 'puppeteer-core';

const root=resolve(import.meta.dirname,'..');
const LA=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shift=(date,days)=>new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
const ours={'FG%':.49,'FT%':.8,'3PM':22,PTS:120,REB:56,AST:30,STL:10,BLK:7,TO:11};
const opponent={'FG%':.48,'FT%':.79,'3PM':21,PTS:119,REB:55,AST:29,STL:9,BLK:6,TO:12};
const makeOfficial=(ageMinutes)=>({
 mode:'YAHOO_OFFICIAL_MATCHUP',source:'Yahoo Fantasy Sports API',leagueId:85892,
 week:6,weekVerified:true,weekStart:shift(LA(),-1),weekEnd:shift(LA(),5),
 ourTeam:{id:5,name:'Salary CAPtain',stats:ours,remainingGames:12},
 opponent:{id:13,name:'Opponent',stats:opponent,remainingGames:14},
 score:{ours:9,opponent:0,ties:0},categories:Object.keys(ours).map(category=>({category,ours:ours[category],opponent:opponent[category],leader:'OURS'})),
 observedAt:new Date(Date.now()-ageMinutes*60000).toISOString(),readOnly:true
});
let ageMinutes=60;
const allowed=new Set(['/matchup.html','/player-dialog.mjs','/decision-core.mjs','/matchup-source-health.mjs']);
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/api/auto-data'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(makeOfficial(ageMinutes)));return;}
 if(path==='/api/yahoo-matchup'){res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"Public Yahoo matchup unavailable"}');return;}
 if(path==='/api/public-matchup'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({rosters:{ours:[],opponent:[]},sources:[{source:'Yahoo matchup',status:'unavailable'}]}));return;}
 if(!allowed.has(path)){res.writeHead(404);res.end();return;}
 const content=await readFile(join(root,path));res.writeHead(200,{'content-type':path.endsWith('html')?'text/html':'text/javascript'});res.end(content);
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const browser=await puppeteer.launch({executablePath:process.env.SC3_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-extensions','--no-first-run']});
const page=await browser.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try {
 const url='http://127.0.0.1:'+server.address().port+'/matchup.html';
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>!document.querySelector('#refresh').disabled,{timeout:7500});
 assert.equal(await page.$eval('#score-summary',e=>e.textContent),'9 – 0 – 0','1h-old server-verified official result must remain visible');
 assert.match(await page.$eval('#health',e=>e.textContent),/Yahoo official API: VERIFIED/);
 assert.match(await page.$eval('#health',e=>e.textContent),/Yahoo public observation: UNAVAILABLE \/ STALE/);
 ageMinutes=31*60; // Backend would reject this; client must also fail closed.
 await page.click('#refresh');
 await page.waitForFunction(()=>!document.querySelector('#refresh').disabled,{timeout:7500});
 assert.equal(await page.$eval('#score-summary',e=>e.textContent),'Unverified','expired official result must not remain visible');
 assert.deepEqual(errors,[]);
 console.log('PASS matchup freshness: verified official 1h old shown; public scrape remains unavailable; 31h old blocked; no JS errors.');
} finally {await browser.close();await new Promise(ok=>server.close(ok));}
