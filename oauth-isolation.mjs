// Preview/local auth must never inherit production credentials or callback.
const PROD='https://salarycaptain.vercel.app';
const PROD_REF='bmsfbcuausbfzheufjtc';
export function isolationConfig(env=process.env){
 const dev=env.SC3_ISOLATED==='1'||env.VERCEL_ENV==='preview'||env.VERCEL_ENV==='development';
 if(!dev)return {development:false,origin:PROD,redirect:PROD+'/api/auth/yahoo/callback',url:env.SALARYCAPTAIN_SUPABASE_URL,secret:env.SALARYCAPTAIN_SUPABASE_SECRET_KEY,clientId:env.YAHOO_CLIENT_ID,clientSecret:env.YAHOO_CLIENT_SECRET,sessionSecret:env.YAHOO_SESSION_SECRET,bootstrapSecret:env.YAHOO_BOOTSTRAP_SECRET};
 const origin=new URL(env.SC3_DEV_ORIGIN||'invalid:');const db=new URL(env.SC3_DEV_SUPABASE_URL||'invalid:');
 const ref=env.SC3_DEV_SUPABASE_REF;
 if(origin.protocol!=='https:'||origin.origin===PROD||origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password||!origin.hostname.endsWith('.vercel.app'))throw Error('Isolated OAuth origin required');
 if(!ref||ref===PROD_REF||db.protocol!=='https:'||db.hostname!==ref+'.supabase.co'||db.pathname!=='/'||db.search||db.hash||db.username||db.password)throw Error('Isolated database required');
 if(!env.SC3_DEV_YAHOO_CLIENT_ID||!env.SC3_DEV_YAHOO_CLIENT_SECRET||!env.SC3_DEV_YAHOO_SESSION_SECRET||env.SC3_DEV_YAHOO_SESSION_SECRET.length<32||!env.SC3_DEV_SUPABASE_SECRET_KEY||!env.SC3_DEV_YAHOO_BOOTSTRAP_SECRET)throw Error('Isolated credentials required');
 if(env.SC3_DEV_YAHOO_CLIENT_ID===env.YAHOO_CLIENT_ID||env.SC3_DEV_YAHOO_CLIENT_SECRET===env.YAHOO_CLIENT_SECRET||env.SC3_DEV_YAHOO_SESSION_SECRET===env.YAHOO_SESSION_SECRET||env.SC3_DEV_SUPABASE_SECRET_KEY===env.SALARYCAPTAIN_SUPABASE_SECRET_KEY||env.SC3_DEV_YAHOO_BOOTSTRAP_SECRET===env.YAHOO_BOOTSTRAP_SECRET)throw Error('Shared production credentials forbidden');
 return {development:true,origin:origin.origin,redirect:origin.origin+'/api/auth/yahoo/callback',url:db.origin,secret:env.SC3_DEV_SUPABASE_SECRET_KEY,clientId:env.SC3_DEV_YAHOO_CLIENT_ID,clientSecret:env.SC3_DEV_YAHOO_CLIENT_SECRET,sessionSecret:env.SC3_DEV_YAHOO_SESSION_SECRET,bootstrapSecret:env.SC3_DEV_YAHOO_BOOTSTRAP_SECRET};
}
