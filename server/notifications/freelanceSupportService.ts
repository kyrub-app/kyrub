import {createHash,randomUUID} from 'node:crypto';
import {FieldValue} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {freelanceNotificationPreviewEnabled} from './freelanceNotificationService.js';
import {requireKyrubSessionMfa} from '../identity/kyrubMfaAuthorization.js';
import {buildUserNotification,userNotificationPath} from '../../shared/userNotifications.js';

const validUid=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const validApplication=(value:string)=>/^[A-Za-z0-9]{20}__[A-Za-z0-9_-]{1,128}$/.test(value);
const allowedRoles=['super_admin','operations','support'];
const cases=()=>adminDb.collection('freelance_support_cases_private');
const audit=()=>adminDb.collection('kyrub_admin/control_plane/audit_logs');
function guard(){if(!freelanceNotificationPreviewEnabled())throw Error('FREELANCE_PREVIEW_UNAVAILABLE');}
export async function openFreelanceSupportCase(input:{actorId:string;applicationId:string;requestId:string}){
 guard();
 const {actorId,applicationId,requestId}=input;
 if(!validUid(actorId)||!validUid(requestId)||!validApplication(applicationId))throw Error('FREELANCE_INVALID');
 const caseId=createHash('sha256').update(applicationId+'\n'+requestId).digest('hex');
 const ref=cases().doc(caseId);
 return adminDb.runTransaction(async tx=>{
  const [app,previous,control]=await tx.getAll(adminDb.doc('candidaturas/'+applicationId),ref,adminDb.doc('renda_age_release_private/current'));
  if(control.get('schemaVersion')!==1||control.get('mode')!=='verified_adult_only'||control.get('applicationAuthority')!=='server'||control.get('vacancyPolicy')!=='lock_on_application')throw Error('FREELANCE_PREVIEW_UNAVAILABLE');
  const x=app.data();
  if(!x||!validUid(x.ownerId)||!validUid(x.userId)||x.ownerId===x.userId||applicationId!==x.vagaId+'__'+x.userId||![x.ownerId,x.userId].includes(actorId))throw Error('FREELANCE_FORBIDDEN');
  if(previous.exists){
   if(previous.get('applicationId')!==applicationId||previous.get('requestId')!==requestId)throw Error('FREELANCE_CONFLICT');
   return {caseId,created:false};
  }
  if(!['accepted','completion_requested'].includes(x.status)||x.cancellation?.requestId!==requestId||!['requested','declined'].includes(x.cancellation?.state))throw Error('FREELANCE_CONFLICT');
  // Store a reference, not private chat content, identity documents, or the reason.
  tx.create(ref,{caseId,applicationId,requestId,openedBy:actorId,status:'open',kind:'cancellation_disagreement',createdAt:FieldValue.serverTimestamp()});
  return {caseId,created:true};
 });
}

/** Queue is deliberately read-only. MFA is derived from a verified token,
 * and current administrative authority from the same transaction as the audit.
 * No client-supplied role, money decision or private transcript. */
export async function listFreelanceSupportCases(authorization:string,cursor?:string){
 guard();
 const identity=await requireKyrubSessionMfa(authorization,'administrative',300);
 const profileRef=adminDb.doc('kyrub_admin/control_plane/admins/'+identity.uid);
 return adminDb.runTransaction(async tx=>{
  const profile=await tx.get(profileRef);
  if(profile.get('uid')!==identity.uid||profile.get('status')!=='active'||!allowedRoles.includes(profile.get('role')))throw Error('FREELANCE_FORBIDDEN');
  let query=cases().where('status','==','open').orderBy('createdAt','asc').orderBy('__name__','asc');
  if(cursor){
   if(!/^[a-f0-9]{64}$/.test(cursor))throw Error('FREELANCE_INVALID');
   const last=await tx.get(cases().doc(cursor));
   if(!last.exists||!last.get('createdAt'))throw Error('FREELANCE_INVALID');
   query=query.startAfter(last);
  }
  const snapshot=await tx.get(query.limit(51));
  const items=snapshot.docs.slice(0,50).map(d=>({caseId:d.id,applicationId:d.get('applicationId'),kind:d.get('kind'),status:'open',createdAt:d.get('createdAt')?.toDate().toISOString()??''}));
  const auditId=randomUUID();
  tx.create(audit().doc(auditId),{id:auditId,action:'admin.freelance_support.queue_read',actorId:identity.uid,actorRole:profile.get('role'),targetType:'freelance_support',targetId:'queue',source:'server',caseIds:items.map(x=>x.caseId),createdAt:FieldValue.serverTimestamp()});
  return {items,hasMore:snapshot.size>50,nextCursor:snapshot.size>50?items[items.length-1].caseId:null};
 });
}


/** Administrative closure of the support ticket only. Never changes a
 * hiring status, determines liability, or performs a payment/refund. */
export async function resolveFreelanceSupportCase(authorization:string,input:{caseId:string;outcome:unknown;note:unknown;operationId:string}){
 guard();
 const identity=await requireKyrubSessionMfa(authorization,'administrative',300);
 const {caseId,operationId}=input;
 const outcome=input.outcome;
 const note=typeof input.note==='string'?input.note.trim():'';
 if(!/^[a-f0-9]{64}$/.test(caseId)||!validUid(operationId)||typeof outcome!=='string'||!['guidance_provided','agreement_reported','referred','unresolved'].includes(outcome)||!note||note.length>1000)throw Error('FREELANCE_INVALID');
 const ref=cases().doc(caseId);
 const profileRef=adminDb.doc('kyrub_admin/control_plane/admins/'+identity.uid);
 const auditId=createHash('sha256').update('freelance-support-resolution\n'+caseId+'\n'+operationId).digest('hex');
 const auditRef=audit().doc(auditId);
 return adminDb.runTransaction(async tx=>{
  const [profile,support,previous]=await tx.getAll(profileRef,ref,auditRef);
  if(profile.get('uid')!==identity.uid||profile.get('status')!=='active'||!allowedRoles.includes(profile.get('role')))throw Error('FREELANCE_FORBIDDEN');
  if(!support.exists)throw Error('FREELANCE_CONFLICT');
  if(previous.exists){
   if(previous.get('actorId')!==identity.uid||previous.get('targetId')!==caseId||previous.get('outcome')!==outcome||support.get('resolution.operationId')!==operationId||support.get('resolution.note')!==note)throw Error('FREELANCE_CONFLICT');
   return {caseId,created:false};
  }
  if(support.get('status')!=='open')throw Error('FREELANCE_CONFLICT');
  const applicationId=support.get('applicationId');
  if(typeof applicationId!=='string'||!validApplication(applicationId))throw Error('FREELANCE_CONFLICT');
  const app=await tx.get(adminDb.doc('candidaturas/'+applicationId));
  const x=app.data();
  if(!x||!validUid(x.ownerId)||!validUid(x.userId)||x.ownerId===x.userId||applicationId!==x.vagaId+'__'+x.userId)throw Error('FREELANCE_CONFLICT');
  for(const recipientUserId of [x.ownerId,x.userId]){
   const notice=buildUserNotification({recipientUserId,category:'freelance',eventType:'support_case_closed',sourceId:auditId,actorPrincipalId:identity.uid,title:'Atendimento de Freela encerrado',body:'O atendimento foi encerrado. Isso não altera a contratação nem confirma pagamento, multa ou estorno.',target:{kind:'freelance',hiringApplicationId:applicationId},createdAt:new Date().toISOString()});
   tx.create(adminDb.doc(userNotificationPath(recipientUserId,notice.id)),notice);
  }
  tx.update(ref,{status:'closed',resolution:{operationId,outcome,note,resolvedBy:identity.uid,resolvedAt:FieldValue.serverTimestamp()}});
  tx.create(auditRef,{id:auditId,action:'admin.freelance_support.case_closed',actorId:identity.uid,actorRole:profile.get('role'),targetType:'freelance_support',targetId:caseId,outcome,source:'server',createdAt:FieldValue.serverTimestamp()});
  return {caseId,created:true};
 });
}
