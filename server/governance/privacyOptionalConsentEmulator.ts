// Only local demo data. No actual processing or marketing dispatch is enabled.
import {getApps,initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {assertPrivacyEmulator,PRIVACY_EMULATOR_PROJECT} from './privacyRightsEmulator.js';
import {OPTIONAL_CONSENT_PURPOSES,normalizeOptionalConsentChoice,type OptionalConsentPurpose,type OptionalConsentRecord} from '../../shared/privacyOptionalConsent.js';
import {prepareOptionalConsent,projectOptionalConsent} from './privacyOptionalConsentPolicy.js';
const APP='privacy-optional-consent-local-emulator';
const deny=():never=>{throw Error('OPTIONAL_CONSENT_FORBIDDEN');};
function guard(){assertPrivacyEmulator();if(process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')return deny();}
export function createPrivacyOptionalConsentEmulator(){
 guard();
 const app=getApps().find(a=>a.name===APP)??initializeApp({projectId:PRIVACY_EMULATOR_PROJECT},APP);
 if(app.options.projectId!==PRIVACY_EMULATOR_PROJECT)return deny();
 const db=getFirestore(app),auth=getAuth(app);
 async function owner(token:string,now:number){
  guard();
  if(typeof token!=='string'||!token||token.length>8192||!Number.isSafeInteger(now)||now<=0)return deny();
  const identity=await auth.verifyIdToken(token,true);
  if(identity.aud!==PRIVACY_EMULATOR_PROJECT||identity.email_verified!==true||!/^[A-Za-z0-9_-]{1,128}$/.test(identity.uid)||!Number.isSafeInteger(identity.auth_time)||!Number.isSafeInteger(identity.exp)||identity.auth_time*1000>now||identity.exp*1000<=now||now-identity.auth_time*1000>=30*60000)return deny();
  const user=await auth.getUser(identity.uid);if(user.disabled||!user.emailVerified)return deny();
  return identity.uid;
 }
 const purposes=Object.keys(OPTIONAL_CONSENT_PURPOSES) as OptionalConsentPurpose[];
 const root=(uid:string)=>db.collection('privacy_emulator_optional_consents').doc(uid);
 function record(data:FirebaseFirestore.DocumentData|undefined,uid:string):OptionalConsentRecord|undefined{
  if(!data)return undefined;if(data.ownerUid!==uid)return deny();return data as OptionalConsentRecord;
 }
 return {
  async list(token:string,now:number){
   const uid=await owner(token,now);
   return db.runTransaction(async tx=>{
    guard();
    const entries=await Promise.all(purposes.map(p=>tx.get(root(uid).collection('purposes').doc(p))));
    return entries.map((s,i)=>projectOptionalConsent(purposes[i],record(s.data(),uid)));
   });
  },
  async change(token:string,input:unknown,now:number){
   const uid=await owner(token,now),choice=normalizeOptionalConsentChoice(input);
   return db.runTransaction(async tx=>{
    guard();const ref=root(uid).collection('purposes').doc(choice.purpose),s=await tx.get(ref),prior=record(s.data(),uid);
    const next=prepareOptionalConsent(choice,prior,now),history=root(uid).collection('events').doc(choice.purpose+'_'+next.revision);
    if((await tx.get(history)).exists)return deny();
    tx.set(ref,{...next,ownerUid:uid});tx.create(history,next);
    return projectOptionalConsent(choice.purpose,next);
   });
  }
 };
}
