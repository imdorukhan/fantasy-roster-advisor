import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,join} from 'node:path';
import puppeteer from 'puppeteer-core';
const root=resolve(import.meta.dirname,'..');
const stamp='2026-11-23T12:00:00.000Z';
const season={complete:true,games:14,values:{PTS:25,REB:7,AST:5,STL:1.1,BLK:1,TO:2,'FG%':.51,'FT%':.8,MPG:31}};
const players=[
 {yahooId:'10001',name:'Verified ESPN Player',slot:'PG',nbaTeam:'GSW',status:'A'},
 {yahooId:'10002',name:'Unmapped Player',slot:'IL',nbaTeam:'LAL',status:'GTD'}
];
const sections=Object.fromEntries(['settings','teams','standings','scoreboard','roster'].map(k=>[k,{}]));
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/api/auto-data'){
  let data={error:'Owner sign-in required'},code=401;
  if(url.searchParams.get('leagueData')==='1'){
   code=200;
   data={mode:'YAHOO_LEAGUE_DATA',rosterPlayers:players,leagueTeams:[{name:'My Team',key:'478.l.85892.t.5'}],
    observedAt:stamp,sections,staleSections:[],readOnly:true};
  }else if(url.searchParams.get('performance')==='1'){
   code=200;
   data={mode:'YAHOO_LINKED_PERFORMANCE',historyEnd:'2026-11-22',expectedEnd:'2026-11-22',fresh:true,
    source:'ESPN completed regular-season box scores',
    players:[{yahooId:'10001',performance:{season,z:{rank:1},signal:{type:'STABLE'}}},{yahooId:'10002',performance:null}]};
  }else if(url.searchParams.get('playerStats')==='1'){
   code=200;data={mode:'YAHOO_PLAYER_STATS',players:players.map(p=>({yahooId:p.yahooId,stats:null}))};
  }else if(url.searchParams.get('sc3Streaming')==='1'){
   code=200;data={mode:'SC3_STREAMING_AVAILABILITY',leagueId:85892,readOnly:true,
    freeAgents:{count:2,observedAt:stamp,players:[
     {yahooId:'20001',name:'Zeta Guard',nbaTeam:'GSW',eligiblePositions:['PG'],availability:'FREE_AGENT'},
     {yahooId:'20002',name:'Alpha Center',nbaTeam:'LAL',eligiblePositions:['C'],availability:'FREE_AGENT'}]},
    waivers:{count:0,observedAt:stamp,players:[]},
    plan:{available:false,reason:'Schedule not checked'}
   };
  }
  res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));return;
 }
 const path=url.pathname==='/'?'index.html':url.pathname.slice(1);
 if(!['index.html','player-dialog.mjs','league-data.js','sc3-roster-stat-source.mjs'].includes(path)){
  res.writeHead(404);res.end();return;
 }
 const bytes=await readFile(join(root,path));
 res.writeHead(200,{'content-type':path.endsWith('.html')?'text/html':'text/javascript'});res.end(bytes);
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const browser=await puppeteer.launch({executablePath:process.env.SC3_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-first-run','--disable-extensions']});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#roster-body')?.textContent.includes('ESPN completed-game season averages'),{timeout:8000});
 const rows=await page.$$eval('#roster-body tr',els=>els.map(e=>e.innerText));
 assert.equal(rows.length,2);
 assert.match(rows[0],/Verified ESPN Player/);
 assert.match(rows[0],/ESPN completed-game season averages.*2026-11-22/);
 const cells=await page.$$eval('#roster-body tr:first-child td',els=>els.map(e=>e.textContent.trim()));
 assert.ok(cells.includes('25'),'Verified ESPN PTS average rendered in its own table cell');
 assert.ok(cells.includes('14'),'Verified ESPN GP rendered in its own table cell');
 assert.match(rows[1],/Unmapped Player/);
 assert.match(rows[1],/Unavailable/);
 await page.click('[data-view="roster"]');
 await page.type('#roster-search','Unmapped');
 const filtered=await page.$$eval('#roster-body tr',els=>els.map(e=>e.innerText));
 assert.equal(filtered.length,1);
 assert.match(filtered[0],/Unmapped Player/);
 await page.click('[data-view="freeagents"]');
 await page.waitForFunction(()=>document.querySelector('#fa-body')?.textContent.includes('Zeta Guard'),{timeout:8000});
 await page.select('#fa-sort','name');
 const sorted=await page.$$eval('#fa-body tr',els=>els.map(e=>e.textContent.trim()));
 assert.equal(sorted.length,2);
 assert.match(sorted[0],/Alpha Center/,'Name sort must apply to verified SC3 free agents');
 await page.select('#fa-position','PG');
 const guard=await page.$$eval('#fa-body tr',els=>els.map(e=>e.textContent.trim()));
 assert.equal(guard.length,1,'Yahoo eligible position must filter verified free agents');
 assert.match(guard[0],/Zeta Guard/);
 await page.select('#fa-rank','1');
 const ranked=await page.$$eval('#fa-body tr',els=>els.map(e=>e.textContent.trim()));
 assert.equal(ranked.length,1);
 assert.match(ranked[0],/No verified free agents match the current filters/);
 assert.match(await page.$eval('#fa-status',e=>e.textContent),/No players with a verified ESPN depth rank/);
 assert.deepEqual(errors,[]);
 console.log('PASS: roster ESPN source label, verified season averages, unavailable unmapped player, search filter, no JS errors');
} finally {await browser.close();await new Promise(ok=>server.close(ok));}
