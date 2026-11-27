import {adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {validFreelanceId,type FreelanceOffer,type FreelanceApplication} from '../../shared/freelanceLifecycle.js';
import {buildFreelancePaymentObligation,matchesFreelancePaymentObligation} from '../../shared/freelancePaymentObligation.js';
import {buildFreelanceRemunerationBasis,matchesFreelanceRemunerationBasis} from '../../shared/freelanceRemuneration.js';
import {appendExternalPixStatement,projectExternalPixStatements,type ExternalPixEvent,type ExternalPixStatement} from '../../shared/freelanceExternalPaymentStatements.js';
import {prepareVoluntaryDisputeRestriction,assertFinancialCaseRestrictions} from './freelanceEngagementRestrictionService.js';

function assertLocal(){
 if(process.env.VERCEL||process.env.VERCEL_ENV||process.env.FIREBASE_SERVICE_ACCOUNT_JSON||process.env.GOOGLE_APPLICATION_CREDENTIALS||
 !/^(127\.0\.0\.1|localhost):8088$/.test(process.env.FIRESTORE_EMULATOR_HOST??'')||
 getFirebaseAdminProjectId()!=='kyrub-security-test')throw Error('FREELANCE_DIRECT_PAYMENT_NOT_ENABLED');
}
function contractSnapshot<T extends FreelanceOffer|FreelanceApplication>(record:T):T{
 const {startedAt,completionRequestedAt,completedAt,...rest}=record;
 return {...rest,status:'contracted'} as T;
}
function readEvents(raw:unknown,offerId:string):ExternalPixEvent[]{
 if(raw===undefined)return [];
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('FREELANCE_PAYMENT_STATEMENT_CONFLICT');
 const r=raw as {schemaVersion:unknown;offerId:unknown;events:unknown};
 if(Object.keys(r).length!==3||r.schemaVersion!==1||r.offerId!==offerId||!Array.isArray(r.events)||r.events.length<1||r.events.length>3||
 !r.events.every(e=>e&&typeof e==='object'&&Object.keys(e).length===4&&typeof e.id==='string'&&typeof e.actorUid==='string'&&
 typeof e.recordedAt==='string'&&['paid','received','not_received'].includes(e.statement)))throw Error('FREELANCE_PAYMENT_STATEMENT_CONFLICT');
 return r.events;
}
export async function readFinancialContext(tx:FirebaseFirestore.Transaction,uid:string,offerId:string){
 const ref=adminDb.doc('freelanceOffersV1/'+offerId),direct=ref.collection('directPayment'),statementRef=direct.doc('externalStatements');
  const [o,ob,history]=await tx.getAll(ref,direct.doc('obligation'),statementRef);
  const offer=o.data() as FreelanceOffer|undefined;
  if(!offer||offer.id!==offerId||!validFreelanceId(offer.selectedApplicantUid)||
   (uid!==offer.ownerUid&&uid!==offer.selectedApplicantUid))throw Error('FREELANCE_FORBIDDEN');
  const app=(await tx.get(ref.collection('applications').doc(offer.selectedApplicantUid))).data() as FreelanceApplication|undefined;
  if(!app||app.status!==offer.status||!['contracted','in_progress','completion_requested','completed'].includes(offer.status))
   throw Error('FREELANCE_PAYMENT_STATEMENT_CONFLICT');
  const obligation=buildFreelancePaymentObligation(contractSnapshot(offer),contractSnapshot(app));
  if(obligation.terms.method!=='external_pix'||!matchesFreelancePaymentObligation(ob.data(),obligation))
   throw Error('FREELANCE_PAYMENT_OBLIGATION_CONFLICT');
  if(obligation.dueTrigger==='bilateral_service_completion'&&offer.status!=='completed')throw Error('FREELANCE_PAYMENT_NOT_DUE');
  if(offer.status==='completed'){
   const basis=buildFreelanceRemunerationBasis(offer,app);
   const saved=await tx.get(ref.collection('financialBasis').doc('remuneration'));
   if(!matchesFreelanceRemunerationBasis(saved.data(),basis))throw Error('FREELANCE_FINANCIAL_BASIS_CONFLICT');
  }
  const events=readEvents(history.data(),offerId);
  const projection=projectExternalPixStatements(obligation,events);
  if(obligation.dueTrigger==='bilateral_service_completion'&&events.some(e=>Date.parse(e.recordedAt)<Date.parse(offer.completedAt!)))throw Error('FREELANCE_PAYMENT_STATEMENT_CONFLICT');

 return {offer,obligation,events,projection,statementRef};
}
export type FinancialReviewOutcome='payment_evidence_accepted'|'nonreceipt_evidence_accepted'|'inconclusive';
export type FinancialReviewDecision={actorUid:string;outcome:FinancialReviewOutcome;reason:string;decidedAt:string;bankVerified:false;evidenceRevision:number};
export function isFinancialReviewOutcome(v:unknown):v is FinancialReviewOutcome{
 return v==='payment_evidence_accepted'||v==='nonreceipt_evidence_accepted'||v==='inconclusive';
}
type FinancialReview={
 schemaVersion:1;offerId:string;requesterUid:string;beneficiaryUid:string;requestedBy:string;
 requestedAt:string;status:'pending'|'resolved_voluntarily'|'resolved_administratively';resolvedAt?:string;decision?:FinancialReviewDecision;
};
const reviewRef=(offerId:string)=>adminDb.doc('freelanceFinancialReviewsV1/'+offerId);
export function checkedReview(raw:unknown,obligation:ReturnType<typeof buildFreelancePaymentObligation>):FinancialReview|undefined{
 if(raw===undefined)return undefined;
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('FREELANCE_FINANCIAL_REVIEW_CONFLICT');
 const r=raw as FinancialReview;
 if(r.schemaVersion!==1||r.offerId!==obligation.offerId||r.requesterUid!==obligation.requesterUid||r.beneficiaryUid!==obligation.beneficiaryUid||
 ![r.requesterUid,r.beneficiaryUid].includes(r.requestedBy)||!Number.isFinite(Date.parse(r.requestedAt))||
 Date.parse(r.requestedAt)<Date.parse(obligation.contractedAt)||
 !['pending','resolved_voluntarily','resolved_administratively'].includes(r.status)||Object.keys(r).length!==(r.status==='pending'?7:r.status==='resolved_voluntarily'?8:9)||
 (r.status==='pending'?r.resolvedAt!==undefined:!r.resolvedAt||!Number.isFinite(Date.parse(r.resolvedAt))||Date.parse(r.resolvedAt)<Date.parse(r.requestedAt)))
 throw Error('FREELANCE_FINANCIAL_REVIEW_CONFLICT');
 if(r.status==='resolved_administratively'){
  const d=r.decision;
  if(!d||Object.keys(d).length!==6||!validFreelanceId(d.actorUid)||[r.requesterUid,r.beneficiaryUid].includes(d.actorUid)||
   !isFinancialReviewOutcome(d.outcome)||typeof d.reason!=='string'||d.reason.trim()!==d.reason||d.reason.length<10||d.reason.length>1000||
   d.decidedAt!==r.resolvedAt||d.bankVerified!==false||!Number.isSafeInteger(d.evidenceRevision)||d.evidenceRevision<0||d.evidenceRevision>6)throw Error('FREELANCE_FINANCIAL_REVIEW_CONFLICT');
 }else if(r.decision!==undefined)throw Error('FREELANCE_FINANCIAL_REVIEW_CONFLICT');
 return r;
}
/** Explicit escalation by either participant, one queue entry per disputed obligation. */
export async function requestFreelanceFinancialReview(uid:string,offerId:string,input:unknown){
 assertLocal();
 if(!validFreelanceId(uid)||!validFreelanceId(offerId)||!input||typeof input!=='object'||Array.isArray(input)||
 Object.keys(input).length!==1||(input as Record<string,unknown>).confirmed!==true)throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(async tx=>{
  const ref=reviewRef(offerId),snapshot=await tx.get(ref);
  const {obligation,events,projection}=await readFinancialContext(tx,uid,offerId);
  const existing=checkedReview(snapshot.data(),obligation);
  if(projection.state!=='disputed')throw Error('FREELANCE_FINANCIAL_REVIEW_CONFLICT');
  await assertFinancialCaseRestrictions(tx,obligation);
  if(existing){
   if(existing.status!=='pending')throw Error('FREELANCE_FINANCIAL_REVIEW_CONFLICT');
   return {created:false,status:'pending' as const};
  }
  const requestedAt=new Date().toISOString();
  if(Date.parse(requestedAt)<Date.parse(events[events.length-1].recordedAt))throw Error('FREELANCE_FINANCIAL_REVIEW_CONFLICT');
  const record:FinancialReview={schemaVersion:1,offerId,requesterUid:obligation.requesterUid,beneficiaryUid:obligation.beneficiaryUid,
   requestedBy:uid,requestedAt,status:'pending'};
  tx.create(ref,record);
  return {created:true,status:'pending' as const};
 });
}

/** Service-only; the authenticated transport must supply the actor UID.
 * Participant statements record facts as asserted, not provider verification.
 * The restriction and its causal history commit together or neither commits.
 */
export async function recordFreelanceExternalPaymentStatement(uid:string,offerId:string,input:unknown){
 assertLocal();
 if(!validFreelanceId(uid)||!validFreelanceId(offerId)||!input||typeof input!=='object'||Array.isArray(input))throw Error('FREELANCE_INVALID');
 const b=input as Record<string,unknown>;
 if(Object.keys(b).length!==3||!validFreelanceId(b.eventId)||b.confirmed!==true||
 (typeof b.statement!=='string'||!['paid','received','not_received'].includes(b.statement)))throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(async tx=>{
  const review=reviewRef(offerId),reviewSnapshot=await tx.get(review);
  const {offer,obligation,events,statementRef}=await readFinancialContext(tx,uid,offerId);
  if((b.statement==='paid'&&uid!==offer.ownerUid)||(b.statement!=='paid'&&uid!==offer.selectedApplicantUid))throw Error('FREELANCE_FORBIDDEN');
  const now=new Date().toISOString();
  if(obligation.dueTrigger==='bilateral_service_completion'&&
   (Date.parse(now)<Date.parse(offer.completedAt!)||events.some(e=>Date.parse(e.recordedAt)<Date.parse(offer.completedAt!))))throw Error('FREELANCE_PAYMENT_STATEMENT_CONFLICT');
  const next=appendExternalPixStatement(obligation,events,{id:b.eventId as string,actorUid:uid,statement:b.statement as ExternalPixStatement,recordedAt:now});
  if(next.changed){
   const existing=checkedReview(reviewSnapshot.data(),obligation);
   const administrativelyClosed=existing?.status==='resolved_administratively';
   // Actual receipt may be recorded later without reopening or rewriting the decision.
   if(administrativelyClosed){
    if(next.state!=='bilaterally_reported_received'||Date.parse(now)<Date.parse(existing!.resolvedAt!))throw Error('FREELANCE_FINANCIAL_REVIEW_CONFLICT');
    await assertFinancialCaseRestrictions(tx,obligation,false);
   }else if(existing&&existing.status!=='pending')throw Error('FREELANCE_FINANCIAL_REVIEW_CONFLICT');
   const writeRestrictions=administrativelyClosed?()=>{}:await prepareVoluntaryDisputeRestriction(tx,obligation,events,next.events);
   if(existing&&next.state!=='disputed'&&next.state!=='bilaterally_reported_received')throw Error('FREELANCE_FINANCIAL_REVIEW_CONFLICT');
   if(existing&&next.state==='bilaterally_reported_received'&&Date.parse(now)<Date.parse(existing.requestedAt))throw Error('FREELANCE_FINANCIAL_REVIEW_CONFLICT');
   tx.set(statementRef,{schemaVersion:1,offerId,events:next.events});
   writeRestrictions();
   if(existing?.status==='pending'&&next.state==='bilaterally_reported_received')tx.update(review,{status:'resolved_voluntarily',resolvedAt:now});
  }
  return {changed:next.changed,state:next.state,hadDisagreement:next.hadDisagreement,bankVerified:false as const,settlementEvidence:next.settlementEvidence};
 });
}
