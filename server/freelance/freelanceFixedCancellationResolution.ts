import type {Transaction,CollectionReference} from 'firebase-admin/firestore';
import type {FreelancePaymentObligation} from '../../shared/freelancePaymentObligation.js';
import type {ExternalPixEvent} from '../../shared/freelanceExternalPaymentStatements.js';
import {calculateCancellationAccounting} from '../../shared/freelanceCancellationAccounting.js';
import {canonicalVariablePaymentRecord,digestVariablePaymentSources} from './freelanceVariablePaymentBasisService.js';
const fail=():never=>{throw Error('FREELANCE_CANCELLATION_ACCOUNTING_CONFLICT');};
type Input={obligation:FreelancePaymentObligation;events:readonly ExternalPixEvent[];snapshot:string;cancelledAt:string;resolvedAt:string;kind:'bilateral'|'administrative';recognizedServiceMinor:number;reportedReceivedMinor:number;decision:unknown};
export function buildFixedCancellationResolution(i:Input){
 const a=calculateCancellationAccounting(i.obligation,i.events,i.recognizedServiceMinor,i.reportedReceivedMinor),o=i.obligation;
 if(!Number.isFinite(Date.parse(i.resolvedAt))||Date.parse(i.resolvedAt)<Date.parse(i.cancelledAt)||!/^[a-f0-9]{64}$/.test(i.snapshot))return fail();
 const sourceDigest=digestVariablePaymentSources({snapshot:i.snapshot,kind:i.kind,decision:i.decision});
 const direction=a.proposedAdditionalMinor>0?'additional' as const:a.proposedRefundMinor>0?'refund' as const:'none' as const;
 const amountMinor=a.proposedAdditionalMinor+a.proposedRefundMinor;
 const resolution={schemaVersion:1,kind:'fixed_cancellation_resolution',offerId:o.offerId,baseDigest:i.snapshot,sourceDigest,cancelledAt:i.cancelledAt,resolvedAt:i.resolvedAt,resolutionKind:i.kind,...a,direction,amountMinor};
 const obligation=direction==='none'?null:{schemaVersion:1,kind:'fixed_cancellation_adjustment',offerId:o.offerId,sourceDigest,direction,amountMinor,currency:'BRL',dueAt:i.resolvedAt,payerUid:direction==='additional'?o.requesterUid:o.beneficiaryUid,recipientUid:direction==='additional'?o.beneficiaryUid:o.requesterUid,originalRequesterUid:o.requesterUid,originalBeneficiaryUid:o.beneficiaryUid,...(o.requesterStoreId?{requesterStoreId:o.requesterStoreId}:{}),method:'external_pix',custody:'none',bankVerified:false};
 return {resolution,obligation};
}
export async function readFixedResolutionRecords(tx:Transaction,direct:CollectionReference,expected:ReturnType<typeof buildFixedCancellationResolution>|null){
 const resolutionRef=direct.doc('fixedCancellationResolution'),adjustmentRef=direct.doc('fixedCancellationAdjustment');
 const [r,a]=await tx.getAll(resolutionRef,adjustmentRef);
 const equal=(raw:unknown,value:unknown)=>raw!==undefined&&canonicalVariablePaymentRecord(raw)===canonicalVariablePaymentRecord(value);
 if(expected?(!equal(r.data(),expected.resolution)||(expected.obligation?!equal(a.data(),expected.obligation):a.exists)):r.exists||a.exists)return fail();
 return {resolutionRef,adjustmentRef};
}
export function writeFixedResolution(tx:Transaction,refs:Awaited<ReturnType<typeof readFixedResolutionRecords>>,expected:ReturnType<typeof buildFixedCancellationResolution>){
 tx.create(refs.resolutionRef,expected.resolution);if(expected.obligation)tx.create(refs.adjustmentRef,expected.obligation);
}
