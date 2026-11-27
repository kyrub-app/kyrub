// Local-only. No access to underlying personal data or execution of rights.
import {getApps,initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore,type Transaction,type DocumentData} from 'firebase-admin/firestore';
import {createHash,randomUUID} from 'node:crypto';
import {assertPrivacyEmulator,PRIVACY_EMULATOR_PROJECT} from './privacyRightsEmulator.js';
import {PRIVACY_ASSESSMENT_RIGHTS,PRIVACY_ASSESSMENT_FINDINGS,type PrivacyAssessmentInput,type PrivacyAssessmentReceipt} from '../../shared/privacyRightsAssessment.js';
import {PRIVACY_RESPONSE_MESSAGES,type PrivacyResponseInput,type PrivacyResponseReviewInput,type PrivacyResponseReceipt} from '../../shared/privacyRightsResponse.js';
import {normalizePrivacyRequest} from '../../shared/privacyRights.js';
const deny=():never=>{throw Error('PRIVACY_ADMIN_FORBIDDEN');};
const APP='privacy-admin-local-emulator';
function guard(){assertPrivacyEmulator();if(process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')return deny();}
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
export function createPrivacyRightsAdminEmulator(){
 guard();
 const app=getApps().find(a=>a.name===APP)??initializeApp({projectId:PRIVACY_EMULATOR_PROJECT},APP);
 if(app.options.projectId!==PRIVACY_EMULATOR_PROJECT)return deny();
 const auth=getAuth(app),db=getFirestore(app),requests=db.collection('privacy_emulator_requests'),audit=db.collection('privacy_emulator_audit');
 async function authorize(tx:Transaction,token:string,now:number,permission:'privacy:read'|'privacy:triage'|'privacy:assess'|'privacy:prepare-response'|'privacy:review-response'){
  guard();if(typeof token!=='string'||!token||token.length>8192||!Number.isSafeInteger(now)||now<=0)return deny();
  const identity=await auth.verifyIdToken(token,true);
  if(identity.aud!==PRIVACY_EMULATOR_PROJECT||identity.email_verified!==true||!/^[A-Za-z0-9_-]{1,128}$/.test(identity.uid)||!Number.isSafeInteger(identity.auth_time)||!Number.isSafeInteger(identity.exp)||identity.auth_time*1000>now||identity.exp*1000<=now||now-identity.auth_time*1000>=30*60000)return deny();
  const user=await auth.getUser(identity.uid);if(user.disabled||!user.emailVerified)return deny();
  const [a,g]=await Promise.all([tx.get(db.doc('kyrub_admin/control_plane/admins/'+identity.uid)),tx.get(db.doc('kyrub_admin/control_plane/privacy_rights_grants/'+identity.uid))]);
  if(a.get('uid')!==identity.uid||a.get('status')!=='active'||!['compliance','super_admin'].includes(a.get('role'))||g.get('uid')!==identity.uid||g.get('status')!=='active'||!Array.isArray(g.get('permissions'))||!g.get('permissions').includes('privacy:read')||!g.get('permissions').includes(permission)||permission!=='privacy:read'&&now-identity.auth_time*1000>5*60000)return deny();
  return {actorId:identity.uid,actorRole:a.get('role') as string};
 }
 function log(tx:Transaction,actor:{actorId:string;actorRole:string},action:string,now:number,fields:Record<string,unknown>){const id=randomUUID();tx.create(audit.doc(id),{id,...actor,action,createdAt:now,simulation:true,...fields});}
 function project(id:string,v:DocumentData|undefined,now:number){
  if(!uuid(id)||!v||v.protocol!==id||v.simulation!==true||v.status!=='received'||v.identityStatus!=='pending-verification'||v.actionStatus!=='not-executed'||!Number.isSafeInteger(v.receivedAt)||v.receivedAt<=0||v.receivedAt>now||!Number.isSafeInteger(v.revision)||v.revision<0||!['pending-review','verification-required'].includes(v.triageStatus))return deny();
  if(v.assessmentFinding!==undefined&&(typeof v.assessmentFinding!=='string'||!Object.hasOwn(PRIVACY_ASSESSMENT_FINDINGS,v.assessmentFinding)))return deny();
  return {protocol:id,assessmentRevision:v.assessmentRevision??0,...(v.assessmentFinding?{assessmentFinding:v.assessmentFinding}:{}),evidenceStatus:v.evidenceStatus==='account-control-confirmed'?'account-control-confirmed' as const:v.evidenceStatus==='cid-control-confirmed'?'cid-control-confirmed' as const:'awaiting-evidence' as const,draft:normalizePrivacyRequest(v.draft),receivedAt:v.receivedAt,revision:v.revision as number,triageStatus:v.triageStatus as 'pending-review'|'verification-required',identityStatus:'pending-verification' as const,actionStatus:'not-executed' as const};
 }
 return {
  async list(token:string,now:number){
   return db.runTransaction(async tx=>{
    const actor=await authorize(tx,token,now,'privacy:read'),rows=await tx.get(requests.orderBy('receivedAt','desc').limit(51));
    const items=rows.docs.slice(0,50).map(d=>project(d.id,d.data(),now));
    log(tx,actor,'privacy-intake-list',now,{count:items.length});return {items,hasMore:rows.size>50,simulation:true as const};
   });
  },
  async assess(token:string,input:unknown,now:number):Promise<PrivacyAssessmentReceipt>{
   if(!input||typeof input!=='object'||Array.isArray(input))return deny();
   const v=input as PrivacyAssessmentInput;
   if(Object.keys(v).length!==4||Object.keys(v).some(k=>!['protocol','expectedRevision','finding','reason'].includes(k))||!uuid(v.protocol)||!Number.isSafeInteger(v.expectedRevision)||v.expectedRevision<0||typeof v.finding!=='string'||!Object.hasOwn(PRIVACY_ASSESSMENT_FINDINGS,v.finding)||typeof v.reason!=='string'||v.reason.length>1000)return deny();
   const reason=v.reason.trim().normalize('NFC');
   if(!reason||reason.length>500||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(reason))return deny();
   return db.runTransaction(async tx=>{
    const actor=await authorize(tx,token,now,'privacy:assess'),ref=requests.doc(v.protocol),snap=await tx.get(ref),p=project(snap.id,snap.data(),now),r=snap.data()!;
    if(p.revision!==1||!Number.isSafeInteger(p.assessmentRevision)||p.assessmentRevision!==v.expectedRevision||p.assessmentFinding==='ready-for-fulfillment-review'||p.triageStatus!=='verification-required'||!PRIVACY_ASSESSMENT_RIGHTS.some(right=>right===p.draft.right))return deny();
    const revision=p.assessmentRevision+1,assessment=db.collection('privacy_emulator_assessments').doc(p.protocol+'_'+revision);
    if((await tx.get(assessment)).exists)return deny();
    if(v.finding==='ready-for-fulfillment-review'){
     const e=(await tx.get(db.collection('privacy_emulator_identity_evidence').doc(p.protocol))).data();
     if(!e||e.protocol!==p.protocol||e.simulation!==true||e.authorizesExecution!==false||!Number.isSafeInteger(e.confirmedAt)||e.confirmedAt<r.receivedAt||e.confirmedAt>now||now-e.confirmedAt>24*3600000)return deny();
     const channelRef=r.channelReference;
     if(typeof channelRef!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(channelRef))return deny();
     const c=(await tx.get(db.collection('privacy_emulator_channels').doc(channelRef))).data();
     if(!c||c.id!==channelRef||c.simulation!==true||c.revokedAt!==undefined)return deny();
     if(p.draft.context==='ecosystem'){
      if(p.evidenceStatus!=='account-control-confirmed'||e.kind!=='existing-account-control'||typeof e.accountUid!=='string'||e.accountUid!==r.boundAccountUid||e.accountUid!==c.boundAccountUid)return deny();
      const u=await auth.getUser(e.accountUid);if(u.disabled||!u.emailVerified)return deny();
     }else if(p.draft.context==='cid'){
      if(p.evidenceStatus!=='cid-control-confirmed'||e.kind!=='cid-passkey-control'||typeof e.tagId!=='string'||!/^[a-f0-9]{32}$/.test(e.tagId)||typeof e.ownerId!=='string'||typeof e.credentialId!=='string'||e.tagId!==r.boundCid?.tagId||e.ownerId!==r.boundCid?.ownerId||e.tagId!==c.boundTagId||e.ownerId!==c.boundOwnerId)return deny();
      const [tag,credential,index]=await Promise.all([tx.get(db.collection('kyrub_official_tags').doc(e.tagId)),tx.get(db.collection('kyrub_tag_passkey_credentials').doc(e.tagId)),tx.get(db.collection('kyrub_tag_passkey_credential_index').doc(createHash('sha256').update(e.credentialId).digest('hex')))]);
      if(tag.get('ownerId')!==e.ownerId||tag.get('ownerAuthMode')!=='passkey'||tag.get('enabled')!==true||tag.get('blocked')===true||credential.get('ownerId')!==e.ownerId||credential.get('credential.id')!==e.credentialId||index.get('tagId')!==e.tagId||index.get('ownerId')!==e.ownerId||index.get('revokedAt')!=null)return deny();
     }else return deny();
    }
    tx.create(assessment,{protocol:p.protocol,right:p.draft.right,context:p.draft.context,finding:v.finding,reason,actorId:actor.actorId,createdAt:now,revision,simulation:true,authorizesExecution:false});
    tx.update(ref,{assessmentRevision:revision,assessmentFinding:v.finding});
    log(tx,actor,'privacy-right-assessed',now,{protocol:p.protocol,revision,finding:v.finding});
    return {protocol:p.protocol,revision,finding:v.finding,simulation:true,actionStatus:'not-executed'};
   });
  },
  // Only fixed status notices. No user data, internal reason, or claim of fulfillment.
  async prepareResponse(token:string,input:unknown,now:number):Promise<PrivacyResponseReceipt>{
   if(!input||typeof input!=='object'||Array.isArray(input))return deny();
   const v=input as PrivacyResponseInput;
   if(Object.keys(v).length!==2||Object.keys(v).some(k=>!['protocol','expectedAssessmentRevision'].includes(k))||!uuid(v.protocol)||!Number.isSafeInteger(v.expectedAssessmentRevision)||v.expectedAssessmentRevision<1)return deny();
   return db.runTransaction(async tx=>{
    const actor=await authorize(tx,token,now,'privacy:prepare-response'),ref=requests.doc(v.protocol),s=await tx.get(ref),p=project(s.id,s.data(),now);
    if(p.assessmentRevision!==v.expectedAssessmentRevision||!p.assessmentFinding||!Object.hasOwn(PRIVACY_RESPONSE_MESSAGES,p.assessmentFinding))return deny();
    const assessment=(await tx.get(db.collection('privacy_emulator_assessments').doc(p.protocol+'_'+p.assessmentRevision))).data();
    if(!assessment||assessment.protocol!==p.protocol||assessment.revision!==p.assessmentRevision||assessment.right!==p.draft.right||assessment.context!==p.draft.context||assessment.finding!==p.assessmentFinding||assessment.simulation!==true||assessment.authorizesExecution!==false)return deny();
    const responseRef=db.collection('privacy_emulator_responses').doc(p.protocol+'_'+p.assessmentRevision),prior=(await tx.get(responseRef)).data();
    if(prior)return deny();
    const message=PRIVACY_RESPONSE_MESSAGES[p.assessmentFinding as keyof typeof PRIVACY_RESPONSE_MESSAGES];
    tx.create(responseRef,{protocol:p.protocol,assessmentRevision:p.assessmentRevision,finding:p.assessmentFinding,message,preparedBy:actor.actorId,createdAt:now,revision:1,status:'draft',simulation:true,delivered:false,actionStatus:'not-executed'});
    tx.update(ref,{responseStatus:'draft',responseAssessmentRevision:p.assessmentRevision});
    log(tx,actor,'privacy-response-prepared',now,{protocol:p.protocol,assessmentRevision:p.assessmentRevision});
    return {protocol:p.protocol,revision:1,status:'draft',simulation:true,delivered:false,actionStatus:'not-executed'};
   });
  },
  async reviewResponse(token:string,input:unknown,now:number):Promise<PrivacyResponseReceipt>{
   if(!input||typeof input!=='object'||Array.isArray(input))return deny();
   const v=input as PrivacyResponseReviewInput;
   if(Object.keys(v).length!==4||Object.keys(v).some(k=>!['protocol','expectedAssessmentRevision','expectedResponseRevision','decision'].includes(k))||!uuid(v.protocol)||!Number.isSafeInteger(v.expectedAssessmentRevision)||v.expectedAssessmentRevision<1||!Number.isSafeInteger(v.expectedResponseRevision)||v.expectedResponseRevision<1||!['approve','return'].includes(v.decision))return deny();
   return db.runTransaction(async tx=>{
    const actor=await authorize(tx,token,now,'privacy:review-response'),ref=requests.doc(v.protocol),s=await tx.get(ref),p=project(s.id,s.data(),now);
    if(p.assessmentRevision!==v.expectedAssessmentRevision||!p.assessmentFinding||!Object.hasOwn(PRIVACY_RESPONSE_MESSAGES,p.assessmentFinding))return deny();
    const responseRef=db.collection('privacy_emulator_responses').doc(p.protocol+'_'+p.assessmentRevision),r=(await tx.get(responseRef)).data();
    if(!r||r.protocol!==p.protocol||r.assessmentRevision!==p.assessmentRevision||r.finding!==p.assessmentFinding||r.message!==PRIVACY_RESPONSE_MESSAGES[p.assessmentFinding as keyof typeof PRIVACY_RESPONSE_MESSAGES]||r.simulation!==true||r.delivered!==false||r.actionStatus!=='not-executed'||r.status!=='draft'||r.revision!==v.expectedResponseRevision||typeof r.preparedBy!=='string'||r.preparedBy===actor.actorId)return deny();
    const revision=r.revision+1,status=v.decision==='approve'?'reviewed':'draft';
    tx.update(responseRef,{revision,status,reviewedBy:actor.actorId,reviewedAt:now,lastDecision:v.decision});
    tx.update(ref,{responseStatus:status,responseAssessmentRevision:p.assessmentRevision});
    log(tx,actor,'privacy-response-reviewed',now,{protocol:p.protocol,assessmentRevision:p.assessmentRevision,revision,decision:v.decision});
    return {protocol:p.protocol,revision,status,simulation:true,delivered:false,actionStatus:'not-executed'};
   });
  },
  async markVerificationRequired(token:string,input:unknown,now:number){
   if(!input||typeof input!=='object'||Array.isArray(input))return deny();
   const v=input as {protocol:string;expectedRevision:number};
   if(Object.keys(v).length!==2||!uuid(v.protocol)||v.expectedRevision!==0)return deny();
   return db.runTransaction(async tx=>{
    const actor=await authorize(tx,token,now,'privacy:triage'),ref=requests.doc(v.protocol),s=await tx.get(ref),p=project(s.id,s.data(),now);
    if(p.revision!==v.expectedRevision||p.triageStatus!=='pending-review')return deny();
    tx.update(ref,{triageStatus:'verification-required',revision:1,triagedAt:now});
    log(tx,actor,'privacy-intake-triage',now,{protocol:p.protocol,revision:1});
    return {protocol:p.protocol,revision:1,triageStatus:'verification-required' as const,identityStatus:'pending-verification' as const,actionStatus:'not-executed' as const,simulation:true as const};
   });
  }
 };
}
