import type {FreelanceVariablePaymentBasis} from './freelanceVariablePaymentBasis.js';
const fail=():never=>{throw Error('FREELANCE_VARIABLE_PAYMENT_CONFLICT');};
/** Review recognizes only already recorded excess, never retroactively extends
 * the schedule or removes the remunerable authorized portion. Round once. */
export function calculateHourlyExcessResolution(basis:FreelanceVariablePaymentBasis,recognizedExcessMs:number){
 const a=basis.accounting;
 if(basis.disposition!=='requires_review'||a.status!=='requires_excess_review'||!Number.isSafeInteger(a.excessMs)||a.excessMs<=0||
 !Number.isSafeInteger(recognizedExcessMs)||recognizedExcessMs<0||recognizedExcessMs>a.excessMs||
 !Number.isSafeInteger(a.hourlyRateMinor)||a.hourlyRateMinor<=0||!Number.isSafeInteger(a.compensableMs)||a.compensableMs<a.excessMs||
 a.compensableMs-a.excessMs!==a.authorizedMinutes*60000)return fail();
 const recognizedMs=a.compensableMs-a.excessMs+recognizedExcessMs;
 const minor=(BigInt(a.hourlyRateMinor)*BigInt(recognizedMs)+1800000n)/3600000n;
 if(minor>999999999n||minor<BigInt(a.withinCapReferenceMinor))return fail();
 return {recognizedExcessMs,unrecognizedExcessMs:a.excessMs-recognizedExcessMs,recognizedMs,recognizedServiceMinor:Number(minor),bankVerified:false as const};
}
