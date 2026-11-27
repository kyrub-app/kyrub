// Local-only prototype. A test harness seeds verified-channel fixtures; no public
// channel verification, identity verification, data export or deletion is implemented.
import {getApps,initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {createHash,timingSafeEqual} from 'node:crypto';
import {normalizePrivacyRequest} from '../../shared/privacyRights.js';
import {preparePrivacyRequest,projectPrivacyReceipt,type PrivacyRequestRecord} from './privacyRightsPolicy.js';
export const PRIVACY_EMULATOR_PROJECT='demo-kyrub-privacy';
const APP='privacy-rights-local-emulator';
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
 const db=getFirestore(app),channels=db.collection('privacy_emulator_channels'),requests=db.collection('privacy_emulator_requests'),index=db.collection('privacy_emulator_request_index'),quota=db.collection('privacy_emulator_intake_quota');
 return {
  async submit(credential:ChannelCredential,requestId:string,input:unknown,now:number){
   assertPrivacyEmulator();
   if(!credential||Object.keys(credential).length!==2||!opaque(credential.id)||!opaque(credential.secret)||!opaque(requestId)||!validTime(now))return deny();
   const draft=normalizePrivacyRequest(input),digest=hash(JSON.stringify(draft)),key=hash(credential.id+':'+requestId);
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
     return projectPrivacyReceipt(saved);
    }
    const bucket=Math.floor(now/900000),count=q.get('bucket')===bucket?q.get('count'):0;
    if(!Number.isSafeInteger(count)||count<0||count>=5)return deny();
    const record=preparePrivacyRequest(draft,{reference:credential.id,verifiedAt:c.verifiedAt},now);
    tx.create(requests.doc(record.protocol),{...record,revision:0,triageStatus:'pending-review'});
    tx.create(index.doc(key),{channelReference:credential.id,protocol:record.protocol,payloadDigest:digest});
    tx.set(q.ref,{bucket,count:count+1});
    return projectPrivacyReceipt(record);
   });
  }
 };
}
