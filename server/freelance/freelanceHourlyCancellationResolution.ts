import type {Transaction,CollectionReference} from 'firebase-admin/firestore';
import type {FreelanceHourlyCommitment} from '../../shared/freelanceVariablePaymentBasis.js';
import {canonicalVariablePaymentRecord,digestVariablePaymentSources} from './freelanceVariablePaymentBasisService.js';
const fail=():never=>{throw Error('FREELANCE_VARIABLE_PAYMENT_CONFLICT');};
const equal=(a:unknown,b:unknown)=>a!==undefined&&canonicalVariablePaymentRecord(a)===canonicalVariablePaymentRecord(b);
type ResolutionInput={sourceDigest:string;commitment:FreelanceHourlyCommitment;capMinor:number;recognizedServiceMinor:number;resolvedAt:string;resolution:'bilateral'|'administrative';evidence:unknown};
export function buildHourlyCancellationResolution(input:ResolutionInput){
 const {commitment:c,recognizedServiceMinor:amount,capMinor,resolvedAt}=input;
 if(!Number.isSafeInteger(amount)||amount<0||amount>capMinor||!Number.isFinite(Date.parse(resolvedAt)))return fail();
 const sourceDigest=digestVariablePaymentSources({base:input.sourceDigest,resolution:input.resolution,evidence:input.evidence});
 const resolution={schemaVersion:1 as const,kind:'hourly_cancellation_resolution' as const,offerId:c.offerId,baseDigest:input.sourceDigest,sourceDigest,recognizedServiceMinor:amount,resolvedAt,resolution:input.resolution,disposition:amount===0?'no_payment_required' as const:'positive_amount_calculated' as const,bankVerified:false as const};
 const final=amount===0?null:{schemaVersion:1 as const,kind:'hourly_cancellation_obligation' as const,offerId:c.offerId,requesterUid:c.requesterUid,beneficiaryUid:c.beneficiaryUid,...(c.requesterStoreId?{requesterStoreId:c.requesterStoreId}:{}),contractedAt:c.contractedAt,dueAt:resolvedAt,sourceDigest,amountMinor:amount,currency:'BRL' as const,method:'external_pix' as const,custody:'none' as const};
 return {resolution,final};
}
export async function readCancellationResolutionRecords(tx:Transaction,direct:CollectionReference,expected:ReturnType<typeof buildHourlyCancellationResolution>|null){
 const resolutionRef=direct.doc('hourlyCancellationResolution'),finalRef=direct.doc('hourlyFinalObligation'),statementRef=direct.doc('hourlyStatements');
 const [resolution,final,history]=await tx.getAll(resolutionRef,finalRef,statementRef);
 if(expected){if(!equal(resolution.data(),expected.resolution)||(expected.final?!equal(final.data(),expected.final):final.exists||history.exists))return fail();}
 else if(resolution.exists||final.exists||history.exists)return fail();
 return {resolutionRef,finalRef,statementRef,history};
}
export function writeCancellationResolution(tx:Transaction,records:Awaited<ReturnType<typeof readCancellationResolutionRecords>>,expected:ReturnType<typeof buildHourlyCancellationResolution>){
 tx.create(records.resolutionRef,expected.resolution);if(expected.final)tx.create(records.finalRef,expected.final);
}
