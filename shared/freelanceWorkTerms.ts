export const FREELANCE_RECOMMENDED_HOURLY_MINOR=2000 as const;
export const FREELANCE_MAX_ESTIMATED_MINUTES=10080 as const;
export type FreelanceWorkTerms={mode:'fixed';location:'remote'|'on_site';estimatedMinutes:number}|{mode:'hourly';location:'remote'|'on_site';estimatedMinutes:number;hourlyRateMinor:number};
const invalid=():never=>{throw Error('FREELANCE_INVALID');};
export function readFreelanceWorkTerms(value:unknown,amountMinor:number):FreelanceWorkTerms|undefined{
 if(value===undefined)return undefined;
 if(!value||typeof value!=='object'||Array.isArray(value)||!Number.isSafeInteger(amountMinor)||amountMinor<1||amountMinor>999999999)return invalid();
 const v=value as Record<string,unknown>,m=v.estimatedMinutes;
 if((v.location!=='remote'&&v.location!=='on_site')||typeof m!=='number'||!Number.isSafeInteger(m)||m<1||m>FREELANCE_MAX_ESTIMATED_MINUTES)return invalid();
 if(v.mode==='fixed'&&Object.keys(v).length===3)return {mode:'fixed',location:v.location,estimatedMinutes:m};
 if(v.mode!=='hourly'||Object.keys(v).length!==4||typeof v.hourlyRateMinor!=='number'||!Number.isSafeInteger(v.hourlyRateMinor)||v.hourlyRateMinor<1||v.hourlyRateMinor>999999999)return invalid();
 const planned=Math.floor((v.hourlyRateMinor*m+30)/60);
 if(planned!==amountMinor)return invalid();
 return {mode:'hourly',location:v.location,estimatedMinutes:m,hourlyRateMinor:v.hourlyRateMinor};
}
export function sameFreelanceWorkTerms(a:unknown,b:unknown,amountMinor:number):boolean{
 try{return JSON.stringify(readFreelanceWorkTerms(a,amountMinor))===JSON.stringify(readFreelanceWorkTerms(b,amountMinor));}catch{return false;}
}
export function projectFreelanceWorkRecommendation(value:unknown,amountMinor:number){
 const t=readFreelanceWorkTerms(value,amountMinor);if(!t)return invalid();
 // Minimum recommendation rounded upwards; below it remains permitted.
 const recommendedMinor=Math.ceil(FREELANCE_RECOMMENDED_HOURLY_MINOR*t.estimatedMinutes/60);
 const equivalentHourlyMinor=Math.floor((amountMinor*60+Math.floor(t.estimatedMinutes/2))/t.estimatedMinutes);
 return {recommendedMinor,equivalentHourlyMinor,belowRecommendation:amountMinor<recommendedMinor};
}
/** Hourly contracts require a new authoritative attendance/settlement basis.
 * Fixed work retains the existing full amount on bilateral completion. */
export function assertFreelanceWorkExecutionReady(terms:FreelanceWorkTerms|undefined){
 if(terms?.mode==='hourly')throw Error('FREELANCE_WORK_MODE_NOT_ENABLED');
}
