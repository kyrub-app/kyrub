import {FieldPath} from 'firebase-admin/firestore';
import {adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {requireKyrubSessionMfa} from '../identity/kyrubMfaAuthorization.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import {readFinancialContext,checkedReview} from '../freelance/freelanceExternalPaymentStatementService.js';
import {assertFinancialCaseRestrictions} from '../freelance/freelanceEngagementRestrictionService.js';

export function financialReviewAdminEnabled(){
 return process.env.KYRUB_FREELANCE_LOCAL_HOMOLOGATION==='true'&&process.env.KYRUB_PERSONAL_FINANCE_LOCAL_HOMOLOGATION==='true'&&
 !process.env.VERCEL&&!process.env.VERCEL_ENV&&!process.env.FIREBASE_SERVICE_ACCOUNT_JSON&&!process.env.GOOGLE_APPLICATION_CREDENTIALS&&
 process.env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8088'&&process.env.FIREBASE_AUTH_EMULATOR_HOST==='127.0.0.1:9099'&&
 getFirebaseAdminProjectId()==='kyrub-security-test';
}
/** Distinct from operational review. Read-only candidate; no release or payment authority. */
export async function listFreelanceFinancialReviews(authorization:string,cursor:unknown){
 if(!financialReviewAdminEnabled())throw Error('FREELANCE_FINANCIAL_REVIEW_DISABLED');
 if(cursor!==undefined&&cursor!==''&&!validFreelanceId(cursor))throw Error('FREELANCE_INVALID');
 const identity=await requireKyrubSessionMfa(authorization,'administrative',300);
 const uid=identity.uid;
 if(identity.email_verified!==true||!validFreelanceId(uid))throw Error('FORBIDDEN');
 return adminDb.runTransaction(async tx=>{
  const role=(await tx.get(adminDb.doc('kyrub_admin/control_plane/admins/'+uid))).data();
  if(!role||role.uid!==uid||role.role!=='super_admin'||role.status!=='active')throw Error('FORBIDDEN');
  let query=adminDb.collection('freelanceFinancialReviewsV1').where('status','==','pending').orderBy(FieldPath.documentId()).limit(21);
  if(typeof cursor==='string'&&cursor)query=query.startAfter(cursor);
  const result=await tx.get(query),page=result.docs.slice(0,20);
  const items=[];
  for(const doc of page){
   const raw=doc.data();
   if(raw.offerId!==doc.id||!validFreelanceId(raw.requesterUid)||!validFreelanceId(raw.beneficiaryUid))throw Error('FREELANCE_FINANCIAL_REVIEW_CONFLICT');
   // Conflict of interest: don't expose the admin's own case via this workspace.
   if(raw.requesterUid===uid||raw.beneficiaryUid===uid)continue;
   const {offer,obligation,events,projection}=await readFinancialContext(tx,raw.requesterUid,doc.id);
   const review=checkedReview(raw,obligation);
   if(!review||review.status!=='pending'||projection.state!=='disputed'||
      Date.parse(review.requestedAt)<Date.parse(events[events.length-1].recordedAt))throw Error('FREELANCE_FINANCIAL_REVIEW_CONFLICT');
   await assertFinancialCaseRestrictions(tx,obligation);
   if(typeof offer.title!=='string'||!offer.title.trim()||offer.title.length>120)throw Error('FREELANCE_FINANCIAL_REVIEW_CONFLICT');
   items.push({offerId:offer.id,title:offer.title,amountMinor:obligation.terms.amountMinor,currency:'BRL',timing:obligation.terms.timing,
    requestedAt:review.requestedAt,requestedByRole:review.requestedBy===obligation.requesterUid?'requester':'freelancer',
    requesterUid:obligation.requesterUid,beneficiaryUid:obligation.beneficiaryUid,
    statements:events.map(e=>({role:e.actorUid===obligation.requesterUid?'requester':'freelancer',statement:e.statement,recordedAt:e.recordedAt})),
    restrictionActive:true,bankVerified:false,settlementEvidence:'participant_statements_only'});
  }
  return {items,nextCursor:result.size>20?page[page.length-1].id:null};
 },{readOnly:true});
}
