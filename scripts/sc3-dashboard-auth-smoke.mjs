import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,join} from 'node:path';
import puppeteer from 'puppeteer-core';

const root=resolve(import.meta.dirname,'..');
const server=createServer(async(req,res)=>{
 const pathname=new URL(req.url,'http://127.0.0.1').pathname;
 if(pathname.startsWith('/api/')){res.writeHead(401,{'content-type':'application/json','cache-control':'no-store'});res.end('{"error":"Yahoo owner sign-in required"}');return;}
 const rel=pathname==='/'?'index.html':pathname.slice(1);
 if(!/^[a-zA-Z0-9_./-]+$/.test(rel)||rel.includes('..')){res.writeHead(404);res.end();return;}
 try{const data=await readFile(join(root,rel));res.writeHead(200,{'content-type':rel.endsWith('html')?'text/html':'text/javascript'});res.end(data);}catch{res.writeHead(404);res.end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const browser=await puppeteer.launch({executablePath:process.env.SC3_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-first-run','--disable-extensions']});
try {
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#league-rosters-status')?.textContent.includes('owner sign-in required'),{timeout:9000});
 assert.equal(await page.$eval('#league-rosters-status a',e=>e.getAttribute('href')),'/api/auth/yahoo/login?owner=1');
 await page.click('[data-view="freeagents"]');
 await page.waitForFunction(()=>document.querySelector('#fa-status')?.textContent.includes('Yahoo sign-in required'),{timeout:9000});
 assert.equal(await page.$eval('#fa-status a',e=>e.getAttribute('href')),'/api/auth/yahoo/login?owner=1');
 await page.click('[data-view="waiver"]');
 await page.waitForFunction(()=>document.querySelector('#waiver-status')?.textContent.includes('Yahoo sign-in required'),{timeout:9000});
 await page.click('[data-view="sources"]');
 await page.waitForFunction(()=>document.querySelector('#system-health-panel')?.textContent.includes('Yahoo owner sign-in required'),{timeout:9000});
 assert.equal(await page.$eval('#system-health-panel a',e=>e.getAttribute('href')),'/api/auth/yahoo/login?owner=1');
 assert.deepEqual(errors,[]);
 console.log('PASS dashboard: league roster, free agents, waiver and source health show safe owner sign-in links; no JS errors.');
}finally{await browser.close();await new Promise(ok=>server.close(ok));}
