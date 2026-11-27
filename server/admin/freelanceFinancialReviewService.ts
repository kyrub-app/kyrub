import {createHash} from 'node:crypto';
import {FieldPath,FieldValue} from 'firebase-admin/firestore';
import {adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {requireKyrubSessionMfa} from '../identity/kyrubMfaAuthorization.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import {readFinancialContext,checkedReview,isFinancialReviewOutcome,type FinancialReviewDecision} from '../freelance/freelanceExternalPaymentStatementService.js';
import {readFinancialReceiptManifest,readFinancialReceiptBytes} from '../freelance/freelanceFinancialReceiptService.js';
import {writeFreelanceFinancialNotices} from '../freelance/freelanceFinancialNoticeService.js';
import {readFinancialEvidence} from '../freelance/freelanceFinancialEvidenceService.js';
import {assertFinancialCaseRestrictions,prepareAdministrativeDisputeRelease} from '../freelance/freelanceEngagementRestrictionService.js';

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
   const evidence=await readFinancialEvidence(tx,obligation,review.requestedAt);
   const attachments=await readFinancialReceiptManifest(tx,obligation,review.requestedAt);
   items.push({evidenceRevision:evidence.revision+attachments.revision,receipts:attachments.receipts.map(r=>({id:r.id,role:r.actorUid===obligation.requesterUid?'requester':'freelancer',recordedAt:r.recordedAt,size:r.size,mimeType:'image/png'})),evidenceNotes:evidence.notes.map(n=>({role:n.actorUid===obligation.requesterUid?'requester':'freelancer',note:n.note,recordedAt:n.recordedAt})),offerId:offer.id,title:offer.title,amountMinor:obligation.terms.amountMinor,currency:'BRL',timing:obligation.terms.timing,
    requestedAt:review.requestedAt,requestedByRole:review.requestedBy===obligation.requesterUid?'requester':'freelancer',
    requesterUid:obligation.requesterUid,beneficiaryUid:obligation.beneficiaryUid,
    statements:events.map(e=>({role:e.actorUid===obligation.requesterUid?'requester':'freelancer',statement:e.statement,recordedAt:e.recordedAt})),
    restrictionActive:true,bankVerified:false,settlementEvidence:'participant_statements_only'});
  }
  return {items,nextCursor:result.size>20?page[page.length-1].id:null};
 },{readOnly:true});
}

/** An administrative disposition is not a payment, a bank verification, or a debt waiver. */
export async function decideFreelanceFinancialReview(authorization:string,input:unknown){
 if(!financialReviewAdminEnabled())throw Error('FREELANCE_FINANCIAL_REVIEW_DISABLED');
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('FREELANCE_INVALID');
 const b=input as Record<string,unknown>;
 if(Object.keys(b).length!==6||Object.keys(b).some(k=>!['offerId','expectedRequestedAt','expectedEvidenceRevision','outcome','reason','confirmed'].includes(k))||
 !Number.isSafeInteger(b.expectedEvidenceRevision)||Number(b.expectedEvidenceRevision)<0||Number(b.expectedEvidenceRevision)>6||
 !validFreelanceId(b.offerId)||typeof b.expectedRequestedAt!=='string'||!Number.isFinite(Date.parse(b.expectedRequestedAt))||
 !isFinancialReviewOutcome(b.outcome)||typeof b.reason!=='string'||b.reason.trim().length<10||b.reason.trim().length>1000||b.confirmed!==true)throw Error('FREELANCE_INVALID');
 const offerId=b.offerId,reason=b.reason.trim(),outcome=b.outcome;
 const identity=await requireKyrubSessionMfa(authorization,'administrative',300),uid=identity.uid;
 if(identity.email_verified!==true||!validFreelanceId(uid))throw Error('FORBIDDEN');
 const ref=adminDb.doc('freelanceFinancialReviewsV1/'+offerId);
 const auditId='freelance_financial_review_'+createHash('sha256').update(offerId).digest('hex');
 const auditRef=adminDb.doc('kyrub_admin/control_plane/audit_logs/'+auditId);
 return adminDb.runTransaction(async tx=>{
  const [roleDoc,entry,audit]=await tx.getAll(adminDb.doc('kyrub_admin/control_plane/admins/'+uid),ref,auditRef);
  const role=roleDoc.data(),raw=entry.data();
  if(!role||role.uid!==uid||role.role!=='super_admin'||role.status!=='active')throw Error('FORBIDDEN');
  if(!raw||raw.offerId!==offerId||!validFreelanceId(raw.requesterUid)||!validFreelanceId(raw.beneficiaryUid))throw Error('FREELANCE_FINANCIAL_REVIEW_CONFLICT');
  if([raw.requesterUid,raw.beneficiaryUid].includes(uid))throw Error('FORBIDDEN');
  const {obligation,events,projection}=await readFinancialContext(tx,raw.requesterUid,offerId);
  const review=checkedReview(raw,obligation);
  if(!review||review.requestedAt!==b.expectedRequestedAt)throw Error('FREELANCE_FINANCIAL_REVIEW_CONFLICT');
  const evidence=await readFinancialEvidence(tx,obligation,review.requestedAt);
  const evidenceRevision=evidence.revision+(await readFinancialReceiptManifest(tx,obligation,review.requestedAt)).revision;
  if(evidenceRevision!==b.expectedEvidenceRevision)throw Error('FREELANCE_FINANCIAL_REVIEW_CONFLICT');
  const digest=createHash('sha256').update(reason).digest('hex');
  if(review.status==='resolved_administratively'){
   const d=review.decision!;
   if(d.actorUid!==uid||d.outcome!==outcome||d.reason!==reason||d.evidenceRevision!==evidenceRevision||!audit.exists||
    audit.get('actorId')!==uid||audit.get('targetId')!==offerId||audit.get('outcome')!==outcome||audit.get('reasonHash')!==digest||audit.get('evidenceRevision')!==evidenceRevision)
    throw Error('FREELANCE_FINANCIAL_REVIEW_CONFLICT');
   await assertFinancialCaseRestrictions(tx,obligation,false);
   return {status:review.status,outcome,replay:true,bankVerified:false as const};
  }
  if(review.status!=='pending'||projection.state!=='disputed'||audit.exists||
   Date.parse(review.requestedAt)<Date.parse(events[events.length-1].recordedAt))throw Error('FREELANCE_FINANCIAL_REVIEW_CONFLICT');
  const decidedAt=new Date().toISOString();
  if(Date.parse(decidedAt)<Date.parse(review.requestedAt))throw Error('FREELANCE_FINANCIAL_REVIEW_CONFLICT');
  const release=await prepareAdministrativeDisputeRelease(tx,obligation);
  const decision:FinancialReviewDecision={actorUid:uid,outcome,reason,decidedAt,bankVerified:false,evidenceRevision};
  tx.update(ref,{status:'resolved_administratively',resolvedAt:decidedAt,decision});
  tx.create(auditRef,{id:auditId,action:'admin.freelance.financial_review_resolved',actorId:uid,actorRole:'super_admin',
   targetType:'freelance_financial_review',targetId:offerId,outcome,reasonHash:digest,evidenceRevision,bankVerified:false,source:'server',createdAt:FieldValue.serverTimestamp()});
  release();
  writeFreelanceFinancialNotices(tx,obligation,'administrative_release',decidedAt);
  return {status:'resolved_administratively' as const,outcome,replay:false,bankVerified:false as const};
 });
}

/** No anonymous links, only scoped admin read while the review is pending. */
export async function getFreelanceFinancialReceipt(authorization:string,offerId:unknown,receiptId:unknown){
 if(!financialReviewAdminEnabled())throw Error('FREELANCE_FINANCIAL_REVIEW_DISABLED');
 if(!validFreelanceId(offerId)||!validFreelanceId(receiptId))throw Error('FREELANCE_INVALID');
 const identity=await requireKyrubSessionMfa(authorization,'administrative',300),uid=identity.uid;
 if(identity.email_verified!==true||!validFreelanceId(uid))throw Error('FORBIDDEN');
 return adminDb.runTransaction(async tx=>{
  const [role,queue]=await tx.getAll(adminDb.doc('kyrub_admin/control_plane/admins/'+uid),adminDb.doc('freelanceFinancialReviewsV1/'+offerId));
  if(role.get('uid')!==uid||role.get('role')!=='super_admin'||role.get('status')!=='active')throw Error('FORBIDDEN');
  const raw=queue.data();
  if(!raw||raw.offerId!==offerId||!validFreelanceId(raw.requesterUid)||!validFreelanceId(raw.beneficiaryUid)||
   [raw.requesterUid,raw.beneficiaryUid].includes(uid))throw Error('FORBIDDEN');
  const {obligation,projection}=await readFinancialContext(tx,raw.requesterUid,offerId);
  const review=checkedReview(raw,obligation);
  if(!review||review.status!=='pending'||projection.state!=='disputed')throw Error('FREELANCE_FINANCIAL_REVIEW_CONFLICT');
  await assertFinancialCaseRestrictions(tx,obligation);
  return readFinancialReceiptBytes(tx,obligation,review.requestedAt,receiptId);
 },{readOnly:true});
}
