import {prepareHourlyCancellation} from '../freelance/freelanceHourlyCancellationService.js';
import {prepareFreelanceAttendanceReview} from '../freelance/freelanceAttendanceService.js';
import {createHash} from 'node:crypto';
import {FieldPath,FieldValue} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {buildFreelanceRemunerationBasis,matchesFreelanceRemunerationBasis} from '../../shared/freelanceRemuneration.js';
import {requireKyrubSessionMfa} from '../identity/kyrubMfaAuthorization.js';
import {resolveFreelanceOccurrence,validFreelanceId,type FreelanceOffer,type FreelanceApplication,type FreelanceOccurrence} from '../../shared/freelanceLifecycle.js';

const rolePath=(uid:string)=>'kyrub_admin/control_plane/admins/'+uid;
function assertRole(uid:string,role:FirebaseFirestore.DocumentData|undefined){
  if(!role||role.uid!==uid||role.role!=='super_admin'||role.status!=='active')throw Error('FORBIDDEN');
}
/** Service-only: no deployed endpoint. Reuse the existing Control Plane role and MFA. */
export async function decideFreelanceReview(authorization:string,input:unknown){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('FREELANCE_INVALID');
  const b=input as Record<string,unknown>;
  if(Object.keys(b).some(k=>!['offerId','occurrenceId','outcome','reason','confirmed'].includes(k))||
     !validFreelanceId(b.offerId)||!validFreelanceId(b.occurrenceId)||b.confirmed!==true)throw Error('FREELANCE_INVALID');
  const identity=await requireKyrubSessionMfa(authorization,'administrative',300);
  const uid=identity.uid;
  if(identity.email_verified!==true||!validFreelanceId(uid))throw Error('FORBIDDEN');
  const roleRef=adminDb.doc(rolePath(uid));
  const offerRef=adminDb.doc('freelanceOffersV1/'+b.offerId);
  const occurrenceRef=offerRef.collection('occurrences').doc(b.occurrenceId);
  const auditId='freelance_review_'+createHash('sha256').update(JSON.stringify([b.offerId,b.occurrenceId])).digest('hex');
  const auditRef=adminDb.doc('kyrub_admin/control_plane/audit_logs/'+auditId);
  return adminDb.runTransaction(async tx=>{
    const role=await tx.get(roleRef);assertRole(uid,role.data());
    const [o,r,audit]=await tx.getAll(offerRef,occurrenceRef,auditRef);
    const offer=o.data() as FreelanceOffer|undefined;
    const occurrence=r.data() as FreelanceOccurrence|undefined;
    if(!offer||!occurrence||offer.id!==b.offerId||occurrence.id!==b.occurrenceId||
       !validFreelanceId(offer.selectedApplicantUid))throw Error('FREELANCE_CONFLICT');
    const applicationRef=offerRef.collection('applications').doc(offer.selectedApplicantUid);
    const application=(await tx.get(applicationRef)).data() as FreelanceApplication|undefined;
    if(!application||application.applicantUid!==offer.selectedApplicantUid)throw Error('FREELANCE_CONFLICT');
    const result=resolveFreelanceOccurrence(offer,application,occurrence,uid,b.outcome,b.reason,b.confirmed,new Date().toISOString());
    if(result.occurrence.decision?.outcome==='cancel'&&offer.workTerms?.mode==='hourly'){
      if(result.changed&&audit.exists)throw Error('FREELANCE_FINANCIAL_BASIS_CONFLICT');
      const writeCancellation=await prepareHourlyCancellation(tx,offer.ownerUid,offer.id,result);writeCancellation();
    }else if(result.occurrence.decision?.outcome==='cancel'){
      const basis=buildFreelanceRemunerationBasis(result.offer,result.application,result.occurrence);
      const basisRef=offerRef.collection('financialBasis').doc('remuneration');
      const saved=await tx.get(basisRef);
      if(result.changed){
        if(saved.exists||audit.exists)throw Error('FREELANCE_FINANCIAL_BASIS_CONFLICT');
        tx.create(basisRef,basis);
      }else if(!matchesFreelanceRemunerationBasis(saved.data(),basis))throw Error('FREELANCE_FINANCIAL_BASIS_CONFLICT');
    }
    if(!result.changed){
      if(!audit.exists||audit.get('actorId')!==uid||audit.get('targetId')!==b.offerId||audit.get('occurrenceId')!==b.occurrenceId)throw Error('FREELANCE_CONFLICT');
      return {decision:result.occurrence.decision,replay:true};
    }
    if(audit.exists)throw Error('FREELANCE_CONFLICT');
    const decision=result.occurrence.decision!;
    const writeAttendance=offer.workTerms&&decision.outcome==='resume'?await prepareFreelanceAttendanceReview(tx,offer.ownerUid,offer.id,occurrence.id,'resume_review',decision.decidedAt):()=>{};
    writeAttendance();
    const patch={status:result.offer.status,occurrenceId:FieldValue.delete(),...(decision.outcome==='cancel'?{cancelledAt:decision.decidedAt}:{})};
    tx.update(offerRef,patch);
    tx.update(applicationRef,patch);
    tx.update(occurrenceRef,{status:'resolved',decision});
    tx.create(auditRef,{id:auditId,action:'admin.freelance.occurrence_resolved',actorId:uid,actorRole:'super_admin',
      targetType:'freelance_offer',targetId:b.offerId,occurrenceId:b.occurrenceId,outcome:decision.outcome,
      financialReview:decision.financialReview,source:'server',createdAt:FieldValue.serverTimestamp()});
    return {decision,replay:false};
  });
}

/** Query the root offers, not arbitrary collection-group occurrences. Bounded cursor pages. */
export async function listFreelanceReviews(authorization:string,cursor:unknown){
  if(cursor!==undefined&&cursor!==''&&!validFreelanceId(cursor))throw Error('FREELANCE_INVALID');
  const identity=await requireKyrubSessionMfa(authorization,'administrative',300);
  const uid=identity.uid;
  if(identity.email_verified!==true||!validFreelanceId(uid))throw Error('FORBIDDEN');
  return adminDb.runTransaction(async tx=>{
    const role=await tx.get(adminDb.doc(rolePath(uid)));assertRole(uid,role.data());
    let query=adminDb.collection('freelanceOffersV1').where('status','==','under_review').orderBy(FieldPath.documentId()).limit(21);
    if(typeof cursor==='string'&&cursor)query=query.startAfter(cursor);
    const result=await tx.get(query);
    const page=result.docs.slice(0,20);
    const items=[];
    for(const doc of page){
      const offer=doc.data() as FreelanceOffer;
      if(offer.id!==doc.id||offer.status!=='under_review'||!validFreelanceId(offer.occurrenceId)||
         !validFreelanceId(offer.ownerUid)||!validFreelanceId(offer.selectedApplicantUid))throw Error('FREELANCE_CONFLICT');
      const occurrence=(await tx.get(doc.ref.collection('occurrences').doc(offer.occurrenceId))).data() as FreelanceOccurrence|undefined;
      if(!occurrence||occurrence.id!==offer.occurrenceId||occurrence.offerId!==doc.id||occurrence.ownerUid!==offer.ownerUid||
        occurrence.applicantUid!==offer.selectedApplicantUid||occurrence.status!=='awaiting_review'||
        (occurrence.openedBy!==offer.ownerUid&&occurrence.openedBy!==offer.selectedApplicantUid))throw Error('FREELANCE_CONFLICT');
      items.push({offerId:doc.id,occurrenceId:occurrence.id,title:offer.title,kind:occurrence.kind,priorStatus:occurrence.priorStatus,
        openedAt:occurrence.openedAt,openedByRole:occurrence.openedBy===offer.ownerUid?'requester':'freelancer',
        response:occurrence.response?.position??null,canResume:occurrence.kind==='service_disputed'&&occurrence.response?.position==='agree',
        canDecide:uid!==offer.ownerUid&&uid!==offer.selectedApplicantUid});
    }
    return {items,nextCursor:result.size>20?page[page.length-1].id:null};
  },{readOnly:true});
}
