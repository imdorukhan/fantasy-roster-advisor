// Pure dry-run planner for a future opt-in, transactionally persisted alert outbox.
// Not a sender, scheduler or database writer. No side effects.
import {createHash} from 'node:crypto';
const eventPattern=/^(\d+)\|([a-z0-9_-]{1,128})\|([A-Z0-9_-]{1,30})$/i;
const validUrl=value=>{
 try{const u=new URL(value);return u.protocol==='https:'&&Boolean(u.hostname)&&!u.username&&!u.password&&u.pathname!=='/';}
 catch{return false;}
};
export function planAlertOutbox({
 leagueId,teamId,subscriberId,candidates=[],existing=[],consent=null,now=new Date().toISOString()
}={}){
 if(leagueId!==85892||teamId!==5||typeof subscriberId!=='string'||
    !/^[a-z0-9_-]{1,128}$/i.test(subscriberId)||!Array.isArray(candidates)||
    !Array.isArray(existing)||!Number.isFinite(Date.parse(now)))
  throw Error('Scoped, read-only outbox input required');
 const approved=consent?.approved===true&&['in_app','email'].includes(consent.channel);
 const channel=approved?consent.channel:'in_app';
 const known=new Set();
 for(const entry of existing){
  if(typeof entry?.idempotencyKey!=='string'||!/^[0-9a-f]{64}$/.test(entry.idempotencyKey)||
     !['pending_review','sending','sent','failed','suppressed'].includes(entry.state))
   throw Error('Invalid persisted outbox state');
  known.add(entry.idempotencyKey);
 }
 const preview=[],operations=[];
 let skipped=0;
 for(const candidate of candidates){
  const parts=eventPattern.exec(candidate?.eventKey||'');
  const age=Date.parse(now)-Date.parse(candidate?.observedAt);
  if(!parts||String(candidate.playerId)!==parts[1]||candidate.sourceVerified!==true||
     candidate.executable!==false||candidate.deliveryEnabled!==false||
     candidate.requiresApproval!==true||!validUrl(candidate.sourceUrl)||
     !Number.isFinite(age)||age< -60_000||age>72*3600000){
   skipped++;continue;
  }
  const idempotencyKey=createHash('sha256')
   .update([leagueId,teamId,subscriberId,channel,candidate.eventKey].join('|')).digest('hex');
  if(known.has(idempotencyKey)){skipped++;continue;}
  known.add(idempotencyKey);
  preview.push({playerId:candidate.playerId,eventKey:candidate.eventKey,sourceUrl:candidate.sourceUrl});
  if(!approved)continue;
  operations.push({idempotencyKey,leagueId,teamId,playerId:candidate.playerId,
   eventKey:candidate.eventKey,channel,state:'pending_review',
   sourceUrl:candidate.sourceUrl,observedAt:candidate.observedAt,
   sendAllowed:false,requiresApproval:true});
 }
 return {status:approved?'review_only':'consent_required',
  readOnly:true,deliveryEnabled:false,operations,preview,skipped,
  note:'Atomic unique-key persistence, review and sender authorization are not implemented.'};
}
