// Keep the owner dashboard's acquisition KPIs tied to a verified Yahoo
// league-wide snapshot. Never infer FAB or weekly adds from ESPN/waiver rows.
export function verifiedAcquisitionSummary(snapshot,now=new Date()){
 const a=snapshot?.acquisitions;
 if(snapshot?.mode!=='YAHOO_ALL_ROSTERS'||snapshot.complete!==true||
    snapshot.leagueId!==85892||snapshot.teamCount!==14||
    !Number.isInteger(snapshot.playerCount)||snapshot.playerCount<14||
    !a||!Number.isInteger(a.limit)||a.limit<0||
    !Number.isInteger(a.used)||a.used<0||a.used>a.limit||
    !Number.isInteger(a.remaining)||a.remaining!==a.limit-a.used||
    !(a.fab===null||Number.isInteger(a.fab)&&a.fab>=0)||
    !Number.isFinite(Date.parse(a.observedAt))||
    !Number.isFinite(new Date(now).getTime()))return null;
 const age=new Date(now).getTime()-Date.parse(a.observedAt);
 if(age<0||age>30*3600000)return null;
 return {limit:a.limit,used:a.used,remaining:a.remaining,fab:a.fab,
  observedAt:a.observedAt,source:'Yahoo Fantasy Sports API'};
}
