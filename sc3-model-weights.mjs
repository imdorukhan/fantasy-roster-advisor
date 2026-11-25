export const MODELS=['L3','L7','L10','L14','SEASON','EWMA','SHRINKAGE'];
export function modelWeights(n,model){
 if(!Number.isInteger(n)||n<1||!MODELS.includes(model))throw Error('Invalid model');
 const window=Number(model.slice(1));
 const w=Array.from({length:n},(_,i)=>{
  const age=n-1-i;
  if(model==='SEASON')return 1/n;
  if(model==='EWMA')return Math.pow(.5,age/5);
  if(model==='SHRINKAGE'){const k=Math.min(7,n),lambda=k/(k+10);return (1-lambda)/n+(age<k?lambda/k:0);}
  return age<window?1:0;
 });
 const total=w.reduce((a,b)=>a+b,0);return w.map(x=>x/total);
}
