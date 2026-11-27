import {reputationCriteria,type ReputationKind} from '../../../shared/freelanceReputationCriteria';
type Criterion={count:number;mean:number|null};
type Projection={completedContracts:number;aggregate:{ratingCount:number;mean:number|null;criteria:Record<string,Criterion>}};
export type VerifiedReputationView={subject:{kind:ReputationKind;id:string};state:'verified_snapshot'|'repair_required'|'requires_batched_audit';projection:Projection|null};
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const count=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
const mean=(x:unknown,n:number)=>n===0?x===null:typeof x==='number'&&Number.isFinite(x)&&x>=1&&x<=5;
export function validVerifiedReputationView(v:unknown,kind:ReputationKind,id:string):v is VerifiedReputationView{
 if(!object(v)||Object.keys(v).length!==3||!object(v.subject)||Object.keys(v.subject).length!==2||v.subject.kind!==kind||v.subject.id!==id)return false;
 if(v.state==='repair_required'||v.state==='requires_batched_audit')return v.projection===null;
 if(v.state!=='verified_snapshot'||!object(v.projection)||Object.keys(v.projection).length!==2)return false;
 const p=v.projection;
 if(!count(p.completedContracts)||!object(p.aggregate)||Object.keys(p.aggregate).length!==3)return false;
 const a=p.aggregate;
 if(!count(a.ratingCount)||a.ratingCount>p.completedContracts||!mean(a.mean,a.ratingCount)||!object(a.criteria))return false;
 const keys=Object.keys(reputationCriteria(kind));
 if(Object.keys(a.criteria).length!==keys.length)return false;
 let observations=0;
 for(const k of keys){
  const c=a.criteria[k];
  if(!object(c)||Object.keys(c).length!==2||!count(c.count)||c.count>a.ratingCount||!mean(c.mean,c.count))return false;
  observations+=c.count;
 }
 return observations>=a.ratingCount;
}
