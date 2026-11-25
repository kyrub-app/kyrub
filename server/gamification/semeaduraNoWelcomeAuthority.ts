import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type { WelcomeAuth } from './signedSessionWelcomeService.js';
import { buildPitangaMigrationSnapshot } from './pitangaMigrationSnapshot.js';
import { pitangaHistoricalMembershipDigest } from './pitangaHistoricalMembership.js';

const project='demo-kyrub-welcome';
const epoch='welcome-emulator-only';
const uidValid=(uid:string)=>/^[A-Za-z0-9_-]{1,128}$/.test(uid);
const cutoff=()=>Date.parse(process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT??'');
export function noWelcomePilotEnabled(db:Firestore){
 return process.env.KYRUB_SEMEADURA_NO_WELCOME_PILOT==='true'&&process.env.NODE_ENV!=='production'&&
  (db as Firestore&{projectId?:string}).projectId===project&&process.env.GCLOUD_PROJECT===project&&
  process.env.KYRUB_PITANGA_WELCOME_PROJECT_ID===project&&process.env.KYRUB_PITANGA_WELCOME_FENCE_EPOCH===epoch&&
  process.env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8088'&&process.env.FIREBASE_AUTH_EMULATOR_HOST==='127.0.0.1:9099'&&
  !process.env.VERCEL&&!process.env.FIREBASE_SERVICE_ACCOUNT_JSON&&!process.env.GOOGLE_APPLICATION_CREDENTIALS&&
  Number.isFinite(cutoff());
}

/** Only trusted Auth onCreate may record original non-Google registration.
 * Current provider lists alone cannot establish that the bonus was ineligible. */
export async function recordIsolatedNonGoogleRegistration(db:Firestore,auth:WelcomeAuth,user:{
 uid:string;disabled:boolean;metadata:{creationTime:string};providerData:ReadonlyArray<{providerId:string}>;
},context:{eventId:string;projectId:string}){
 if(!noWelcomePilotEnabled(db))return;
 if(context.projectId!==project||auth.app.options.projectId!==project||!uidValid(user.uid)||
  user.disabled||user.providerData.some(p=>p.providerId==='google.com')||
  !/^[A-Za-z0-9_-]{8,128}$/.test(context.eventId)||!Number.isFinite(Date.parse(user.metadata.creationTime)))
  throw Error('SEMEADURA_NO_WELCOME_REGISTRATION_INVALID');
 const createdAt=new Date(user.metadata.creationTime).toISOString();
 const ref=db.doc('users/'+user.uid+'/authEvents/semeadura_non_google_registration_v1');
 await db.runTransaction(async tx=>{
  const prior=await tx.get(ref);
  const value={schemaVersion:1,userId:user.uid,projectId:project,createdAt,source:'trusted_auth_on_create_non_google',sourceEventId:context.eventId};
  if(prior.exists){
   const p=prior.data();
   if(!p||Object.entries(value).some(([k,v])=>p[k]!==v))throw Error('SEMEADURA_NO_WELCOME_REGISTRATION_CONFLICT');
   return;
  }
  tx.create(ref,value);
 });
}

/** Prove an empty currency account belongs to a currently existing author,
 * and that a delayed eligible welcome event cannot be displaced. */
export async function requireIsolatedNoWelcomeEligibility(db:Firestore,tx:Transaction,auth:WelcomeAuth|undefined,uid:string){
 if(!noWelcomePilotEnabled(db)||auth?.app.options.projectId!==project||!uidValid(uid))
  throw Error('SEMEADURA_NO_WELCOME_UNVERIFIED');
 const user=await auth.getUser(uid);
 const created=Date.parse(user.metadata.creationTime);
 if(user.uid!==uid||user.disabled||!Number.isFinite(created))throw Error('SEMEADURA_NO_WELCOME_UNVERIFIED');
 const root=db.collection('users').doc(uid);
 const [welcome,registration]=await Promise.all([
  tx.get(root.collection('authEvents').doc('first_login_v1')),
  tx.get(root.collection('authEvents').doc('semeadura_non_google_registration_v1')),
 ]);
 if(welcome.exists)throw Error('SEMEADURA_WELCOME_PENDING');
 if(created<cutoff())return;
 const r=registration.data();
 if(!r||r.schemaVersion!==1||r.userId!==uid||r.projectId!==project||r.source!=='trusted_auth_on_create_non_google'||
  !/^[A-Za-z0-9_-]{8,128}$/.test(r.sourceEventId)||typeof r.createdAt!=='string'||
  Math.floor(Date.parse(r.createdAt)/1000)!==Math.floor(created/1000))
  throw Error('SEMEADURA_NO_WELCOME_UNVERIFIED');
}

export const emptyCurrencyCheckpoint=(uid:string)=>buildPitangaMigrationSnapshot({
 userId:uid,ledgerDocuments:[],completeLedgerVerified:true,legacyWritersFenced:true,
});

/** Reuse the canonical zero-history bootstrap receipt; no historical migration
 * is performed. Conversion can use its existing verified spending route. */
export async function readIsolatedZeroCurrencyBalance(db:Firestore,tx:Transaction,uid:string){
 if(!noWelcomePilotEnabled(db))throw Error('SEMEADURA_NO_WELCOME_UNVERIFIED');
 const root=db.collection('users').doc(uid);
 const [balance,receipt,fence]=await Promise.all([
  tx.get(root.collection('pitangaBalance').doc('balance')),
  tx.get(root.collection('pitangaMigration').doc('receipt')),
  tx.get(db.doc('systemControl/pitangaLegacyWriterFence')),
 ]);
 const b=balance.data(),r=receipt.data(),checkpoint=emptyCurrencyCheckpoint(uid);
 if(!b||!r||b.userId!==uid||b.migrationEpoch!==epoch||!Number.isSafeInteger(b.availableKCoins)||b.availableKCoins<0||
  r.userId!==uid||r.fenceEpoch!==epoch||r.balance!==0||r.entryCount!==0||r.ledgerSha256!==checkpoint.ledgerSha256||
  r.historicalMembershipSha256!==pitangaHistoricalMembershipDigest({userId:uid,entryIds:[]})||
  fence.get('status')!=='fenced'||fence.get('writersVerified')!==true||fence.get('epoch')!==epoch)
  throw Error('SEMEADURA_NO_WELCOME_BASELINE_INVALID');
 return b.availableKCoins as number;
}
