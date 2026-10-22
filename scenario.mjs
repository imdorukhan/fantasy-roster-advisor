import state from './data/team-state-2026-10-22.json' with {type:'json'};
export function forecastRosterScenario(s=state){
  const successful=s.pending.filter(p=>p.assumeSuccessful===true);
  const ilPlans=successful.filter(p=>p.assumeILPlacement===true);
  const projectedAddsUsed=s.weeklyAddsUsed+successful.length;
  const projectedIL=s.ilUsed+ilPlans.length;
  const warnings=[];
  if(ilPlans.some(p=>!p.ilEligibilityVerified))warnings.push('IL eligibility is NOT verified; player may require an active roster slot or transaction may fail.');
  if(s.pending.some(p=>p.bidAmount===null))warnings.push('FAB bid unknown; $98 is the current displayed balance, not a projected post-claim balance.');
  warnings.push('Pending claims are not confirmed; projected adds consume weekly quota only if successful and counted by Yahoo.');
  return {asOf:s.asOf,scenario:'ASSUME_PENDING_CLAIM_SUCCEEDS',player:successful.map(p=>p.player),addsUsedNow:s.weeklyAddsUsed,addsAvailableNow:s.weeklyAddsLimit-s.weeklyAddsUsed,pendingCount:s.pending.length,projectedAddsUsed,projectedAddsAvailable:Math.max(0,s.weeklyAddsLimit-projectedAddsUsed),ilOccupiedNow:s.ilUsed,ilOccupiedProjected:projectedIL,ilLimit:s.ilLimit,ilPlanFeasibleByCapacity:projectedIL<=s.ilLimit,ilEligibilityVerified:ilPlans.every(p=>p.ilEligibilityVerified),fabBudgetCurrent:s.fabBudgetCurrent,fabBudgetProjected:null,confirmed:false,warnings};
}
