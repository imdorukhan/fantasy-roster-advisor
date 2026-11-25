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
const issuerPath=process.argv[2];
if(!issuerPath)throw Error('Exact PR22 issuer fixture source required');
const {stageIssuer,CANONICAL}=await import(pathToFileURL(resolve(issuerPath)));
import {verifyProductionOwner} from '../sc3-read-access.mjs';
import puppeteer from 'puppeteer-core';
const chrome=process.argv[3];
const engine=process.env.SC3_TEST_ENGINE??'chromium';
const playwrightModule=process.env.SC3_TEST_PLAYWRIGHT_MODULE;
if((!chrome&&!playwrightModule)||!['chromium','firefox','webkit'].includes(engine)||engine!=='chromium'&&!playwrightModule)throw Error('Supply checked-out PR22 issuer and isolated browser executable or test-only Playwright module');
const playwright=playwrightModule?await import(pathToFileURL(resolve(playwrightModule))):null;
const {stageAuth,hasStageRead}=await import('../sc3-stage-auth.mjs');
const host='salarycaptain-fixture123-dorukkosar-4371.vercel.app',id='dpl_fixture1234567890123456',path='/api/auto-data';
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const flags={VERCEL_ENV:'production',SC3_SHARED_DB:'1',SC3_PRODUCTION_READS:'1'};
const issuer={...flags,SC3_STAGE_ISSUER:'1',SC3_STAGE_TARGET_HOST:host,SC3_STAGE_TARGET_DEPLOYMENT_ID:id,SC3_STAGE_SIGNING_KEY:privateKey.export({format:'der',type:'pkcs8'}).toString('base64')};
const receiver={...flags,SC3_STAGE_RECEIVER:'1',VERCEL_URL:host,VERCEL_DEPLOYMENT_ID:id,SC3_STAGE_VERIFY_KEY:publicKey.export({format:'der',type:'spki'}).toString('base64')};
const synthetic='a'.repeat(43);
let exchangeStatus=null,exchangeCount=0,clockOffset=0,wrongDeployment=false;
const clock=()=>Math.floor(Date.now()/1000)+clockOffset;
const dir=await mkdtemp(join(tmpdir(),'sc3-browser-fixture-'));
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN='+CANONICAL,'-addext','subjectAltName=DNS:'+CANONICAL+',DNS:'+host,'-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem')],{stdio:'ignore'});
const server=httpsServer({key:await readFile(join(dir,'key.pem')),cert:await readFile(join(dir,'cert.pem'))},async(req,res)=>{
 try{
  const h=req.headers.host;if(![CANONICAL,host].includes(h)){res.writeHead(403);return res.end();}
  const u=new URL(req.url,'https://'+h);
  const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  if(h===CANONICAL&&u.pathname==='/fixture-owner'){
   res.setHeader('Set-Cookie','yahoo_session='+synthetic+'; Path=/; HttpOnly; Secure; SameSite=Lax');
   return send(200,{fixtureOwner:true});
  }
  if(h===CANONICAL&&u.pathname==='/fixture-cross-site'){res.setHeader('Content-Type','text/html');return res.end('<a href="https://'+host+path+'?sc3StageAuth=status">Cross-site status</a>');}
  if(u.pathname!==path)return send(404,{error:'fixture path'});
  const q=Object.fromEntries(u.searchParams);let body='';for await(const chunk of req){body+=chunk;if(body.length>3000)throw Error('body limit');}
  const r={method:req.method,url:req.url,headers:req.headers,query:q,body};
  let status=200;const response={setHeader:(k,v)=>res.setHeader(k,v),status(n){status=n;return this},json(v){res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(v));return this},send(v){res.statusCode=status;res.end(v);return this},end(){res.statusCode=status;res.end();return this}};
  if(h===host&&['exchange','status'].includes(q.sc3StageAuth))res.once('finish',()=>{console.log(JSON.stringify({fixtureEvent:q.sc3StageAuth,http:res.statusCode,site:req.headers['sec-fetch-site']??null,mode:req.headers['sec-fetch-mode']??null,dest:req.headers['sec-fetch-dest']??null}));if(q.sc3StageAuth==='exchange'){exchangeStatus=res.statusCode;exchangeCount++;}});
  const activeReceiver=wrongDeployment?{...receiver,VERCEL_DEPLOYMENT_ID:'dpl_otherFixture123456789012'}:receiver;
  if(q.sc3StageAuth)return h===CANONICAL?await stageIssuer(r,response,{env:issuer,owner:r=>verifyProductionOwner(r,{verify:async sid=>sid===synthetic}),now:clock}):await stageAuth(r,response,{env:activeReceiver,now:clock});
  // Fixture checks only; no Yahoo or DB code is invoked.
  if(h!==host||!hasStageRead(r,activeReceiver,clock()))return send(401,{authorized:false});
  return send(200,{authorized:true,readOnly:true});
 }catch{if(!res.headersSent)res.writeHead(500);res.end('fixture error');}
});
const listen=s=>new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));
await listen(server);
const proxy=httpServer((req,res)=>{res.writeHead(403);res.end();});
proxy.on('connect',(req,socket,head)=>{
 socket.on('error',()=>{});if(![CANONICAL+':443',host+':443'].includes(req.url)){socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
 const upstream=connect(server.address().port,'127.0.0.1',()=>{socket.write('HTTP/1.1 200 Connection established\r\n\r\n');if(head.length)upstream.write(head);socket.pipe(upstream).pipe(socket);});
 upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());
});
await listen(proxy);
const root=h=>'https://'+h+path+'?';
let browser;
try{
 for(const strict of engine==='chromium'&&!playwright?[false,true]:[false]){
  exchangeStatus=null;exchangeCount=0;clockOffset=0;wrongDeployment=false;
  browser=playwright?await playwright[engine].launch({headless:true,proxy:{server:'http://127.0.0.1:'+proxy.address().port}}):await puppeteer.launch({executablePath:chrome,headless:true,acceptInsecureCerts:true,userDataDir:join(dir,strict?'strict':'normal'),args:['--no-sandbox','--disable-background-networking','--disable-sync','--no-first-run','--proxy-server=http://127.0.0.1:'+proxy.address().port,'--ignore-certificate-errors',...(strict?['--test-third-party-cookie-phaseout']:[])]});
  const context=playwright?await browser.newContext({ignoreHTTPSErrors:true}):null;
  const page=context?await context.newPage():await browser.newPage();
  const read=async()=>JSON.parse(await page.$eval('body',e=>e.innerText));
  const click=async selector=>{const [r]=await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.click(selector)]);return r?.status();};
  await page.goto(root(host)+'sc3StageAuth=begin');
  assert.equal(await click('a'),401); // No synthetic owner yet.
  await page.goto('https://'+CANONICAL+'/fixture-owner');assert.equal((await read()).fixtureOwner,true);
  await page.goto(root(host)+'sc3StageAuth=begin');
  assert.equal(await click('a'),200);
  assert.equal(await click('button'),200);
  const first=await click('button');
  assert.equal(exchangeCount,1);
  assert.equal(exchangeStatus,200,'POST must commit landing document');
  assert.equal(first,200);
  assert.equal(await click('a'),200,'same-origin status must succeed without manual URL entry');
  const status=await read();assert.equal(status.readOnly,true);
  const allowed=await page.goto(root(host)+'sc3LeagueRosters=1');assert.equal(allowed.status(),200);assert.equal((await read()).authorized,true);
  const denied=await page.goto(root(host)+'sc3YahooSync=1');assert.equal(denied.status(),401);
  wrongDeployment=true;assert.equal((await page.goto(root(host)+'sc3LeagueRosters=1')).status(),401);wrongDeployment=false;
  await page.goto('https://'+CANONICAL+'/fixture-cross-site');assert.equal(await click('a'),401);
  const isolated=playwright?await browser.newContext({ignoreHTTPSErrors:true}):await browser.createBrowserContext();const other=await isolated.newPage();
  assert.equal((await other.goto(root(host)+'sc3LeagueRosters=1')).status(),401);await isolated.close();
  clockOffset=301;
  assert.equal((await page.goto(root(host)+'sc3StageAuth=status')).status(),401);
  assert.equal((await page.goto(root(host)+'sc3LeagueRosters=1')).status(),401);
  console.log(JSON.stringify({engine,thirdPartyPhaseoutFlag:strict,exchangeHttp:exchangeStatus,landingHttp:first,statusHttp:200,allowedHttp:200,writerHttp:401,otherContextHttp:401,wrongDeploymentHttp:401,crossSiteHttp:401,expiredHttp:401,outcome:'accepted'}));
  await browser.close();browser=undefined;
 }
}finally{
 if(browser)await browser.close();
 proxy.closeAllConnections?.();server.closeAllConnections?.();
 await Promise.all([new Promise(r=>proxy.close(r)),new Promise(r=>server.close(r))]);
 await rm(dir,{recursive:true,force:true});
}
