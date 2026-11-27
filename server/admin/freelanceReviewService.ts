import {createHash} from 'node:crypto';
import {FieldValue} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
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
    if(!result.changed){
      if(!audit.exists||audit.get('actorId')!==uid||audit.get('targetId')!==b.offerId||audit.get('occurrenceId')!==b.occurrenceId)throw Error('FREELANCE_CONFLICT');
      return {decision:result.occurrence.decision,replay:true};
    }
    if(audit.exists)throw Error('FREELANCE_CONFLICT');
    const decision=result.occurrence.decision!;
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
