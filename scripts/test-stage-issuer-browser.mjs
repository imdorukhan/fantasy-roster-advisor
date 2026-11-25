// Isolated browser integration harness; requires exact PR21 receiver source as arg.
// No network access to actual Vercel domains: an allowlisted loopback CONNECT proxy.
import {createServer as httpsServer} from 'node:https';
import {createServer as httpServer} from 'node:http';
import {connect} from 'node:net';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {stageIssuer,CANONICAL} from '../sc3-stage-issuer.mjs';
import {verifyProductionOwner} from '../sc3-read-access.mjs';
import puppeteer from 'puppeteer-core';
const receiverPath=process.argv[2],chrome=process.argv[3];
if(!receiverPath||!chrome)throw Error('Supply checked-out PR21 receiver module and isolated browser executable');
const {stageAuth,hasStageRead}=await import(pathToFileURL(resolve(receiverPath)));
const host='salarycaptain-fixture123-dorukkosar-4371.vercel.app',id='dpl_fixture1234567890123456',path='/api/auto-data';
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const flags={VERCEL_ENV:'production',SC3_SHARED_DB:'1',SC3_PRODUCTION_READS:'1'};
const issuer={...flags,SC3_STAGE_ISSUER:'1',SC3_STAGE_TARGET_HOST:host,SC3_STAGE_TARGET_DEPLOYMENT_ID:id,SC3_STAGE_SIGNING_KEY:privateKey.export({format:'der',type:'pkcs8'}).toString('base64')};
const receiver={...flags,SC3_STAGE_RECEIVER:'1',VERCEL_URL:host,VERCEL_DEPLOYMENT_ID:id,SC3_STAGE_VERIFY_KEY:publicKey.export({format:'der',type:'spki'}).toString('base64')};
const synthetic='a'.repeat(43);
const dir=await mkdtemp(join(tmpdir(),'sc3-browser-fixture-'));
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=loopback-fixture','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem')],{stdio:'ignore'});
const server=httpsServer({key:await readFile(join(dir,'key.pem')),cert:await readFile(join(dir,'cert.pem'))},async(req,res)=>{
 try{
  const h=req.headers.host;if(![CANONICAL,host].includes(h)){res.writeHead(403);return res.end();}
  const u=new URL(req.url,'https://'+h);
  const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  if(h===CANONICAL&&u.pathname==='/fixture-owner'){
   res.setHeader('Set-Cookie','yahoo_session='+synthetic+'; Path=/; HttpOnly; Secure; SameSite=Lax');
   return send(200,{fixtureOwner:true});
  }
  if(u.pathname!==path)return send(404,{error:'fixture path'});
  const q=Object.fromEntries(u.searchParams);let body='';for await(const chunk of req){body+=chunk;if(body.length>3000)throw Error('body limit');}
  const r={method:req.method,url:req.url,headers:req.headers,query:q,body};
  let status=200;const response={setHeader:(k,v)=>res.setHeader(k,v),status(n){status=n;return this},json(v){res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(v));return this},send(v){res.statusCode=status;res.end(v);return this},end(){res.statusCode=status;res.end();return this}};
  if(q.sc3StageAuth)return h===CANONICAL?await stageIssuer(r,response,{env:issuer,owner:r=>verifyProductionOwner(r,{verify:async sid=>sid===synthetic})}):await stageAuth(r,response,{env:receiver});
  // Fixture checks only; no Yahoo or DB code is invoked.
  if(h!==host||!hasStageRead(r,receiver))return send(401,{authorized:false});
  return send(200,{authorized:true,readOnly:true});
 }catch{if(!res.headersSent)res.writeHead(500);res.end('fixture error');}
});
const listen=s=>new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));
await listen(server);
const proxy=httpServer((req,res)=>{res.writeHead(403);res.end();});
proxy.on('connect',(req,socket,head)=>{
 if(![CANONICAL+':443',host+':443'].includes(req.url)){socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
 const upstream=connect(server.address().port,'127.0.0.1',()=>{socket.write('HTTP/1.1 200 Connection established\r\n\r\n');if(head.length)upstream.write(head);socket.pipe(upstream).pipe(socket);});
 upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());
});
await listen(proxy);
const root=h=>'https://'+h+path+'?';
let browser;
try{
 for(const strict of [false,true]){
  browser=await puppeteer.launch({executablePath:chrome,headless:true,acceptInsecureCerts:true,userDataDir:join(dir,strict?'strict':'normal'),args:['--no-sandbox','--disable-background-networking','--disable-sync','--no-first-run','--proxy-server=http://127.0.0.1:'+proxy.address().port,'--ignore-certificate-errors',...(strict?['--test-third-party-cookie-phaseout']:[])]});
  const page=await browser.newPage();
  const read=async()=>JSON.parse(await page.$eval('body',e=>e.innerText));
  const click=async selector=>{const [r]=await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.click(selector)]);return r?.status();};
  await page.goto(root(host)+'sc3StageAuth=begin');
  assert.equal(await click('a'),401); // No synthetic owner yet.
  await page.goto('https://'+CANONICAL+'/fixture-owner');assert.equal((await read()).fixtureOwner,true);
  await page.goto(root(host)+'sc3StageAuth=begin');
  assert.equal(await click('a'),200);
  assert.equal(await click('button'),200);
  const first=await click('button');
  const transfer=first===200||first===401;
  assert.ok(transfer);
  const sameSite=await page.goto(root(host)+'sc3StageAuth=status');
  const status=await read();
  const accepted=sameSite.status()===200&&status.readOnly===true;
  if(!accepted){
   assert.equal(sameSite.status(),401);
   console.log(JSON.stringify({engine:'chromium',thirdPartyPhaseoutFlag:strict,redirectHttp:first,statusHttp:sameSite.status(),outcome:'blocked-fail-closed'}));
  }else{
   const allowed=await page.goto(root(host)+'sc3LeagueRosters=1');assert.equal(allowed.status(),200);assert.equal((await read()).authorized,true);
   const denied=await page.goto(root(host)+'sc3YahooSync=1');assert.equal(denied.status(),401);
   const isolated=await browser.createBrowserContext();const other=await isolated.newPage();
   assert.equal((await other.goto(root(host)+'sc3LeagueRosters=1')).status(),401);await isolated.close();
   console.log(JSON.stringify({engine:'chromium',thirdPartyPhaseoutFlag:strict,redirectHttp:first,statusHttp:sameSite.status(),allowedHttp:200,writerHttp:401,otherContextHttp:401,outcome:'accepted'}));
  }
  await browser.close();browser=undefined;
 }
}finally{
 if(browser)await browser.close();
 proxy.closeAllConnections?.();server.closeAllConnections?.();
 await Promise.all([new Promise(r=>proxy.close(r)),new Promise(r=>server.close(r))]);
 await rm(dir,{recursive:true,force:true});
}
