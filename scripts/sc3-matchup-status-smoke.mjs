// Run locally with Chrome and puppeteer-core. No private API calls or authentication.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join,resolve} from 'node:path';
import puppeteer from 'puppeteer-core';

const root=resolve(import.meta.dirname,'..');
let officialStatus=401;
const files=new Set(['/matchup.html','/decision-core.mjs','/player-dialog.mjs','/matchup-source-health.mjs']);
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/api/auto-data'){res.writeHead(officialStatus,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:officialStatus===401?'Yahoo owner sign-in required':'Exactly one official current Yahoo matchup required'}));return;}
 if(url.pathname==='/api/yahoo-matchup'){res.writeHead(503,{'content-type':'application/json'});res.end('{}');return;}
 if(url.pathname==='/api/public-matchup'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({rosters:{ours:[],opponent:[]},sources:[]}));return;}
 if(!files.has(url.pathname)){res.writeHead(404);res.end('Not found');return;}
 try{const data=await readFile(join(root,url.pathname));res.writeHead(200,{'content-type':url.pathname.endsWith('.html')?'text/html':'text/javascript'});res.end(data);}catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port;
const browser=await puppeteer.launch({executablePath:process.env.SC3_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-first-run','--disable-extensions']});
let pageErrors=[];
try{
 const page=await browser.newPage();
 page.on('pageerror',e=>pageErrors.push(e.message));
 await page.goto('http://127.0.0.1:'+port+'/matchup.html',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#health')?.textContent.includes('OWNER SIGN-IN REQUIRED'),{timeout:6000});
 assert.equal(await page.$eval('#health a',e=>e.getAttribute('href')),'/api/auth/yahoo/login?owner=1');
 await page.click('#refresh');
 await page.waitForFunction(()=>!document.querySelector('#refresh').disabled,{timeout:6000});
 assert.equal(await page.$eval('#score-summary',e=>e.textContent),'Sign-in required');
 officialStatus=422;
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#health')?.textContent.includes('CURRENT WEEK UNVERIFIED'),{timeout:6000});
 assert.equal(await page.$eval('#score-summary',e=>e.textContent),'Week unverified');
 assert.equal(await page.$eval('#health a',e=>e.getAttribute('href')).catch(()=>null),null);
 assert.deepEqual(pageErrors,[]);
 console.log('PASS: 401 owner sign-in guidance; 422 new-week guidance; refresh; zero JavaScript errors.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
