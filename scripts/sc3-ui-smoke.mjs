import puppeteer from 'puppeteer-core';
import { writeFile } from 'node:fs/promises';

const base = process.env.SC3_TEST_BASE || 'https://salarycaptain.vercel.app';
const output = process.env.SC3_TEST_OUTPUT || '/tmp/sc3-ui-report-20261123.json';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  userDataDir: '/tmp/sc3-ui-qa-isolated-20261123',
  args: ['--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking']
});
const result = { base, startedAt: new Date().toISOString(), pages: [], notes: 'Isolated anonymous browser; no OAuth, tokens or fantasy transactions.' };
try {
  for (const path of ['/', '/matchup.html', '/optimizer.html', '/public-matchup.html']) {
    const page = await browser.newPage();
    const record = { path, responses: [], failures: [], pageErrors: [], buttons: [], interactions: [] };
    result.pages.push(record);
    page.on('pageerror',e=>record.pageErrors.push(String(e.message).slice(0,350)));
    page.on('response',r=>{
      if(r.url().includes('/api/'))record.responses.push({url:new URL(r.url()).pathname+new URL(r.url()).search,status:r.status()});
    });
    page.on('requestfailed',r=>record.failures.push({url:r.url().slice(0,200),error:r.failure()?.errorText}));
    try {const r=await page.goto(base+path,{waitUntil:'domcontentloaded',timeout:25000});record.httpStatus=r.status();}
    catch(e){record.navigationError=String(e.message).slice(0,300);await page.close();continue;}
    await sleep(2200);
    record.title=await page.title();
    record.buttons=await page.$$eval('button',els=>els.map((e,i)=>({index:i,id:e.id||null,label:(e.innerText||e.textContent||'').trim().slice(0,80),disabled:e.disabled,view:e.dataset.view||null,go:e.dataset.go||null})));
    for(const button of record.buttons){
      if(path==='/' && (button.view||button.go||['fa-refresh','league-rosters-refresh','health-refresh'].includes(button.id))) {
        try {await page.evaluate(i=>{const e=document.querySelectorAll('button')[i];if(e && !e.disabled)e.click()},button.index);await sleep(['fa-refresh','league-rosters-refresh'].includes(button.id)?2300:350);
          const state=await page.evaluate(()=>({view:document.querySelector('.view:not(.hidden)')?.id||null,headline:document.querySelector('#page-title')?.textContent,fa:document.querySelector('#fa-status')?.textContent.slice(0,160),league:document.querySelector('#league-rosters-status')?.textContent.slice(0,160)}));
          record.interactions.push({button:button.label,id:button.id||button.view||button.go,ok:true,state});
        } catch(e){record.interactions.push({button:button.label,error:String(e.message).slice(0,160)})}
      } else if(path==='/matchup.html' && button.index>0) {
        try { await page.evaluate(i=>{const e=document.querySelectorAll('button')[i];if(e && !e.disabled)e.click()},button.index);await sleep(250);
          const open=await page.evaluate(()=>Boolean(document.querySelector('dialog[open]')));
          record.interactions.push({button:button.label,playerDialogOpened:open});
          await page.evaluate(()=>{for(const d of document.querySelectorAll('dialog[open]'))d.close()});
        } catch(e){record.interactions.push({button:button.label,error:String(e.message).slice(0,160)})}
      } else if(path!=='/' && /refresh|run|calculate|optimi|evaluate|reload|analy|start|check/i.test(button.label+' '+button.id) && !/oauth|sign in|login|logout|save|drop|add player|commit|trade/i.test(button.label+' '+button.id)){
        try { await page.evaluate(i=>{const e=document.querySelectorAll('button')[i];if(e && !e.disabled)e.click()},button.index);await sleep(2000);record.interactions.push({button:button.label,ok:true});}
        catch(e){record.interactions.push({button:button.label,error:String(e.message).slice(0,200)})}
      }
    }
    record.visibleText=(await page.evaluate(()=>document.body.innerText)).slice(0,1900);
    await page.close();
  }
} finally { await browser.close(); }
result.finishedAt=new Date().toISOString();
await writeFile(output,JSON.stringify(result,null,2));
console.log(JSON.stringify({output,summary:result.pages.map(p=>({path:p.path,status:p.httpStatus,buttons:p.buttons.length,clicks:p.interactions.length,errors:p.pageErrors,apiFailures:p.responses.filter(r=>r.status>=400).slice(0,12)}))},null,2));
