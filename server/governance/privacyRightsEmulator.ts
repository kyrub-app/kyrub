// Local-only prototype. A test harness seeds verified-channel fixtures; no public
// channel verification, identity verification, data export or deletion is implemented.
import {getApps,initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {createHash,timingSafeEqual} from 'node:crypto';
import {PRIVACY_ASSESSMENT_FINDINGS,type PrivacyAssessmentFinding} from '../../shared/privacyRightsAssessment.js';
import {PRIVACY_RESPONSE_MESSAGES} from '../../shared/privacyRightsResponse.js';
import {normalizePrivacyRequest} from '../../shared/privacyRights.js';
import {preparePrivacyRequest,projectPrivacyReceipt,type PrivacyRequestRecord} from './privacyRightsPolicy.js';
export const PRIVACY_EMULATOR_PROJECT='demo-kyrub-privacy';
const APP='privacy-rights-local-emulator';
export const PRIVACY_TRACKING_TTL_MS=30*86400000;
const deny=():never=>{throw Error('PRIVACY_REQUEST_FORBIDDEN');};
const validTime=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
const opaque=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const hash=(v:string)=>createHash('sha256').update(v,'utf8').digest('hex');
const equal=(stored:unknown,expected:string)=>typeof stored==='string'&&/^[a-f0-9]{64}$/.test(stored)&&timingSafeEqual(Buffer.from(stored,'hex'),Buffer.from(expected,'hex'));
type ChannelCredential={id:string;secret:string};
export function assertPrivacyEmulator(env:NodeJS.ProcessEnv=process.env){
 if(env.KYRUB_PRIVACY_EMULATOR!=='true'||env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8088'||env.GCLOUD_PROJECT!==PRIVACY_EMULATOR_PROJECT||env.FIREBASE_PROJECT_ID!==PRIVACY_EMULATOR_PROJECT||env.VERCEL||env.VERCEL_ENV||env.GOOGLE_APPLICATION_CREDENTIALS||env.FIREBASE_SERVICE_ACCOUNT_JSON)return deny();
}
export function createPrivacyRightsEmulator(){
 assertPrivacyEmulator();
 const app=getApps().find(a=>a.name===APP)??initializeApp({projectId:PRIVACY_EMULATOR_PROJECT},APP);
 if(app.options.projectId!==PRIVACY_EMULATOR_PROJECT)return deny();
 const db=getFirestore(app),channels=db.collection('privacy_emulator_channels'),requests=db.collection('privacy_emulator_requests'),index=db.collection('privacy_emulator_request_index'),quota=db.collection('privacy_emulator_intake_quota'),tracking=db.collection('privacy_emulator_tracking');
 return {
  async submit(credential:ChannelCredential,requestId:string,input:unknown,now:number){
   assertPrivacyEmulator();
   if(!credential||Object.keys(credential).length!==2||!opaque(credential.id)||!opaque(credential.secret)||!opaque(requestId)||!validTime(now))return deny();
   const draft=normalizePrivacyRequest(input),digest=hash(JSON.stringify(draft)),key=hash(credential.id+':'+requestId);
   const trackingCode=createHash('sha256').update('privacy-tracking-v1:'+credential.id+':'+credential.secret+':'+requestId).digest('base64url');
   return db.runTransaction(async tx=>{
    assertPrivacyEmulator();
    const [proof,prior,q]=await Promise.all([tx.get(channels.doc(credential.id)),tx.get(index.doc(key)),tx.get(quota.doc(credential.id))]);
    const c=proof.data();
    if(!c||c.id!==credential.id||c.simulation!==true||c.revokedAt!==undefined||!validTime(c.verifiedAt)||!validTime(c.expiresAt)||c.verifiedAt>now||now>=c.expiresAt||c.expiresAt-c.verifiedAt>15*60000||!equal(c.digest,hash(credential.secret)))return deny();
    if(prior.exists){
     const p=prior.data();
     if(!p||p.channelReference!==credential.id||p.payloadDigest!==digest||!uuid(p.protocol))return deny();
     const saved=(await tx.get(requests.doc(p.protocol))).data() as PrivacyRequestRecord|undefined;
     if(!saved||saved.protocol!==p.protocol||saved.channelReference!==credential.id||hash(JSON.stringify(normalizePrivacyRequest(saved.draft)))!==digest)return deny();
     const t=(await tx.get(tracking.doc(saved.protocol))).data();
     if(!t||t.protocol!==saved.protocol||t.simulation!==true||t.revokedAt!==undefined||!validTime(t.createdAt)||!validTime(t.expiresAt)||t.createdAt!==saved.receivedAt||now>=t.expiresAt||!equal(t.digest,hash(trackingCode)))return deny();
     return {...projectPrivacyReceipt(saved),trackingCode,trackingExpiresAt:t.expiresAt as number};
    }
    const bucket=Math.floor(now/900000),count=q.get('bucket')===bucket?q.get('count'):0;
    if(!Number.isSafeInteger(count)||count<0||count>=5)return deny();
    const record=preparePrivacyRequest(draft,{reference:credential.id,verifiedAt:c.verifiedAt},now);
    const boundAccountUid=draft.context==='ecosystem'&&typeof c.boundAccountUid==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(c.boundAccountUid)?c.boundAccountUid:null;
    const boundCid=draft.context==='cid'&&typeof c.boundTagId==='string'&&/^[a-f0-9]{32}$/.test(c.boundTagId)&&typeof c.boundOwnerId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(c.boundOwnerId)?{tagId:c.boundTagId,ownerId:c.boundOwnerId}:null;
    tx.create(requests.doc(record.protocol),{...record,revision:0,triageStatus:'pending-review',boundAccountUid,boundCid});
    tx.create(index.doc(key),{channelReference:credential.id,protocol:record.protocol,payloadDigest:digest});
    tx.set(q.ref,{bucket,count:count+1});
    const trackingExpiresAt=now+PRIVACY_TRACKING_TTL_MS;
    tx.create(tracking.doc(record.protocol),{protocol:record.protocol,digest:hash(trackingCode),createdAt:now,expiresAt:trackingExpiresAt,simulation:true});
    return {...projectPrivacyReceipt(record),trackingCode,trackingExpiresAt};
   });
  },
  // The test harness establishes a prior account/channel association.
  // Never infer it from a matching email or a caller-supplied UID.
  async confirmExistingAccount(protocol:string,code:string,idToken:string,now:number){
   assertPrivacyEmulator();
   if(process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||!uuid(protocol)||!opaque(code)||typeof idToken!=='string'||!idToken||idToken.length>8192||!validTime(now))return deny();
   const auth=getAuth(app),identity=await auth.verifyIdToken(idToken,true);
   if(identity.aud!==PRIVACY_EMULATOR_PROJECT||identity.email_verified!==true||typeof identity.uid!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(identity.uid)||!Number.isSafeInteger(identity.auth_time)||!Number.isSafeInteger(identity.exp)||identity.auth_time*1000>now||now-identity.auth_time*1000>5*60000||identity.exp*1000<=now)return deny();
   const user=await auth.getUser(identity.uid);if(user.disabled||!user.emailVerified)return deny();
   return db.runTransaction(async tx=>{
    assertPrivacyEmulator();
    const [t,s]=await Promise.all([tx.get(tracking.doc(protocol)),tx.get(requests.doc(protocol))]);
    const a=t.data(),r=s.data();
    if(!a||a.protocol!==protocol||a.simulation!==true||a.revokedAt!==undefined||!validTime(a.createdAt)||!validTime(a.expiresAt)||now<a.createdAt||now>=a.expiresAt||a.expiresAt-a.createdAt>PRIVACY_TRACKING_TTL_MS||!equal(a.digest,hash(code))||!r||r.protocol!==protocol||r.simulation!==true||r.status!=='received'||r.identityStatus!=='pending-verification'||r.actionStatus!=='not-executed'||r.triageStatus!=='verification-required'||r.revision!==1||r.receivedAt!==a.createdAt||!opaque(r.channelReference)||normalizePrivacyRequest(r.draft).context!=='ecosystem')return deny();
    const c=(await tx.get(channels.doc(r.channelReference))).data();
    if(!c||c.id!==r.channelReference||c.simulation!==true||c.revokedAt!==undefined||c.boundAccountUid!==identity.uid||r.boundAccountUid!==identity.uid||!validTime(c.verifiedAt)||c.verifiedAt>r.receivedAt)return deny();
    const proofRef=db.collection('privacy_emulator_identity_evidence').doc(protocol),prior=(await tx.get(proofRef)).data();
    if(prior){
     if(prior.protocol!==protocol||prior.accountUid!==identity.uid||prior.simulation!==true||prior.kind!=='existing-account-control')return deny();
     return {protocol,evidenceStatus:'account-control-confirmed' as const,identityStatus:'pending-verification' as const,actionStatus:'not-executed' as const,simulated:true as const};
    }
    tx.create(proofRef,{protocol,accountUid:identity.uid,kind:'existing-account-control',confirmedAt:now,authenticatedAt:identity.auth_time*1000,simulation:true,authorizesExecution:false});
    tx.update(s.ref,{evidenceStatus:'account-control-confirmed'});
    return {protocol,evidenceStatus:'account-control-confirmed' as const,identityStatus:'pending-verification' as const,actionStatus:'not-executed' as const,simulated:true as const};
   });
  },
  async track(protocol:string,code:string,now:number){
   assertPrivacyEmulator();if(!uuid(protocol)||!opaque(code)||!validTime(now))return deny();
   return db.runTransaction(async tx=>{
    assertPrivacyEmulator();
    const [t,s]=await Promise.all([tx.get(tracking.doc(protocol)),tx.get(requests.doc(protocol))]);
    const a=t.data(),r=s.data();
    if(!a||a.protocol!==protocol||a.simulation!==true||a.revokedAt!==undefined||!validTime(a.createdAt)||!validTime(a.expiresAt)||now<a.createdAt||now>=a.expiresAt||a.expiresAt-a.createdAt>PRIVACY_TRACKING_TTL_MS||!equal(a.digest,hash(code)))return deny();
    if(!r||r.protocol!==protocol||r.simulation!==true||r.status!=='received'||r.identityStatus!=='pending-verification'||r.actionStatus!=='not-executed'||!validTime(r.receivedAt)||r.receivedAt!==a.createdAt||!['pending-review','verification-required'].includes(r.triageStatus))return deny();
    let reviewedNotice:string|undefined;
    if(r.responseStatus==='reviewed'&&r.responseAssessmentRevision===r.assessmentRevision&&Number.isSafeInteger(r.assessmentRevision)&&r.assessmentRevision>0&&typeof r.assessmentFinding==='string'&&Object.hasOwn(PRIVACY_RESPONSE_MESSAGES,r.assessmentFinding)){
     const notice=(await tx.get(db.collection('privacy_emulator_responses').doc(protocol+'_'+r.assessmentRevision))).data();
     const expected=PRIVACY_RESPONSE_MESSAGES[r.assessmentFinding as keyof typeof PRIVACY_RESPONSE_MESSAGES];
     if(!notice||notice.protocol!==protocol||notice.assessmentRevision!==r.assessmentRevision||notice.status!=='reviewed'||notice.finding!==r.assessmentFinding||notice.message!==expected||notice.simulation!==true||notice.delivered!==false||notice.actionStatus!=='not-executed'||typeof notice.reviewedBy!=='string'||typeof notice.preparedBy!=='string'||notice.preparedBy===notice.reviewedBy)return deny();
     reviewedNotice=expected;
    }
    // Status and fixed reviewed notice only: no draft, channel reference, identity or personal data.
    return {protocol,receivedAt:r.receivedAt,...(reviewedNotice?{reviewedNotice}:{}),...(typeof r.assessmentFinding==='string'&&Object.hasOwn(PRIVACY_ASSESSMENT_FINDINGS,r.assessmentFinding)?{assessmentFinding:r.assessmentFinding as PrivacyAssessmentFinding}:{}),evidenceStatus:r.evidenceStatus==='account-control-confirmed'?'account-control-confirmed' as const:r.evidenceStatus==='cid-control-confirmed'?'cid-control-confirmed' as const:'awaiting-evidence' as const,triageStatus:r.triageStatus as 'pending-review'|'verification-required',identityStatus:'pending-verification' as const,actionStatus:'not-executed' as const,simulated:true as const};
   });
  },
  async revokeTracking(protocol:string,code:string,now:number){
   assertPrivacyEmulator();if(!uuid(protocol)||!opaque(code)||!validTime(now))return deny();
   return db.runTransaction(async tx=>{
    assertPrivacyEmulator();const ref=tracking.doc(protocol),a=(await tx.get(ref)).data();
    if(!a||a.protocol!==protocol||a.simulation!==true||!validTime(a.createdAt)||!validTime(a.expiresAt)||now<a.createdAt||now>=a.expiresAt||!equal(a.digest,hash(code)))return deny();
    if(a.revokedAt===undefined)tx.update(ref,{revokedAt:now});
    return {revoked:true as const,simulated:true as const};
   });
  }
 };
}
