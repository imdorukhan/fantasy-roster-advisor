import {cookies,configured,method} from './_lib.js';
import {loadSession,storeConfigured} from './_store.js';
export default async function handler(req,res){if(!method(req,res))return;if(!configured()||!storeConfigured())return res.status(200).json({configured:false,connected:false});try{const s=await loadSession(cookies(req).yahoo_session);return res.status(200).json({configured:true,connected:Boolean(s?.refresh_token),accessTokenExpired:s?Date.now()>=s.expires_at:null})}catch{return res.status(503).json({error:'Session status unavailable'})}}
