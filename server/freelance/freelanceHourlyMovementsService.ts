import type {Transaction} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {readAttendanceContext} from './freelanceAttendanceScheduleService.js';
import {readAttendanceTimeline} from './freelanceAttendanceService.js';
import {readExtensionRecords} from './freelanceAttendanceExtensionService.js';
import {projectAcceptedFreelanceExtensions} from '../../shared/freelanceAttendanceExtensions.js';
import {buildFreelanceHourlyCommitment} from '../../shared/freelanceVariablePaymentBasis.js';
import {calculateFreelanceHourlyAccounting} from '../../shared/freelanceHourlyAccounting.js';
import {canonicalVariablePaymentRecord,readVariablePaymentSources} from './freelanceVariablePaymentBasisService.js';
import {readHourlyCancellationAgreementContext} from './freelanceHourlyCancellationAgreementService.js';
import {readHourlyExcessContext} from './freelanceHourlyExcessReviewService.js';
import {readFinancialContext,checkedReview} from './freelanceExternalPaymentStatementService.js';
import {assertFinancialCaseRestrictions,prepareCancellationRestriction,prepareExcessRestriction,prepareAdjustmentRestriction} from './freelanceEngagementRestrictionService.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';

const fail=():never=>{throw Error('FREELANCE_VARIABLE_PAYMENT_CONFLICT');};
/** Read-only projection. No estimate is converted into an obligation, no
 * participant statement is converted into a bank receipt. */
export async function readHourlyMovement(tx:Transaction,uid:string,id:string){
 const c=await readAttendanceContext(tx,uid,id),commitment=buildFreelanceHourlyCommitment(c.offer,c.application);
 const direct=c.ref.collection('directPayment'),financial=c.ref.collection('financialBasis');
 const reviewDoc=await tx.get(adminDb.doc('freelanceFinancialReviewsV1/'+id));
 const [saved,fixed,oldHistory,fixedBasis,completion,cancellation,final,history]=await tx.getAll(direct.doc('hourlyCommitment'),direct.doc('obligation'),direct.doc('externalStatements'),financial.doc('remuneration'),financial.doc('hourlyCompletion'),financial.doc('hourlyCancellation'),direct.doc('hourlyFinalObligation'),direct.doc('hourlyStatements'));
 if(!saved.exists||canonicalVariablePaymentRecord(saved.data())!==canonicalVariablePaymentRecord(commitment)||fixed.exists||oldHistory.exists||fixedBasis.exists)return fail();
 let accounting:ReturnType<typeof calculateFreelanceHourlyAccounting>|null=null,recognizedMinor:number|null=null,restrictionActive=false,reviewStatus:string|null=null,financialState='not_due',lastStatementAt:string|null=null,recognizedExcessMs:number|null=null;
 let reason:'attendance_pending'|'operational_review'|'cancellation_review'|'excess_review'|'final'='attendance_pending';
 const status=c.offer.status;
 if(status==='cancelled'){
  if(completion.exists)return fail();
  const a=await readHourlyCancellationAgreementContext(tx,uid,id);
  accounting=a.record.accounting;recognizedMinor=a.resolved?.resolution.recognizedServiceMinor??null;
  restrictionActive=a.restricted;reviewStatus=a.dispute?.status??null;reason=recognizedMinor===null?'cancellation_review':'final';
 }else if(status==='completed'){
  if(cancellation.exists)return fail();
  const s=await readVariablePaymentSources(tx,uid,id);
  if(!s.savedBasis.exists||!s.savedCommitment.exists)return fail();
  accounting=s.record.accounting;
  if(s.record.disposition==='requires_review'){
   const a=await readHourlyExcessContext(tx,uid,id);
   recognizedMinor=a.resolved?.recognizedServiceMinor??null;recognizedExcessMs=a.resolved?.recognizedExcessMs??null;
   restrictionActive=a.restricted;reviewStatus=a.dispute?.status??null;reason=recognizedMinor===null?'excess_review':'final';
  }else{recognizedMinor=s.record.finalAmountMinor;reason='final';}
 }else{
  if(completion.exists||cancellation.exists||final.exists||history.exists)return fail();
  if(status==='under_review'){
   if(!validFreelanceId(c.offer.occurrenceId)||c.application.occurrenceId!==c.offer.occurrenceId)return fail();
   const occurrence=(await tx.get(c.ref.collection('occurrences').doc(c.offer.occurrenceId))).data();
   if(!occurrence||occurrence.id!==c.offer.occurrenceId||occurrence.offerId!==id||occurrence.ownerUid!==commitment.requesterUid||occurrence.applicantUid!==commitment.beneficiaryUid||occurrence.status!=='awaiting_review'||occurrence.decision)return fail();
   reason='operational_review';
  }else if(!['contracted','in_progress','completion_requested'].includes(status))return fail();
  const t=await readAttendanceTimeline(tx,c);
  if(t){const ext=await readExtensionRecords(tx,c.ref,t.scheduleId,t.schedule,t.events);accounting=calculateFreelanceHourlyAccounting({workTerms:c.offer.workTerms,estimatedMinor:commitment.estimatedMinor,schedule:t.schedule,events:t.events,extensions:projectAcceptedFreelanceExtensions(ext.records)});}
 }
 if(status!=='cancelled')await prepareCancellationRestriction(tx,commitment,false,false);
 if(reason!=='excess_review'&&!(status==='completed'&&accounting?.status==='requires_excess_review'))await prepareExcessRestriction(tx,commitment,false,false);
 await prepareAdjustmentRestriction(tx,commitment,false,false);
 if(recognizedMinor!==null&&recognizedMinor>0){
  const x=await readFinancialContext(tx,uid,id);
  if(x.obligation.terms.amountMinor!==recognizedMinor||!x.hourlyFinal)return fail();
  const review=checkedReview(reviewDoc.data(),x.obligation),restricted=x.projection.state==='disputed'&&review?.status!=='resolved_administratively';
  await assertFinancialCaseRestrictions(tx,commitment,restricted);
  if(review?.status==='pending'&&x.projection.state!=='disputed'||review?.status==='resolved_voluntarily'&&x.projection.state!=='bilaterally_reported_received')return fail();
  restrictionActive=restricted;reviewStatus=review?.status??null;financialState=review?.status==='resolved_administratively'?'administratively_closed_unverified':x.projection.state;lastStatementAt=x.events.at(-1)?.recordedAt??null;
 }else{
  if(reviewDoc.exists||final.exists||history.exists)return fail();
  await assertFinancialCaseRestrictions(tx,commitment,false);
  financialState=recognizedMinor===0?'no_payment_required':'not_due';
 }
 if(typeof c.offer.title!=='string'||!c.offer.title.trim()||c.offer.title.length>120)return fail();
 return {offerId:id,title:c.offer.title,operationalStatus:status,requesterStoreId:commitment.requesterStoreId??null,estimatedMinor:commitment.estimatedMinor,hourlyRateMinor:commitment.hourlyRateMinor,initialMinutes:commitment.initialMinutes,authorizedMinutes:accounting?.authorizedMinutes??commitment.initialMinutes,workMs:accounting?.workMs??null,waitMs:accounting?.waitMs??null,breakMs:accounting?.breakMs??null,excessMs:accounting?.excessMs??null,recognizedExcessMs,recognizedMinor,reason,financialState,restrictionActive,reviewStatus,lastStatementAt,bankVerified:false as const};
}
