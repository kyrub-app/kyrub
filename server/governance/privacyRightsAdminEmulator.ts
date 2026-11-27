// Local-only. No access to underlying personal data or execution of rights.
import {getApps,initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore,type Transaction,type DocumentData} from 'firebase-admin/firestore';
import {randomUUID} from 'node:crypto';
import {assertPrivacyEmulator,PRIVACY_EMULATOR_PROJECT} from './privacyRightsEmulator.js';
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
 async function authorize(tx:Transaction,token:string,now:number,permission:'privacy:read'|'privacy:triage'){
  guard();if(typeof token!=='string'||!token||token.length>8192||!Number.isSafeInteger(now)||now<=0)return deny();
  const identity=await auth.verifyIdToken(token,true);
  if(identity.aud!==PRIVACY_EMULATOR_PROJECT||identity.email_verified!==true||!/^[A-Za-z0-9_-]{1,128}$/.test(identity.uid)||!Number.isSafeInteger(identity.auth_time)||!Number.isSafeInteger(identity.exp)||identity.auth_time*1000>now||identity.exp*1000<=now||now-identity.auth_time*1000>=30*60000)return deny();
  const user=await auth.getUser(identity.uid);if(user.disabled||!user.emailVerified)return deny();
  const [a,g]=await Promise.all([tx.get(db.doc('kyrub_admin/control_plane/admins/'+identity.uid)),tx.get(db.doc('kyrub_admin/control_plane/privacy_rights_grants/'+identity.uid))]);
  if(a.get('uid')!==identity.uid||a.get('status')!=='active'||!['compliance','super_admin'].includes(a.get('role'))||g.get('uid')!==identity.uid||g.get('status')!=='active'||!Array.isArray(g.get('permissions'))||!g.get('permissions').includes('privacy:read')||!g.get('permissions').includes(permission)||permission==='privacy:triage'&&now-identity.auth_time*1000>5*60000)return deny();
  return {actorId:identity.uid,actorRole:a.get('role') as string};
 }
 function log(tx:Transaction,actor:{actorId:string;actorRole:string},action:string,now:number,fields:Record<string,unknown>){const id=randomUUID();tx.create(audit.doc(id),{id,...actor,action,createdAt:now,simulation:true,...fields});}
 function project(id:string,v:DocumentData|undefined,now:number){
  if(!uuid(id)||!v||v.protocol!==id||v.simulation!==true||v.status!=='received'||v.identityStatus!=='pending-verification'||v.actionStatus!=='not-executed'||!Number.isSafeInteger(v.receivedAt)||v.receivedAt<=0||v.receivedAt>now||!Number.isSafeInteger(v.revision)||v.revision<0||!['pending-review','verification-required'].includes(v.triageStatus))return deny();
  return {protocol:id,evidenceStatus:v.evidenceStatus==='account-control-confirmed'?'account-control-confirmed' as const:v.evidenceStatus==='cid-control-confirmed'?'cid-control-confirmed' as const:'awaiting-evidence' as const,draft:normalizePrivacyRequest(v.draft),receivedAt:v.receivedAt,revision:v.revision as number,triageStatus:v.triageStatus as 'pending-review'|'verification-required',identityStatus:'pending-verification' as const,actionStatus:'not-executed' as const};
 }
 return {
  async list(token:string,now:number){
   return db.runTransaction(async tx=>{
    const actor=await authorize(tx,token,now,'privacy:read'),rows=await tx.get(requests.orderBy('receivedAt','desc').limit(51));
    const items=rows.docs.slice(0,50).map(d=>project(d.id,d.data(),now));
    log(tx,actor,'privacy-intake-list',now,{count:items.length});return {items,hasMore:rows.size>50,simulation:true as const};
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
