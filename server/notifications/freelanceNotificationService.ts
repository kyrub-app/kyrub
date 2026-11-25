import {createHash} from 'node:crypto';
import {parseHiringTerms,termsFromVacancy,sameHiringTerms} from '../../shared/freelanceHiringTerms.js';
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
export async function sendNotifiedHiringMessage(input:{actorId:string;actorRole:unknown;applicationId:string;messageId:string;text:unknown}){
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
  if(actorId===data.ownerId&&!['owner','manager','staff','admin'].includes(String(input.actorRole)))throw Error('FREELANCE_FORBIDDEN');
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
  if(!control.exists||control.get('schemaVersion')!==1||control.get('mode')!=='verified_adult_only'||control.get('messageAuthority')!=='server'||age.get('uid')!==actorId||age.get('status')!=='verified_adult'||identity.get('uid')!==actorId||identity.get('status')!=='approved'||!Array.isArray(identity.get('approvedProfiles'))||!identity.get('approvedProfiles').includes(actorId===data.ownerId?'requester':'freelancer')||!['pending','accepted','completion_requested'].includes(data.status))throw Error('FREELANCE_FORBIDDEN');
  tx.create(message,{senderId:actorId,receiverId,text,createdAt:FieldValue.serverTimestamp()});
  tx.create(noticeRef,notice);
  return {messageId,created:true};
 });
}


const lifecycleEvents = {
 apply:{from:'absent',to:'pending',side:'worker',title:'Nova candidatura'},
 accept:{from:'pending',to:'accepted',side:'owner',title:'Candidatura aceita'},
 reject:{from:'pending',to:'rejected',side:'owner',title:'Candidatura recusada'},
 withdraw:{from:'pending',to:'withdrawn',side:'worker',title:'Candidatura retirada'},
 request_completion:{from:'accepted',to:'completion_requested',side:'worker',title:'Conclusão informada'},
 request_review:{from:'completion_requested',to:'accepted',side:'owner',title:'Revisão solicitada'},
 complete:{from:'completion_requested',to:'completed',side:'owner',title:'Serviço concluído'},
} as const;
type HiringAction=keyof typeof lifecycleEvents;

export async function performNotifiedHiringAction(input:{actorId:string;actorRole:unknown;applicationId:string;operationId:string;action:unknown;expectedTerms?:unknown}){
 if(!freelanceNotificationPreviewEnabled())throw Error('FREELANCE_PREVIEW_UNAVAILABLE');
 const {actorId,applicationId,operationId}=input;
 if(!uidValid(actorId)||!uidValid(operationId)||!/^[A-Za-z0-9]{20}__[A-Za-z0-9_-]{1,128}$/.test(applicationId)||typeof input.action!=='string'||!Object.prototype.hasOwnProperty.call(lifecycleEvents,input.action))throw Error('FREELANCE_INVALID');
 const action=input.action as HiringAction;
 const event=lifecycleEvents[action];
 const expectedTerms=parseHiringTerms(input.expectedTerms);
 if((action==='apply'||action==='accept')&&!expectedTerms)throw Error('FREELANCE_INVALID');
 const vagaId=applicationId.slice(0,20),workerId=applicationId.slice(22);
 const receipt=adminDb.doc('candidaturas/'+applicationId);
 const operation=receipt.collection('operations_private').doc(operationId);
 return adminDb.runTransaction(async tx=>{
  const [app,previous,vacancy,control,age,identity]=await tx.getAll(receipt,operation,adminDb.doc('vagas/'+vagaId),adminDb.doc('renda_age_release_private/current'),adminDb.doc('age_eligibility_private/'+actorId),adminDb.doc('identity_verifications/'+actorId));
  if(!control.exists||control.get('schemaVersion')!==1||control.get('mode')!=='verified_adult_only'||control.get('applicationAuthority')!=='server')throw Error('FREELANCE_PREVIEW_UNAVAILABLE');
  const ownerId=app.exists?app.get('ownerId'):vacancy.get('ownerId');
  if(!uidValid(ownerId)||ownerId===workerId||actorId!==(event.side==='worker'?workerId:ownerId)||(app.exists&&(app.get('vagaId')!==vagaId||app.get('userId')!==workerId)))throw Error('FREELANCE_FORBIDDEN');
  const receiverId=actorId===ownerId?workerId:ownerId;
  const sourceId=createHash('sha256').update(applicationId+'\n'+operationId).digest('hex');
  const notice=buildUserNotification({recipientUserId:receiverId,category:'freelance',eventType:action,sourceId,actorPrincipalId:actorId,title:event.title,body:'Abra a contratação para consultar a situação. Nenhum pagamento é confirmado pelo Kyrub.',target:{kind:'freelance',hiringApplicationId:applicationId},createdAt:new Date().toISOString()});
  const noticeRef=adminDb.doc(userNotificationPath(receiverId,notice.id));
  const noticeSnap=await tx.get(noticeRef);
  if(previous.exists){
   if(previous.get('actorId')!==actorId||previous.get('action')!==action||previous.get('status')!==event.to||!noticeSnap.exists||((action==='apply'||action==='accept')&&!sameHiringTerms(parseHiringTerms(previous.get('terms')),expectedTerms)))throw Error('FREELANCE_CONFLICT');
   return {applicationId,operationId,status:event.to,created:false};
  }
  if(noticeSnap.exists)throw Error('FREELANCE_CONFLICT');
  // Withdrawing a pending application is a protective action, even after suspension.
  if(action!=='withdraw'&&(age.get('uid')!==actorId||age.get('status')!=='verified_adult'||identity.get('uid')!==actorId||identity.get('status')!=='approved'||!Array.isArray(identity.get('approvedProfiles'))||!identity.get('approvedProfiles').includes(event.side==='owner'?'requester':'freelancer')||(event.side==='owner'&&!['owner','manager','staff','admin'].includes(String(input.actorRole)))))throw Error('FREELANCE_FORBIDDEN');
  if(action==='apply'){
   if(app.exists||!vacancy.exists||vacancy.get('status')!=='open')throw Error('FREELANCE_CONFLICT');
   const terms=termsFromVacancy(vacancy.data());
   if(!sameHiringTerms(terms,expectedTerms))throw Error('FREELANCE_CONFLICT');
   tx.create(receipt,{vagaId,ownerId,userId:workerId,status:'pending',terms,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
  }else{
   if(!app.exists||app.get('status')!==event.from)throw Error('FREELANCE_CONFLICT');
   if(action==='accept'&&!sameHiringTerms(parseHiringTerms(app.get('terms')),expectedTerms))throw Error('FREELANCE_CONFLICT');
   tx.update(receipt,{status:event.to,updatedAt:FieldValue.serverTimestamp(),...(action==='accept'?{acceptedAt:FieldValue.serverTimestamp()}: {})});
  }
  tx.create(operation,{actorId,action,status:event.to,...((action==='apply'||action==='accept')?{terms:expectedTerms}:{}),createdAt:FieldValue.serverTimestamp()});
  tx.create(noticeRef,notice);
  return {applicationId,operationId,status:event.to,created:true};
 });
}
