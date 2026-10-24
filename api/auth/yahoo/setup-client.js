export default function handler(req,res){res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/javascript; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');if(req.method!=='GET')return res.status(405).end();res.end(`
document.addEventListener('DOMContentLoaded',()=>{
const form=document.querySelector('form'),message=document.getElementById('message'),button=form.querySelector('button');
form.addEventListener('submit',async event=>{
event.preventDefault();button.disabled=true;message.textContent='Checking setup code and contacting server...';
try{
const response=await fetch('/api/auth/yahoo/login',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({setupCode:form.elements.setupCode.value}),credentials:'same-origin',cache:'no-store'});
const contentType=response.headers.get('content-type')||'';
const data=contentType.includes('application/json')?await response.json():{error:await response.text()};
if(!response.ok)throw Error((typeof data.error==='string'?data.error:'Setup request failed')+' (HTTP '+response.status+')');
if(typeof data.authorizationUrl!=='string'||!data.authorizationUrl.startsWith('https://api.login.yahoo.com/'))throw Error('Invalid Yahoo authorization URL');
message.textContent='Setup code accepted. Redirecting to Yahoo...';
window.location.assign(data.authorizationUrl);
}catch(error){message.textContent='Could not continue: '+error.message;button.disabled=false;}
});
});`)}
