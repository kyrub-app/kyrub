import {adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {createKyrubFinancialProfile} from './financialProfileOnboarding.js';
import {normalizeCidPersonalPixCandidate,projectCidPersonalPixCandidate} from '../../shared/cidPersonalPixCandidate.js';
import {isTagId} from '../../shared/kyrubTagContract.js';
import type {DocumentSnapshot} from 'firebase-admin/firestore';
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

/** Only server-owned linkage is authority. A scanned URL is not proof of ownership. */
function linkedCidPix(uid:string,snapshot:DocumentSnapshot){
 const data=snapshot.data();
 if(!isTagId(snapshot.id)||!data||data.distribution!=='promotional'||data.ownerAuthMode!=='passkey'||
 data.model!=='adesivo'||data.manufacturingState!=='released'||data.enabled!==true||data.blocked!==false||
 typeof data.ownerId!=='string'||!/^tagpk_[A-Za-z0-9_-]{43}$/.test(data.ownerId)||data.firstOwnerId!==data.ownerId||
 data.linkedAccountId!==uid||typeof data.linkedAccountAt!=='string'||!Number.isFinite(Date.parse(data.linkedAccountAt))||
 !snapshot.updateTime||!data.presentation?.pix)throw Error('PERSONAL_CID_UNAVAILABLE');
 try{
  const destination=normalizeCidPersonalPixCandidate(data.presentation.pix);
  const projection=projectCidPersonalPixCandidate(data.presentation.pix);
  return {destination,projection,sourceVersion:snapshot.updateTime.seconds+':'+snapshot.updateTime.nanoseconds};
 }catch{throw Error('PERSONAL_CID_UNAVAILABLE');}
}
function assertRealAccount(uid:string,account:DocumentSnapshot,marker:DocumentSnapshot){
 if(uid.startsWith('tagpk_')||!account.exists||marker.get('mode')==='tag_only')throw Error('PERSONAL_CID_UNAVAILABLE');
}
export async function listPersonalCidPixCandidates(uid:string){
 profileRef(uid);
 const [account,marker,tags]=await Promise.all([
  adminDb.doc('users/'+uid).get(),adminDb.doc('kyrub_tag_minimal_identities/'+uid).get(),
  adminDb.collection('kyrub_official_tags').where('linkedAccountId','==',uid).limit(21).get()
 ]);
 assertRealAccount(uid,account,marker);
 // Fail closed instead of silently omitting eligible CIDs beyond the bounded page.
 if(tags.size>20)throw Error('PERSONAL_CID_LIST_LIMIT');
 return {candidates:tags.docs.flatMap(snapshot=>{
  try{const {projection,sourceVersion}=linkedCidPix(uid,snapshot);return [{cidId:snapshot.id,sourceVersion,...projection}];}catch{return [];}
 })};
}
export async function importPersonalCidPixDestination(uid:string,input:unknown){
 const parent=profileRef(uid);
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('PERSONAL_PIX_INVALID');
 const b=input as Record<string,unknown>;
 if(Object.keys(b).some(k=>!['action','cidId','sourceVersion','expectedRevision','confirmed','replaceExisting'].includes(k))||
 b.action!=='import_cid'||b.confirmed!==true||typeof b.replaceExisting!=='boolean'||!isTagId(b.cidId)||
 typeof b.sourceVersion!=='string'||!/^\d{1,12}:\d{1,9}$/.test(b.sourceVersion)||
 !Number.isSafeInteger(b.expectedRevision)||Number(b.expectedRevision)<0)throw Error('PERSONAL_PIX_INVALID');
 const ref=parent.collection('receiving').doc('externalPix'),tag=adminDb.doc('kyrub_official_tags/'+b.cidId);
 const account=adminDb.doc('users/'+uid),marker=adminDb.doc('kyrub_tag_minimal_identities/'+uid),identity=adminDb.doc('identity_verifications/'+uid);
 return adminDb.runTransaction(async tx=>{
  const [p,d,c,a,m,eligible]=await tx.getAll(parent,ref,tag,account,marker,identity);
  assertRealAccount(uid,a,m);
  const roles=eligible.get('approvedProfiles');
  if(eligible.get('status')!=='approved'||!Array.isArray(roles)||!roles.some(r=>['freelancer','bicycle_courier','motorized_courier'].includes(r)))throw Error('IDENTITY_VERIFICATION_REQUIRED');
  const source=linkedCidPix(uid,c);
  if(source.sourceVersion!==b.sourceVersion)throw Error('PERSONAL_CID_CHANGED');
  if(p.exists&&(p.get('userId')!==uid||p.get('schemaVersion')!==1))throw Error('PERSONAL_PIX_CONFLICT');
  const current=checked(d.data(),uid),revision=current?.revision??0;
  if(revision!==b.expectedRevision||revision>=Number.MAX_SAFE_INTEGER||
   (current?.status==='declared')!==b.replaceExisting)throw Error('PERSONAL_PIX_CONFLICT');
  const now=new Date();
  const next:PersonalPixDestination={schemaVersion:1,userId:uid,revision:revision+1,status:'declared',updatedAt:now.toISOString(),...source.destination};
  if(!p.exists)tx.create(parent,createKyrubFinancialProfile({userId:uid,now}));
  tx.set(ref,next);
  return projectPersonalPixDestination(next);
 });
}

/** Server transaction helper: never returns a raw key or grants bank verification. */
export async function readPersonalPixForContract(tx:FirebaseFirestore.Transaction,uid:string){
 const parent=profileRef(uid);
 const [p,d]=await tx.getAll(parent,parent.collection('receiving').doc('externalPix'));
 if(p.exists&&(p.get('userId')!==uid||p.get('schemaVersion')!==1))throw Error('PERSONAL_PIX_CONFLICT');
 const destination=checked(d.data(),uid);
 if(!p.exists||destination?.status!=='declared'||!destination.keyType||!destination.key)throw Error('FREELANCE_PIX_DESTINATION_REQUIRED');
 return {revision:destination.revision,keyType:destination.keyType,maskedKey:'••••'+destination.key.slice(-4),ownershipVerified:false as const};
}
