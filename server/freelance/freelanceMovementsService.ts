import {FieldPath} from 'firebase-admin/firestore';
import {adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {validFreelanceId,readFreelancePaymentTerms,type FreelanceOffer} from '../../shared/freelanceLifecycle.js';
import {readFinancialContext,checkedReview} from './freelanceExternalPaymentStatementService.js';
import {assertFinancialCaseRestrictions} from './freelanceEngagementRestrictionService.js';

type Role='requester'|'freelancer';
const states=['contracted','in_progress','completion_requested','completed','under_review','cancelled'];
/** A bounded role-scoped page; no aggregation across unqueried records, no
 * wallet postings, and no bank balance inferred from participant statements. */
export async function readOwnFreelanceMovements(uid:string,role:unknown,cursor:unknown){
 if(process.env.VERCEL||process.env.VERCEL_ENV||process.env.FIREBASE_SERVICE_ACCOUNT_JSON||process.env.GOOGLE_APPLICATION_CREDENTIALS||
 !['127.0.0.1:8088','localhost:8088'].includes(process.env.FIRESTORE_EMULATOR_HOST??'')||getFirebaseAdminProjectId()!=='kyrub-security-test')throw Error('FREELANCE_DIRECT_PAYMENT_NOT_ENABLED');
 if(!validFreelanceId(uid)||(role!=='requester'&&role!=='freelancer')||(cursor!==undefined&&!validFreelanceId(cursor)))throw Error('FREELANCE_INVALID');
 const perspective:Role=role;
 return adminDb.runTransaction(async tx=>{
  let q=adminDb.collection('freelanceOffersV1').where(perspective==='requester'?'ownerUid':'selectedApplicantUid','==',uid).orderBy(FieldPath.documentId()).limit(21);
  if(typeof cursor==='string')q=q.startAfter(cursor);
  const docs=await tx.get(q),page=docs.docs.slice(0,20);
  const entries=[];
  let otherMethods=0,operationalReview=0;
  for(const d of page){
   const o=d.data() as FreelanceOffer;
   if(o.id!==d.id||!validFreelanceId(o.ownerUid)||(perspective==='requester'?o.ownerUid!==uid:o.selectedApplicantUid!==uid||o.ownerUid===uid))throw Error('FREELANCE_PAYMENT_OBLIGATION_CONFLICT');
   if(!states.includes(o.status)||!o.contractedAt)continue;
   const terms=readFreelancePaymentTerms(o.paymentTerms,o.paymentMinor);
   if(!terms||terms.method!=='external_pix'){otherMethods++;continue;}
   if(['under_review','cancelled'].includes(o.status)){operationalReview++;continue;}
   const {offer,obligation,events,projection,due}=await readFinancialContext(tx,uid,d.id,true);
   if(typeof offer.title!=='string'||!offer.title.trim()||offer.title.length>120)throw Error('FREELANCE_PAYMENT_OBLIGATION_CONFLICT');
   const review=checkedReview((await tx.get(adminDb.doc('freelanceFinancialReviewsV1/'+d.id))).data(),obligation);
   const restricted=projection.state==='disputed'&&review?.status!=='resolved_administratively';
   await assertFinancialCaseRestrictions(tx,obligation,restricted);
   if(!due&&review)throw Error('FREELANCE_FINANCIAL_REVIEW_CONFLICT');
   if(review?.status==='pending'&&projection.state!=='disputed')throw Error('FREELANCE_FINANCIAL_REVIEW_CONFLICT');
   if(review?.status==='resolved_voluntarily'&&projection.state!=='bilaterally_reported_received')throw Error('FREELANCE_FINANCIAL_REVIEW_CONFLICT');
   const financialState=!due?'not_due':review?.status==='resolved_administratively'&&projection.state==='disputed'?'administratively_closed_unverified':projection.state;
   entries.push({offerId:d.id,title:offer.title,amountMinor:obligation.terms.amountMinor,serviceCompleted:offer.status==='completed',
    timing:obligation.terms.timing,financialState,restrictionActive:restricted,reviewStatus:review?.status??null,
    lastStatementAt:events.at(-1)?.recordedAt??null,bankVerified:false as const});
  }
  return {role:perspective,currency:'BRL',entries,nextCursor:docs.size>20?page[page.length-1].id:null,otherMethods,operationalReview,bankVerifiedMinor:null};
 },{readOnly:true});
}
