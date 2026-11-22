// The one-time commercial-phase marker is a presentation boundary only.
// It does not change accounting, historical records, payout obligations,
// available funds, refunds, payment statuses, or eligibility for settlement.
export const OFFICIAL_PHASE_STORE_ID='store-ae53dc42e57eb9d5c3f7151c1431';
export const OFFICIAL_PHASE_CONFIRMATION='INICIAR NOVA FASE DA KYRUB OFICIAL';
export type OperationalPhaseView={storeId:string;active:boolean;effectiveAt:string;scope:'operational_view_only'};
export function validOfficialPhaseActivation(value:unknown):value is {
 storeId:string;action:'start-operational-phase';confirmation:string
}{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const x=value as Record<string,unknown>;
 return Object.keys(x).length===3&&x.storeId===OFFICIAL_PHASE_STORE_ID&&
 x.action==='start-operational-phase'&&x.confirmation===OFFICIAL_PHASE_CONFIRMATION;
}
const asTime=(value:string)=>Date.parse(value);
export function showOrderInCurrentPhase(order:{status:string;createdAt:string},effectiveAt:string):boolean{
 const cutoff=asTime(effectiveAt),created=asTime(order.createdAt);
 if(!Number.isFinite(cutoff)||!Number.isFinite(created))return true;
 // Never hide an unfinished order, even if it was created during the test
 // period; it can still be actionable by staff.
 if(!['completed','rejected','cancelled'].includes(order.status))return true;
 return created>=cutoff;
}
export function effectiveHistoryStart(periodStart:string,phaseStart:string):string{
 if(!phaseStart)return periodStart;
 if(!periodStart)return phaseStart;
 return periodStart>=phaseStart?periodStart:phaseStart;
}


// Parse exactly one Firebase Bearer token for the owner-only phase GET.
// This parser is unit-tested to guard against escaped-backslash regressions.
export function readOfficialPhaseBearerToken(header:unknown):string{
 if(typeof header!=='string'||header.length>8200)return '';
 const match=/^Bearer\s+([^\s]+)$/i.exec(header.trim());
 return match&&match[1].length<=8192?match[1]:'';
}
