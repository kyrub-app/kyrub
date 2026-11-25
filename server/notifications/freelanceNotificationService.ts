import {createHash} from 'node:crypto';
import {FieldValue} from 'firebase-admin/firestore';
import {adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {buildUserNotification,userNotificationPath} from '../../shared/userNotifications.js';

export function freelanceNotificationPreviewEnabled(){
 return process.env.KYRUB_FREELANCE_NOTIFICATION_PREVIEW==='true'
  && /^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST??'')
  && /^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST??'')
  && getFirebaseAdminProjectId()==='kyrub-security-test'
  && !process.env.VERCEL;
}
const uidValid=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);

/** Atomic message and bell alert. This preview deliberately never connects to live Firebase. */
export async function sendNotifiedHiringMessage(input:{actorId:string;applicationId:string;messageId:string;text:unknown}){
 if(!freelanceNotificationPreviewEnabled())throw Error('FREELANCE_PREVIEW_UNAVAILABLE');
 const {actorId,applicationId,messageId}=input;
 const text=typeof input.text==='string'?input.text.trim():'';
 if(!uidValid(actorId)||!uidValid(messageId)||!/^[A-Za-z0-9]{20}__[A-Za-z0-9_-]{1,128}$/.test(applicationId)||!text||text.length>4000)throw Error('FREELANCE_INVALID');
 const receipt=adminDb.doc('candidaturas/'+applicationId);
 const message=receipt.collection('messages').doc(messageId);
 return adminDb.runTransaction(async tx=>{
  const [app,previous,control,age,identity]=await tx.getAll(receipt,message,adminDb.doc('renda_age_release_private/current'),adminDb.doc('age_eligibility_private/'+actorId),adminDb.doc('identity_verifications/'+actorId));
  const data=app.data();
  if(!data||!uidValid(data.ownerId)||!uidValid(data.userId)||data.ownerId===data.userId||applicationId!==data.vagaId+'__'+data.userId||![data.ownerId,data.userId].includes(actorId))throw Error('FREELANCE_FORBIDDEN');
  const receiverId=actorId===data.ownerId?data.userId:data.ownerId;
  const sourceId=createHash('sha256').update(applicationId+'\n'+messageId).digest('hex');
  const notice=buildUserNotification({recipientUserId:receiverId,category:'freelance',eventType:'message_received',sourceId,actorPrincipalId:actorId,title:'Nova mensagem de Freela',body:'Abra a negociação para consultar a mensagem.',target:{kind:'freelance',hiringApplicationId:applicationId},createdAt:new Date().toISOString()});
  const noticeRef=adminDb.doc(userNotificationPath(receiverId,notice.id));
  const noticeSnap=await tx.get(noticeRef);
  if(previous.exists){
   if(previous.get('senderId')!==actorId||previous.get('receiverId')!==receiverId||previous.get('text')!==text||!noticeSnap.exists)throw Error('FREELANCE_CONFLICT');
   return {messageId,created:false};
  }
  if(noticeSnap.exists)throw Error('FREELANCE_CONFLICT');
  // For the isolated server path require both authoritative checks explicitly.
  if(!control.exists||control.get('schemaVersion')!==1||control.get('mode')!=='verified_adult_only'||age.get('uid')!==actorId||age.get('status')!=='verified_adult'||identity.get('uid')!==actorId||identity.get('status')!=='approved'||!Array.isArray(identity.get('approvedProfiles'))||!identity.get('approvedProfiles').includes(actorId===data.ownerId?'requester':'freelancer')||!['pending','accepted','completion_requested'].includes(data.status))throw Error('FREELANCE_FORBIDDEN');
  tx.create(message,{senderId:actorId,receiverId,text,createdAt:FieldValue.serverTimestamp()});
  tx.create(noticeRef,notice);
  return {messageId,created:true};
 });
}
