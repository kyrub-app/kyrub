import {FieldPath} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {requireKyrubSessionMfa} from '../identity/kyrubMfaAuthorization.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import {assertFreelanceReputationLocal,readFreelanceReputationContext,contestationContext} from '../freelance/freelanceReputationService.js';
const fail=():never=>{throw Error('FREELANCE_REPUTATION_CONFLICT');};
/** Read-only administrative queue, no adjudication or scoring authority. */
export async function listFreelanceReputationContests(authorization:string,cursor?:unknown){
 assertFreelanceReputationLocal();
 if(cursor!==undefined&&cursor!==''&&(typeof cursor!=='string'||!/^[a-f0-9]{64}$/.test(cursor)))throw Error('FREELANCE_INVALID');
 const identity=await requireKyrubSessionMfa(authorization,'administrative',300),uid=identity.uid;
 if(identity.email_verified!==true||!validFreelanceId(uid))throw Error('FORBIDDEN');
 return adminDb.runTransaction(async tx=>{
  const role=(await tx.get(adminDb.doc('kyrub_admin/control_plane/admins/'+uid))).data();
  if(!role||role.uid!==uid||role.role!=='super_admin'||role.status!=='active')throw Error('FORBIDDEN');
  let query=adminDb.collection('freelanceReputationContestsV1').where('status','==','pending').orderBy(FieldPath.documentId()).limit(21);
  if(typeof cursor==='string'&&cursor)query=query.startAfter(cursor);
  const result=await tx.get(query),page=result.docs.slice(0,20),items=[];
  for(const doc of page){
   const raw=doc.data();
   if(!validFreelanceId(raw.offerId)||!validFreelanceId(raw.challengerUid))return fail();
   const x=await readFreelanceReputationContext(tx,raw.challengerUid,raw.offerId);
   if([x.parties.requesterUid,x.parties.workerUid].includes(uid))continue;
   const q=await contestationContext(tx,x);
   if(!q.raw||!q.rating||!q.own||q.ref.id!==doc.id)return fail();
   items.push({caseId:doc.id,offerId:x.parties.offerId,subjectKind:q.rating.subject.kind,ratingRole:q.other,
    stars:q.rating.stars,submittedAt:q.rating.submittedAt,requestedAt:q.raw.requestedAt,reason:q.raw.reason,
    ratingDigest:q.raw.ratingDigest,status:q.raw.status});
  }
  return {items,nextCursor:result.size>20?page.at(-1)!.id:null,readOnly:true as const};
 },{readOnly:true});
}
