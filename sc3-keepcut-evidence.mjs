// Read-only Keep/Cut display. A three-game sample is never a drop recommendation.
export function keepCutEvidence(player,performance){
 const sample=performance?.windows?.[3];
 const games=Number.isInteger(sample?.games)&&sample.games>=0?sample.games:0;
 const recent=sample?.complete===true&&games>=3&&Number.isFinite(sample.values?.PTS);
 const datesOK=/^\d{4}-\d{2}-\d{2}$/.test(performance?.historyEnd||'')&&
    performance.historyEnd===performance.expectedEnd;
 const fresh=performance?.fresh===true&&datesOK;
 const injured=Boolean(player?.status&&player.status!=='A')||/^(IL|IL\+|IR|IR\+)$/.test(player?.slot||'');
 return {mode:'KEEP_CUT_EVIDENCE',readOnly:true,
  label:recent&&fresh?'REVIEW ONLY':recent?'HISTORY STALE':`SAMPLE ${games}/3`,
  sampleGames:games,injured,injuryFlag:player?.status&&player.status!=='A'?player.status:null,
  historyThrough:recent?performance.historyEnd:null,
  recentPoints:recent&&fresh?sample.values.PTS:null,
  current:recent&&fresh,dropRecommendation:null};
}
