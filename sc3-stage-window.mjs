// An immutable, explicitly configured UTC epoch-second release window.
// Both bounds are mandatory: checking only a future deadline can accidentally
// let an hours-old deployment become active again as wall time advances.
export const MAX_STAGE_WINDOW=1800;
export function stageWindow(env,now){
 const parse=s=>typeof s==='string'&&/^[1-9]\d{9}$/.test(s)?Number(s):null;
 const start=parse(env.SC3_STAGE_NOT_BEFORE),end=parse(env.SC3_STAGE_NOT_AFTER);
 if(start===null||end===null||!Number.isSafeInteger(now)||end<=start||end-start>MAX_STAGE_WINDOW||now<start||now>=end)return null;
 return {start,end};
}
export function stageGrantTimes(w,now){
 return {windowStart:w.start,windowEnd:w.end,iat:now,exp:Math.min(now+300,w.end),handoff:Math.min(now+60,w.end)};
}
