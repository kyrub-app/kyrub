import {readHourlyExcessContext} from './freelanceHourlyExcessReviewService.js';
import {readHourlyCancellationAgreementContext} from './freelanceHourlyCancellationAgreementService.js';
import type {FreelanceOffer} from '../../shared/freelanceLifecycle.js';
import type {Transaction} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {createDirectPaymentTerms} from '../../shared/directPaymentTerms.js';
import type {FreelancePaymentObligation} from '../../shared/freelancePaymentObligation.js';
import {readVariablePaymentSources} from './freelanceVariablePaymentBasisService.js';

const fail=():never=>{throw Error('FREELANCE_VARIABLE_PAYMENT_CONFLICT');};
export function buildFinal(record:Awaited<ReturnType<typeof readVariablePaymentSources>>['record']){
 const c=record.commitment,amount=record.finalAmountMinor;
 if(record.disposition!=='positive_amount_calculated'||amount===null||!Number.isSafeInteger(amount)||amount<=0||amount>record.accounting.authorizedCapMinor)return fail();
 return {schemaVersion:1 as const,kind:'hourly_final_obligation' as const,offerId:c.offerId,
 requesterUid:c.requesterUid,beneficiaryUid:c.beneficiaryUid,...(c.requesterStoreId?{requesterStoreId:c.requesterStoreId}:{}),
 contractedAt:c.contractedAt,completedAt:record.completedAt,sourceDigest:record.sourceDigest,amountMinor:amount,currency:'BRL' as const,
 method:'external_pix' as const,custody:'none' as const};
}
function matches(raw:unknown,expected:ReturnType<typeof buildFinal>){
 return !!raw&&typeof raw==='object'&&!Array.isArray(raw)&&Object.keys(raw).length===Object.keys(expected).length&&Object.entries(expected).every(([k,v])=>(raw as Record<string,unknown>)[k]===v);
}
/** Internal local candidate: issue only after the immutable positive basis exists.
 * No transfer, no public issuance action. The amount can never be supplied by the client. */
export async function issueFreelanceHourlyFinalObligation(uid:string,offerId:string){
 return adminDb.runTransaction(async tx=>{
  const s=await readVariablePaymentSources(tx,uid,offerId);
  if(!s.savedCommitment.exists||!s.savedBasis.exists)return fail();
  const final=buildFinal(s.record),ref=s.c.ref.collection('directPayment').doc('hourlyFinalObligation'),saved=await tx.get(ref);
  if(saved.exists){if(!matches(saved.data(),final))return fail();return {final,replay:true};}
  if((await tx.get(s.c.ref.collection('directPayment').doc('hourlyStatements'))).exists)return fail();
  tx.create(ref,final);return {final,replay:false};
 });
}
export async function readFreelanceHourlyFinalContext(tx:Transaction,uid:string,offerId:string){
 const offer=(await tx.get(adminDb.doc('freelanceOffersV1/'+offerId))).data() as FreelanceOffer|undefined;
 if(offer?.status==='cancelled'){
  const c=await readHourlyCancellationAgreementContext(tx,uid,offerId),final=c.resolved?.final;
  if(!final)return fail();
  const obligation:FreelancePaymentObligation={schemaVersion:1,offerId,requesterUid:final.requesterUid,beneficiaryUid:final.beneficiaryUid,...(final.requesterStoreId?{requesterStoreId:final.requesterStoreId}:{}),contractedAt:final.contractedAt,terms:createDirectPaymentTerms({method:'external_pix',amountMinor:final.amountMinor}),dueTrigger:'bilateral_service_completion',custody:'none'};
  return {offer:c.c.offer,obligation,final,dueAt:final.dueAt,statementRef:c.resolutionRecords.statementRef,history:c.resolutionRecords.history};
 }
 const s=await readVariablePaymentSources(tx,uid,offerId);
 if(!s.savedCommitment.exists||!s.savedBasis.exists)return fail();
 if(s.record.disposition==='requires_review'){
  const c=await readHourlyExcessContext(tx,uid,offerId),final=c.obligation;
  if(!final)return fail();
  const obligation:FreelancePaymentObligation={schemaVersion:1,offerId,requesterUid:final.requesterUid,beneficiaryUid:final.beneficiaryUid,...(final.requesterStoreId?{requesterStoreId:final.requesterStoreId}:{}),contractedAt:final.contractedAt,terms:createDirectPaymentTerms({method:'external_pix',amountMinor:final.amountMinor}),dueTrigger:'bilateral_service_completion',custody:'none'};
  return {offer:c.c.offer,obligation,final,dueAt:final.dueAt,statementRef:c.statementRef,history:c.history};
 }
 const final=buildFinal(s.record);
 const direct=s.c.ref.collection('directPayment'),statementRef=direct.doc('hourlyStatements');
 const [saved,history]=await tx.getAll(direct.doc('hourlyFinalObligation'),statementRef);
 if(!matches(saved.data(),final))return fail();
 // Adapt the existing declaration/review policy in memory only. No fixed obligation document.
 const obligation:FreelancePaymentObligation={schemaVersion:1,offerId,requesterUid:final.requesterUid,beneficiaryUid:final.beneficiaryUid,
 ...(final.requesterStoreId?{requesterStoreId:final.requesterStoreId}:{}),contractedAt:final.contractedAt,terms:createDirectPaymentTerms({method:'external_pix',amountMinor:final.amountMinor}),
 dueTrigger:'bilateral_service_completion',custody:'none'};
 return {offer:s.c.offer,obligation,final,dueAt:final.completedAt,statementRef,history};
}
