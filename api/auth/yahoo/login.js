import crypto from 'node:crypto';
import {redirect,cookie,seal,configured} from './_lib.js';
import {storeConfigured} from './_store.js';
export default function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 const bootstrap=req.method==='POST',diagnostic=req.method==='GET'&&req.query?.diagnostic==='1';
 if(!bootstrap&&req.method!=='GET'){res.setHeader('Allow','GET, POST');return res.status(405).end()}
 if(!configured()||!storeConfigured())return res.status(503).send('Yahoo OAuth configuration is incomplete.');
 // A plain login must not mint tokens that cannot complete the owner setup.
 if(!bootstrap&&!diagnostic)return res.redirect(303,'/api/auth/yahoo/setup');
 if(bootstrap){
  if(req.headers.origin!=='https://salarycaptain.vercel.app')return res.status(403).send('Invalid origin. Open https://salarycaptain.vercel.app/api/auth/yahoo/setup and retry.');
  const provided=typeof req.body==='string'?new URLSearchParams(req.body).get('setupCode'):Buffer.isBuffer(req.body)?new URLSearchParams(req.body.toString()).get('setupCode'):req.body?.setupCode,expected=process.env.YAHOO_BOOTSTRAP_SECRET;
  if(typeof provided!=='string'||typeof expected!=='string'||!expected.length)return res.status(403).send('Setup code not accepted.');
  const supplied=Buffer.from(provided),required=Buffer.from(expected);
  if(supplied.length!==required.length||!crypto.timingSafeEqual(supplied,required))return res.status(403).send('Setup code not accepted.');
 }
 const state=crypto.randomBytes(24).toString('base64url'),verifier=crypto.randomBytes(32).toString('base64url');
 const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
 res.setHeader('Set-Cookie',cookie('yahoo_oauth_pending',seal({state,verifier,at:Date.now(),bootstrap,diagnostic}),600));
 const url=new URL('https://api.login.yahoo.com/oauth2/request_auth');
 url.search=new URLSearchParams({client_id:process.env.YAHOO_CLIENT_ID,redirect_uri:redirect,response_type:'code',scope:'fspt-r',state,code_challenge:challenge,code_challenge_method:'S256',...(bootstrap?{prompt:'consent'}:{})}).toString();
 if(req.headers.accept?.includes('application/json'))return res.status(200).json({authorizationUrl:url.toString()});
 res.writeHead(302,{Location:url.toString()});return res.end();
}
