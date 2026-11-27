// Planning only. No identifiers, I/O, deletion, TTL or production authority.
export const FIXTURE_PREFERENCE_REVIEW_MS=7*86400000;
export type FixtureLifecycleInput={category:'fixture-temporary-preference';simulation:true;purposeEndedAt:number|null;recordCount:number;estimatedBytes:number;dependenciesChecked:boolean;copiesInventoried:boolean};
export type FixtureLifecycleDecision={status:'retain'|'blocked'|'review-candidate';reason:string;recordCount:number;estimatedBytes:number;simulation:true;authorizesDeletion:false};
const nonnegative=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
export function planFixturePreferenceLifecycle(input:unknown,now:number):FixtureLifecycleDecision{
 const invalid:FixtureLifecycleDecision={status:'blocked',reason:'INVALID_FIXTURE',recordCount:0,estimatedBytes:0,simulation:true,authorizesDeletion:false};
 if(!input||typeof input!=='object'||Array.isArray(input)||!nonnegative(now)||now===0)return invalid;
 const v=input as Record<string,unknown>;
 const keys=['category','simulation','purposeEndedAt','recordCount','estimatedBytes','dependenciesChecked','copiesInventoried'];
 if(Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k))||v.category!=='fixture-temporary-preference'||v.simulation!==true||!nonnegative(v.recordCount)||!nonnegative(v.estimatedBytes)||typeof v.dependenciesChecked!=='boolean'||typeof v.copiesInventoried!=='boolean'||v.purposeEndedAt!==null&&(!nonnegative(v.purposeEndedAt)||v.purposeEndedAt===0||v.purposeEndedAt>now))return invalid;
 const result=(status:FixtureLifecycleDecision['status'],reason:string):FixtureLifecycleDecision=>({status,reason,recordCount:v.recordCount as number,estimatedBytes:v.estimatedBytes as number,simulation:true,authorizesDeletion:false});
 if(v.purposeEndedAt===null)return result('retain','PURPOSE_ACTIVE');
 if(now-v.purposeEndedAt<FIXTURE_PREFERENCE_REVIEW_MS)return result('retain','FIXTURE_REVIEW_WINDOW');
 if(!v.dependenciesChecked||!v.copiesInventoried)return result('blocked','INVENTORY_INCOMPLETE');
 return result('review-candidate','HUMAN_REVIEW_ONLY');
}
