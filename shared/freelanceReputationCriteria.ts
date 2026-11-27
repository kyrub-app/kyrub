import type {ReputationSubject} from './freelanceReputation.js';

export const PROFESSIONAL_REPUTATION_CRITERIA={
 punctuality:'Pontualidade',courtesy:'Cordialidade',commitment:'Comprometimento',
 quality:'Qualidade',communication:'Comunicação',cooperation:'Cooperação',organization:'Organização',
} as const;
export const REQUESTER_REPUTATION_CRITERIA={
 payment_punctuality:'Pontualidade no pagamento',courtesy:'Cordialidade',agreement:'Cumprimento do combinado',
 communication:'Comunicação',organization:'Organização',working_conditions:'Condições de trabalho',resources:'Recursos de trabalho',
} as const;
export type ReputationKind=ReputationSubject['kind'];
export type CriterionScore=1|2|3|4|5|null;
export type ReputationScores=Readonly<Record<string,CriterionScore>>;
const invalid=():never=>{throw Error('FREELANCE_REPUTATION_CRITERIA_INVALID');};
export function reputationCriteria(kind:ReputationKind){
 if(kind==='professional')return PROFESSIONAL_REPUTATION_CRITERIA;
 if(kind==='personal_requester'||kind==='store_requester')return REQUESTER_REPUTATION_CRITERIA;
 return invalid();
}
/** Exact server-owned schema. null explicitly means not applicable, not zero.
 * A completely unscored submission is not a reputation. */
export function normalizeReputationScores(kind:ReputationKind,input:unknown):ReputationScores{
 const keys=Object.keys(reputationCriteria(kind));
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==keys.length)return invalid();
 const raw=input as Record<string,unknown>,scores:Record<string,CriterionScore>={};
 for(const k of keys){
  if(!Object.hasOwn(raw,k))return invalid();
  const v=raw[k];
  if(v!==null&&(typeof v!=='number'||!Number.isInteger(v)||v<1||v>5))return invalid();
  scores[k]=v as CriterionScore;
 }
 if(Object.values(scores).every(v=>v===null))return invalid();
 return scores;
}
export function projectReputationRating(kind:ReputationKind,input:unknown){
 const scores=normalizeReputationScores(kind,input);
 const applicable=Object.values(scores).filter((n):n is Exclude<CriterionScore,null>=>n!==null);
 return {scores,applicableCount:applicable.length,mean:applicable.reduce((sum,n)=>sum+n,0)/applicable.length};
}
/** Each legitimate released rating contributes equally to overall mean;
 * per-criterion averages include only applicable scores. Empty = no rating.
 * Caller must supply validated, deduplicated released records of ONE subject.
 * No public visibility, reward, or ranking policy is implemented here. */
export function projectReputationAggregate(kind:ReputationKind,ratings:readonly unknown[]){
 if(!Array.isArray(ratings))return invalid();
 const criteria:Record<string,{count:number;sum:number;mean:number|null}>={};
 for(const k of Object.keys(reputationCriteria(kind)))criteria[k]={count:0,sum:0,mean:null};
 let sum=0;
 for(const input of ratings){
  const r=projectReputationRating(kind,input);sum+=r.mean;
  for(const [k,v] of Object.entries(r.scores))if(v!==null){criteria[k].count++;criteria[k].sum+=v;}
 }
 for(const c of Object.values(criteria))c.mean=c.count?c.sum/c.count:null;
 return {ratingCount:ratings.length,mean:ratings.length?sum/ratings.length:null,criteria:Object.fromEntries(Object.entries(criteria).map(([k,c])=>[k,{count:c.count,mean:c.mean}]))};
}
