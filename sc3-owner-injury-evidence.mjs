// Attach independently verified ESPN depth markers to an already authenticated
// Yahoo owner roster. This cannot produce a predicted return date or fantasy action.
export async function attachOwnerInjuryEvidence(roster,observedAt,{enabled=false,read}={}){
 const unavailable={mode:'SC3_INJURY_EVIDENCE',status:'unavailable',readOnly:true,players:[]};
 if(!enabled||!Array.isArray(roster)||!roster.length||roster.length>20||
   !Number.isFinite(Date.parse(observedAt))||typeof read!=='function')return unavailable;
 try{
  const x=await read(roster,observedAt);
  if(x?.mode!=='SC3_INJURY_EVIDENCE'||x.status!=='verified'||x.readOnly!==true||
     !Array.isArray(x.players)||x.players.some(p=>p?.executable!==false||
       p.returnDate!==null||p.returnDateVerified!==false))return unavailable;
  return x;
 }catch{return unavailable;}
}
