import {adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {createKyrubFinancialProfile} from './financialProfileOnboarding.js';
import {normalizePersonalPixKey,projectPersonalPixDestination,type PersonalPixDestination} from '../../shared/personalPixDestination.js';
/** Candidate persistence only. No HTTP route or production access in this parcel. */
function assertLocal(){
 if(process.env.VERCEL||process.env.VERCEL_ENV||process.env.FIREBASE_SERVICE_ACCOUNT_JSON||process.env.GOOGLE_APPLICATION_CREDENTIALS||
 !/^(127\.0\.0\.1|localhost):8088$/.test(process.env.FIRESTORE_EMULATOR_HOST??'')||getFirebaseAdminProjectId()!=='kyrub-security-test')throw Error('PERSONAL_FINANCE_DISABLED');
}
function profileRef(uid:string){
 assertLocal();
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid))throw Error('PERSONAL_PIX_INVALID');
 return adminDb.doc('financialProfilesV1/'+uid);
}
function checked(value:unknown,uid:string):PersonalPixDestination|undefined{
 if(value===undefined)return undefined;
 if(!value||typeof value!=='object')throw Error('PERSONAL_PIX_CONFLICT');
 const r=value as PersonalPixDestination;
 if(r.userId!==uid||r.schemaVersion!==1||!Number.isSafeInteger(r.revision)||r.revision<1||
 !Number.isFinite(Date.parse(r.updatedAt))||!['declared','revoked'].includes(r.status))throw Error('PERSONAL_PIX_CONFLICT');
 if(r.status==='declared'){
  const n=normalizePersonalPixKey({keyType:r.keyType,key:r.key});
  if(n.key!==r.key||n.keyType!==r.keyType)throw Error('PERSONAL_PIX_CONFLICT');
 }else if(r.key!==undefined||r.keyType!==undefined)throw Error('PERSONAL_PIX_CONFLICT');
 return r;
}
export async function readPersonalPixDestination(uid:string){
 const ref=profileRef(uid).collection('receiving').doc('externalPix');
 return projectPersonalPixDestination(checked((await ref.get()).data(),uid));
}
export async function changePersonalPixDestination(uid:string,input:unknown){
 const parent=profileRef(uid);
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('PERSONAL_PIX_INVALID');
 const b=input as Record<string,unknown>;
 if(!Number.isSafeInteger(b.expectedRevision)||Number(b.expectedRevision)<0||b.confirmed!==true)throw Error('PERSONAL_PIX_INVALID');
 const revoke=b.action==='revoke';
 if((!revoke&&b.action!=='declare')||Object.keys(b).some(k=>!(revoke?['action','expectedRevision','confirmed']:['action','expectedRevision','confirmed','destination']).includes(k)))throw Error('PERSONAL_PIX_INVALID');
 const key=revoke?{}:normalizePersonalPixKey(b.destination);
 const ref=parent.collection('receiving').doc('externalPix');
 return adminDb.runTransaction(async tx=>{
  const [p,d]=await tx.getAll(parent,ref);
  if(p.exists&&(p.get('userId')!==uid||p.get('schemaVersion')!==1))throw Error('PERSONAL_PIX_CONFLICT');
  const current=checked(d.data(),uid);
  const revision=current?.revision??0;
  if(revision!==b.expectedRevision||revision>=Number.MAX_SAFE_INTEGER||(revoke&&current?.status!=='declared'))throw Error('PERSONAL_PIX_CONFLICT');
  const now=new Date();
  const next:PersonalPixDestination={schemaVersion:1,userId:uid,revision:revision+1,status:revoke?'revoked':'declared',updatedAt:now.toISOString(),...key};
  if(!p.exists)tx.create(parent,createKyrubFinancialProfile({userId:uid,now}));
  // Full replacement removes revoked key. No raw key in the response or a second history document.
  tx.set(ref,next);
  return projectPersonalPixDestination(next);
 });
}
