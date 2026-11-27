import {reputationCriteria,projectReputationRating,type ReputationKind,type ReputationScores} from './freelanceReputationCriteria.js';
// LCM of all possible counts of applicable criteria (1..7). Keeps equal
// weight per rating exactly, with integer arithmetic instead of float drift.
const SCALE=420;
type Counter={count:number;sum:number};
export type ReputationAccumulator={completedContracts:number;ratingCount:number;ratingUnits:number;criteria:Record<string,Counter>};
const fail=():never=>{throw Error('FREELANCE_REPUTATION_INDEX_CONFLICT');};
const safe=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
const add=(a:number,b:number)=>{const n=a+b;if(!safe(n))return fail();return n;};
export function emptyReputationAccumulator(kind:ReputationKind):ReputationAccumulator{
 return {completedContracts:0,ratingCount:0,ratingUnits:0,criteria:Object.fromEntries(Object.keys(reputationCriteria(kind)).map(k=>[k,{count:0,sum:0}]))};
}
export function validateReputationAccumulator(kind:ReputationKind,raw:unknown):ReputationAccumulator{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==4)return fail();
 const a=raw as ReputationAccumulator,keys=Object.keys(reputationCriteria(kind));
 if(!safe(a.completedContracts)||!safe(a.ratingCount)||a.ratingCount>a.completedContracts||!safe(a.ratingUnits)||a.ratingUnits/SCALE<a.ratingCount||a.ratingUnits/(5*SCALE)>a.ratingCount||
 !a.criteria||Object.keys(a.criteria).length!==keys.length)return fail();
 let observations=0;
 for(const k of keys){
  const c=a.criteria[k];
  if(!c||Object.keys(c).length!==2||!safe(c.count)||!safe(c.sum)||c.count>a.ratingCount||c.sum<c.count||c.sum/5>c.count)return fail();
  observations=add(observations,c.count);
 }
 if(observations<a.ratingCount)return fail();
 return a;
}
export function incrementReputationExperience(kind:ReputationKind,raw:unknown){
 const a=validateReputationAccumulator(kind,raw);
 return {...a,completedContracts:add(a.completedContracts,1)};
}
export function incrementReleasedReputation(kind:ReputationKind,raw:unknown,input:ReputationScores){
 const a=validateReputationAccumulator(kind,raw);
 if(a.ratingCount>=a.completedContracts)return fail();
 const r=projectReputationRating(kind,input);
 const sum=Object.values(r.scores).reduce<number>((n,v)=>n+(v??0),0);
 const units=sum*(SCALE/r.applicableCount),criteria={...a.criteria};
 for(const [k,v] of Object.entries(r.scores))if(v!==null)criteria[k]={count:add(criteria[k].count,1),sum:add(criteria[k].sum,v)};
 return validateReputationAccumulator(kind,{...a,ratingCount:add(a.ratingCount,1),ratingUnits:add(a.ratingUnits,units),criteria});
}
export function projectReputationAccumulator(kind:ReputationKind,raw:unknown){
 const a=validateReputationAccumulator(kind,raw);
 return {completedContracts:a.completedContracts,aggregate:{ratingCount:a.ratingCount,mean:a.ratingCount?a.ratingUnits/(SCALE*a.ratingCount):null,
  criteria:Object.fromEntries(Object.entries(a.criteria).map(([k,c])=>[k,{count:c.count,mean:c.count?c.sum/c.count:null}]))}};
}
