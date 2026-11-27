// Local-only, fixture collections exclusively. No production data access or writes.
import {getApps,initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore,type Transaction} from 'firebase-admin/firestore';
import {createHash,timingSafeEqual,randomUUID} from 'node:crypto';
import {assertPrivacyEmulator,PRIVACY_EMULATOR_PROJECT,PRIVACY_TRACKING_TTL_MS} from './privacyRightsEmulator.js';
import {normalizePrivacyRequest} from '../../shared/privacyRights.js';
import {normalizePrivacyFixtureCorrection,type PrivacyFixtureCorrectionReceipt,type PrivacyFixtureConfirmation} from '../../shared/privacyOwnDataCorrection.js';
import {projectOwnDataFixture} from './privacyOwnDataExportPolicy.js';
import {PRIVACY_RESPONSE_MESSAGES} from '../../shared/privacyRightsResponse.js';
const APP='privacy-own-data-export-local-emulator';
const deny=():never=>{throw Error('PRIVACY_EXPORT_FORBIDDEN');};
const time=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
const opaque=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
export function createPrivacyOwnDataExportEmulator(){
 assertPrivacyEmulator();if(process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')return deny();
 const app=getApps().find(a=>a.name===APP)??initializeApp({projectId:PRIVACY_EMULATOR_PROJECT},APP);
 if(app.options.projectId!==PRIVACY_EMULATOR_PROJECT)return deny();
 const auth=getAuth(app),db=getFirestore(app);
 async function withOwnRequest<T>(protocol:string,code:string,idToken:string,now:number,right:'access'|'confirm-processing'|'correction',work:(tx:Transaction,uid:string,assessmentRevision:number)=>Promise<T>){
   assertPrivacyEmulator();
   if(process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||typeof protocol!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(protocol)||!opaque(code)||typeof idToken!=='string'||!idToken||idToken.length>8192||!time(now))return deny();
   const identity=await auth.verifyIdToken(idToken,true);
   if(identity.aud!==PRIVACY_EMULATOR_PROJECT||identity.email_verified!==true||!/^[A-Za-z0-9_-]{1,128}$/.test(identity.uid)||!Number.isSafeInteger(identity.auth_time)||!Number.isSafeInteger(identity.exp)||identity.auth_time*1000>now||now-identity.auth_time*1000>5*60000||identity.exp*1000<=now)return deny();
   const user=await auth.getUser(identity.uid);if(user.disabled||!user.emailVerified)return deny();
   return db.runTransaction(async tx=>{
    assertPrivacyEmulator();
    const [request,tracking,evidence]=await Promise.all([tx.get(db.collection('privacy_emulator_requests').doc(protocol)),tx.get(db.collection('privacy_emulator_tracking').doc(protocol)),tx.get(db.collection('privacy_emulator_identity_evidence').doc(protocol))]);
    const r=request.data(),t=tracking.data(),e=evidence.data();
    if(!t||t.protocol!==protocol||t.simulation!==true||t.revokedAt!==undefined||!time(t.createdAt)||!time(t.expiresAt)||now<t.createdAt||now>=t.expiresAt||t.expiresAt-t.createdAt>PRIVACY_TRACKING_TTL_MS||typeof t.digest!=='string'||!/^[a-f0-9]{64}$/.test(t.digest)||!timingSafeEqual(Buffer.from(t.digest,'hex'),Buffer.from(hash(code),'hex')))return deny();
    if(!r||r.protocol!==protocol||r.simulation!==true||r.receivedAt!==t.createdAt||r.status!=='received'||r.identityStatus!=='pending-verification'||r.actionStatus!=='not-executed'||r.triageStatus!=='verification-required'||r.evidenceStatus!=='account-control-confirmed'||r.boundAccountUid!==identity.uid||!opaque(r.channelReference)||r.assessmentFinding!=='ready-for-fulfillment-review'||!Number.isSafeInteger(r.assessmentRevision)||r.assessmentRevision<1||r.responseAssessmentRevision!==r.assessmentRevision||r.responseStatus!=='reviewed')return deny();
    const draft=normalizePrivacyRequest(r.draft);
    if(draft.context!=='ecosystem'||draft.right!==right)return deny();
    if(!e||e.protocol!==protocol||e.kind!=='existing-account-control'||e.accountUid!==identity.uid||e.simulation!==true||e.authorizesExecution!==false||!time(e.confirmedAt)||e.confirmedAt<r.receivedAt||e.confirmedAt>now||now-e.confirmedAt>24*3600000)return deny();
    const key=protocol+'_'+r.assessmentRevision;
    const [channel,assessment,response]=await Promise.all([
     tx.get(db.collection('privacy_emulator_channels').doc(r.channelReference)),
     tx.get(db.collection('privacy_emulator_assessments').doc(key)),
     tx.get(db.collection('privacy_emulator_responses').doc(key))
    ]);
    const c=channel.data(),a=assessment.data(),n=response.data();
    if(!c||c.id!==r.channelReference||c.simulation!==true||c.revokedAt!==undefined||c.boundAccountUid!==identity.uid||!a||a.protocol!==protocol||a.revision!==r.assessmentRevision||a.right!==right||a.context!=='ecosystem'||a.finding!==r.assessmentFinding||a.simulation!==true||a.authorizesExecution!==false||!n||n.protocol!==protocol||n.assessmentRevision!==r.assessmentRevision||n.finding!==a.finding||n.status!=='reviewed'||n.message!==PRIVACY_RESPONSE_MESSAGES['ready-for-fulfillment-review']||n.simulation!==true||n.delivered!==false||n.actionStatus!=='not-executed'||typeof n.preparedBy!=='string'||typeof n.reviewedBy!=='string'||n.preparedBy===n.reviewedBy)return deny();
    return work(tx,identity.uid,r.assessmentRevision);
   });
 }
 async function readFixture(tx:Transaction,protocol:string,uid:string,now:number){
  const [profile,preferences]=await Promise.all([tx.get(db.collection('privacy_emulator_fixture_profiles').doc(uid)),tx.get(db.collection('privacy_emulator_fixture_preferences').doc(uid))]);
  return projectOwnDataFixture({protocol,ownerUid:uid,now,profile:profile.data() as Parameters<typeof projectOwnDataFixture>[0]['profile'],preferences:preferences.data() as Parameters<typeof projectOwnDataFixture>[0]['preferences']});
 }
 return {
  async exportOwnFixture(protocol:string,code:string,idToken:string,now:number){
   return withOwnRequest(protocol,code,idToken,now,'access',async(tx,uid,assessmentRevision)=>{
    const result=await readFixture(tx,protocol,uid,now);
    // Audit only categories and a digest; do not persist another copy of exported content.
    const id=randomUUID();tx.create(db.collection('privacy_emulator_export_audit').doc(id),{id,protocol,assessmentRevision,categories:result.categories,digest:hash(JSON.stringify(result)),createdAt:now,simulation:true,completeAccessResponse:false});
    return result;
   });
  },
  async confirmOwnFixture(protocol:string,code:string,idToken:string,now:number):Promise<PrivacyFixtureConfirmation>{
   return withOwnRequest(protocol,code,idToken,now,'confirm-processing',async(tx,uid,assessmentRevision)=>{
    const result=await readFixture(tx,protocol,uid,now),id=randomUUID();
    tx.create(db.collection('privacy_emulator_confirmation_audit').doc(id),{id,protocol,assessmentRevision,categories:result.categories,createdAt:now,simulation:true,completeConfirmationResponse:false});
    return {protocol,simulation:true,completeConfirmationResponse:false,categories:result.categories};
   });
  },
  async correctOwnFixture(protocol:string,code:string,idToken:string,input:unknown,now:number):Promise<PrivacyFixtureCorrectionReceipt>{
   const correction=normalizePrivacyFixtureCorrection(input);
   return withOwnRequest(protocol,code,idToken,now,'correction',async(tx,uid,assessmentRevision)=>{
    const ref=db.collection('privacy_emulator_fixture_profiles').doc(uid),audit=db.collection('privacy_emulator_correction_audit').doc(protocol);
    const [profile,prior]=await Promise.all([tx.get(ref),tx.get(audit)]),p=profile.data();
    if(prior.exists||!p||p.simulation!==true||p.ownerUid!==uid||p.displayName!==correction.expectedDisplayName||!time(p.createdAt)||p.createdAt>now)return deny();
    // Single allowlisted field; preserve all other fields and the underlying request.
    tx.update(ref,{displayName:correction.displayName});
    tx.create(audit,{protocol,assessmentRevision,field:'displayName',createdAt:now,simulation:true,completeCorrectionResponse:false});
    return {protocol,field:'displayName',corrected:true,simulation:true,completeCorrectionResponse:false};
   });
  }
 };
}
