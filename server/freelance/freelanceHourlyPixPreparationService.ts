import type {Transaction} from 'firebase-admin/firestore';
import {readAttendanceContext} from './freelanceAttendanceScheduleService.js';
import {buildFreelanceHourlyCommitment} from '../../shared/freelanceVariablePaymentBasis.js';
import {canonicalVariablePaymentRecord} from './freelanceVariablePaymentBasisService.js';
import {createDirectPaymentTerms} from '../../shared/directPaymentTerms.js';
import type {FreelancePaymentObligation} from '../../shared/freelancePaymentObligation.js';

const fail=():never=>{throw Error('FREELANCE_VARIABLE_PAYMENT_CONFLICT');};
/** Pre-completion consent context only. The estimated amount is never payable
 * and this adapter must never be passed to payment statements or disclosure. */
export async function readHourlyPixPreparation(tx:Transaction,uid:string,id:string){
 const c=await readAttendanceContext(tx,uid,id);
 const commitment=buildFreelanceHourlyCommitment(c.offer,c.application);
 if(!['contracted','in_progress','completion_requested'].includes(c.offer.status))return fail();
 const direct=c.ref.collection('directPayment');
 const [saved,fixed,final,statements,oldStatements,basis,fixedBasis]=await tx.getAll(direct.doc('hourlyCommitment'),direct.doc('obligation'),direct.doc('hourlyFinalObligation'),direct.doc('hourlyStatements'),direct.doc('externalStatements'),c.ref.collection('financialBasis').doc('hourlyCompletion'),c.ref.collection('financialBasis').doc('remuneration'));
 if(!saved.exists||canonicalVariablePaymentRecord(saved.data())!==canonicalVariablePaymentRecord(commitment)||[fixed,final,statements,oldStatements,basis,fixedBasis].some(d=>d.exists))return fail();
 const obligation:FreelancePaymentObligation={schemaVersion:1,offerId:id,requesterUid:commitment.requesterUid,beneficiaryUid:commitment.beneficiaryUid,
 ...(commitment.requesterStoreId?{requesterStoreId:commitment.requesterStoreId}:{}),contractedAt:commitment.contractedAt,
 terms:createDirectPaymentTerms({method:'external_pix',amountMinor:commitment.estimatedMinor}),dueTrigger:'bilateral_service_completion',custody:'none'};
 return {offer:c.offer,obligation,events:[],projection:{state:'awaiting_payment' as const},due:false,hourlyFinal:undefined};
}
