import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,join} from 'node:path';
import puppeteer from 'puppeteer-core';

const root=resolve(import.meta.dirname,'..');
let code=401;
const files=new Set(['/optimizer.html','/player-dialog.mjs','/decision-core.mjs']);
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://127.0.0.1').pathname;
 if(path==='/api/auto-data'){res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify({error:code===401?'Sign-in required':'New week not verified'}));return;}
 if(!files.has(path)){res.writeHead(404);res.end('Not found');return;}
 try{const data=await readFile(join(root,path));res.writeHead(200,{'content-type':path.endsWith('html')?'text/html':'text/javascript'});res.end(data);}catch{res.writeHead(404);res.end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const browser=await puppeteer.launch({executablePath:process.env.SC3_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-extensions','--no-first-run']});
try{
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const url='http://127.0.0.1:'+server.address().port+'/optimizer.html';
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#matchup-source')?.textContent.includes('Yahoo owner sign-in required'),{timeout:9000});
 assert.equal(await page.$eval('#matchup-source a',el=>el.getAttribute('href')),'/api/auth/yahoo/login?owner=1');
 assert.equal(await page.$eval('#lineup-status a',el=>el.getAttribute('href')),'/api/auth/yahoo/login?owner=1');
 code=422;
 await page.click('#refresh');
 await page.waitForFunction(()=>document.querySelector('#matchup-source')?.textContent.includes('not independently verified'),{timeout:9000});
 assert.equal(await page.$eval('#score',el=>el.textContent),'—');
 assert.equal(await page.$eval('#matchup-source a',el=>el.getAttribute('href')).catch(()=>null),null);
 assert.deepEqual(errors,[]);
 console.log('PASS optimizer: owner 401 CTA, lineup owner CTA, 422 week rollover, no old score, no JS exceptions.');
}finally{await browser.close();await new Promise(ok=>server.close(ok));}
