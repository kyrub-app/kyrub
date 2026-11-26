import type {Auth} from 'firebase-admin/auth';
import {FieldValue,type Firestore} from 'firebase-admin/firestore';
import {isDocumentId} from './publicSocialAddressPolicy.js';

const allowedRoles=new Set(['super_admin','support','operations','compliance']);
const clean=(v:unknown,max:number)=>typeof v==='string'?v.trim().slice(0,max):'';
const timestamp=(v:unknown)=>{
 if(typeof v==='string')return clean(v,64);
 if(v&&typeof v==='object'&&'toDate' in v&&typeof v.toDate==='function')return v.toDate().toISOString();
 return '';
};

/** Internal identity-only lookup. The caller must verify session revocation,
 * enforce MFA and quotas before production exposure. No finance or AI reads.
 * Firestore transaction rechecks the admin grant and persists the audit before
 * returning a result. No raw search term is stored. */
export async function lookupAdminDirectoryIdentity(db:Firestore,auth:Auth,actorUid:string,raw:unknown){
 if(!isDocumentId(actorUid)||typeof raw!=='string')throw Error('ADMIN_DIRECTORY_INVALID');
 const value=raw.trim(),byEmail=value.includes('@');
 if(byEmail?(value.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)):!isDocumentId(value))
  throw Error('ADMIN_DIRECTORY_INVALID');
 const adminRef=db.doc('kyrub_admin/control_plane/admins/'+actorUid);
 const grant=(await adminRef.get()).data();
 if(grant?.uid!==actorUid||grant.status!=='active'||!allowedRoles.has(grant.role))
  throw Error('ADMIN_DIRECTORY_FORBIDDEN');
 let target;
 try{target=await (byEmail?auth.getUserByEmail(value.toLowerCase()):auth.getUser(value));}
 catch(error){if((error as {code?:string}).code!=='auth/user-not-found')throw error;}
 const targetUid=target?.uid;
 if(targetUid!==undefined&&!isDocumentId(targetUid))throw Error('ADMIN_DIRECTORY_UNAVAILABLE');
 return db.runTransaction(async tx=>{
  const current=(await tx.get(adminRef)).data();
  if(current?.uid!==actorUid||current.status!=='active'||!allowedRoles.has(current.role))
   throw Error('ADMIN_DIRECTORY_FORBIDDEN');
  const account=targetUid?(await tx.get(db.doc('users/'+targetUid))).data():undefined;
  const user=account&&account.uid===targetUid&&target?{
   uid:target.uid,name:clean(account.name,160),email:clean(target.email,254).toLowerCase(),
   photoUrl:/^https:\/\//i.test(clean(account.photoUrl,2048))?clean(account.photoUrl,2048):'',
   isProfileVisible:account.isProfileVisible===true,createdAt:timestamp(account.createdAt),updatedAt:timestamp(account.updatedAt)
  }:null;
  const auditRef=db.collection('kyrub_admin/control_plane/audit_logs').doc();
  tx.create(auditRef,{id:auditRef.id,action:'admin.directory.user.searched',actorId:actorUid,
   actorRole:current.role,targetType:user?'user':'control_plane',targetId:user?.uid||'admin_directory',
   source:'server',outcome:user?'found':'not_found',createdAt:FieldValue.serverTimestamp()});
  return user;
 });
}
