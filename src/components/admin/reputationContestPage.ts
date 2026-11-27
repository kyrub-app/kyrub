export const subjects={professional:'Profissional',personal_requester:'Contratante pessoal',store_requester:'Contratante empresarial'} as const;
type Item={caseId:string;offerId:string;subjectKind:keyof typeof subjects;ratingRole:'requester'|'worker';stars:number;submittedAt:string;requestedAt:string;reason:string;ratingDigest:string;status:'pending'};
export type Page={items:Item[];nextCursor:string|null;readOnly:true};
const digest=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const date=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
export function validReputationContestPage(v:unknown):v is Page{
 if(!v||typeof v!=='object'||Array.isArray(v))return false;
 const p=v as Page;
 return p.readOnly===true&&Object.keys(p).length===3&&Array.isArray(p.items)&&p.items.length<=20&&(p.nextCursor===null||digest(p.nextCursor))&&new Set(p.items.map(i=>i?.caseId)).size===p.items.length&&p.items.every(i=>
  i&&Object.keys(i).length===10&&digest(i.caseId)&&id(i.offerId)&&Object.hasOwn(subjects,i.subjectKind)&&
  (i.ratingRole==='requester'?i.subjectKind==='professional':i.ratingRole==='worker'&&i.subjectKind!=='professional')&&
  Number.isInteger(i.stars)&&i.stars>=1&&i.stars<=5&&date(i.submittedAt)&&date(i.requestedAt)&&Date.parse(i.requestedAt)>=Date.parse(i.submittedAt)&&
  typeof i.reason==='string'&&!!i.reason.trim()&&i.reason.length<=1000&&digest(i.ratingDigest)&&i.status==='pending');
}
