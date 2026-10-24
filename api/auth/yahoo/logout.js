import {cookie} from './_lib.js';
export default function handler(req,res){res.setHeader('Cache-Control','no-store');if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).end()}res.setHeader('Set-Cookie',[cookie('yahoo_session','',0),cookie('yahoo_oauth_pending','',0)]);return res.status(200).json({connected:false})}
