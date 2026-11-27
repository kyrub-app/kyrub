import {adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {validFreelanceId,type FreelanceOffer,type FreelanceApplication} from '../../shared/freelanceLifecycle.js';
import {sameFreelanceWorkTerms,readFreelanceWorkTerms} from '../../shared/freelanceWorkTerms.js';
import {createFreelanceScheduleProposal,readFreelanceScheduleProposal,decideFreelanceScheduleProposal} from '../../shared/freelanceAttendanceSchedule.js';
import type {Transaction} from 'firebase-admin/firestore';

const fail=():never=>{throw Error('FREELANCE_ATTENDANCE_CONFLICT');};
function assertLocal(){
 if(process.env.VERCEL||process.env.VERCEL_ENV||process.env.FIREBASE_SERVICE_ACCOUNT_JSON||process.env.GOOGLE_APPLICATION_CREDENTIALS||
 process.env.KYRUB_FREELANCE_LOCAL_HOMOLOGATION!=='true'||! /^(127\.0\.0\.1|localhost):8088$/.test(process.env.FIRESTORE_EMULATOR_HOST??'')||
 getFirebaseAdminProjectId()!=='kyrub-security-test')throw Error('FREELANCE_FORBIDDEN');
}
export async function readAttendanceContext(tx:Transaction,uid:string,offerId:string){
 assertLocal();if(!validFreelanceId(uid)||!validFreelanceId(offerId))throw Error('FREELANCE_INVALID');
 const ref=adminDb.doc('freelanceOffersV1/'+offerId);
 const offer=(await tx.get(ref)).data() as FreelanceOffer|undefined;
 if(!offer||offer.id!==offerId||!validFreelanceId(offer.ownerUid)||!validFreelanceId(offer.selectedApplicantUid)||
 (uid!==offer.ownerUid&&uid!==offer.selectedApplicantUid))throw Error('FREELANCE_FORBIDDEN');
 const application=(await tx.get(ref.collection('applications').doc(offer.selectedApplicantUid))).data() as FreelanceApplication|undefined;
 if(!application||application.offerId!==offerId||application.ownerUid!==offer.ownerUid||application.applicantUid!==offer.selectedApplicantUid||
 application.status!==offer.status||!offer.contractedAt||offer.contractedAt!==application.contractedAt||!Number.isFinite(Date.parse(offer.contractedAt)))return fail();
 const terms=readFreelanceWorkTerms(offer.workTerms,offer.paymentMinor);
 if(!sameFreelanceWorkTerms(offer.workTerms,application.workTerms,offer.paymentMinor))return fail();
 const actor:'requester'|'worker'=uid===offer.ownerUid?'requester':'worker';
 const pointer=ref.collection('attendance').doc('schedule');
 const raw=(await tx.get(pointer)).data();
 let current=null;
 if(raw){
  if(Object.keys(raw).length!==1||!validFreelanceId(raw.proposalId))return fail();
  current=readFreelanceScheduleProposal((await tx.get(ref.collection('attendance').doc('schedule-'+raw.proposalId))).data());
  if(current.id!==raw.proposalId||!terms||current.schedule.location!==terms.location||current.schedule.agreedMinutes!==terms.estimatedMinutes||Date.parse(current.proposedAt)<Date.parse(offer.contractedAt))return fail();
 }
 return {ref,pointer,offer,terms,actor,current};
}
export async function readFreelanceAttendanceSchedule(uid:string,offerId:string){
 return adminDb.runTransaction(async tx=>{
  const c=await readAttendanceContext(tx,uid,offerId);
  return {actor:c.actor,eligible:c.offer.status==='contracted'&&!!c.terms,schedule:c.current,executionIntegrated:true};
 },{readOnly:true});
}
export async function changeFreelanceAttendanceSchedule(uid:string,offerId:string,action:'propose'|'accept'|'decline'|'withdraw',input:{proposalId:unknown;scheduledStartAt?:unknown;confirmed:unknown}){
 if(input.confirmed!==true||!validFreelanceId(input.proposalId))throw Error('FREELANCE_INVALID');
 const proposalId=input.proposalId;
 return adminDb.runTransaction(async tx=>{
  const c=await readAttendanceContext(tx,uid,offerId);
  if(!c.terms||c.offer.status!=='contracted'||c.offer.startedAt)return fail();
  const record=c.ref.collection('attendance').doc('schedule-'+proposalId),now=new Date().toISOString();
  if(action==='propose'){
   if(c.current?.id===proposalId){
    if(c.current.proposedBy===c.actor&&c.current.schedule.scheduledStartAt===input.scheduledStartAt&&c.current.status==='pending')return c.current;
    return fail();
   }
   if(c.current&&(c.current.status==='pending'||c.current.status==='accepted'))return fail();
   if((await tx.get(record)).exists)return fail();
   const proposal=createFreelanceScheduleProposal({id:proposalId,scheduledStartAt:input.scheduledStartAt,location:c.terms.location,agreedMinutes:c.terms.estimatedMinutes,actor:c.actor,now});
   tx.create(record,proposal);tx.set(c.pointer,{proposalId});return proposal;
  }
  if(!c.current||c.current.id!==proposalId)return fail();
  const decision=action==='accept'?'accepted':action==='decline'?'declined':'withdrawn';
  const next=decideFreelanceScheduleProposal(c.current,c.actor,decision,now);
  if(next.status!==c.current.status)tx.update(record,{status:next.status,decidedAt:next.decidedAt!,decidedBy:next.decidedBy!});
  return next;
 });
}
