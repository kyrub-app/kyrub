import {FieldValue,type Firestore,type Transaction} from 'firebase-admin/firestore';
import {isDocumentId} from './publicSocialAddressPolicy.js';

type VerifiedIdentity={uid:string;emailVerified:boolean;disabled:boolean};
export type StaffIdentityAuthority={
 getUserByEmail(email:string):Promise<VerifiedIdentity>;
 getUser(uid:string):Promise<VerifiedIdentity>;
};
const validRole=(role:unknown)=>typeof role==='string'&&['manager','cashier','seller','production'].includes(role);
async function resolveVerifiedIdentity(auth:StaffIdentityAuthority,lookup:string,byEmail:boolean){
 try{
  const identity=await (byEmail?auth.getUserByEmail(lookup.toLowerCase()):auth.getUser(lookup));
  return isDocumentId(identity.uid)&&identity.emailVerified===true&&!identity.disabled?identity.uid:null;
 }catch(error){
  if((error as {code?:string}).code==='auth/user-not-found')return null;
  throw error;
 }
}
const clean=(value:unknown,max:number)=>typeof value==='string'?value.trim().slice(0,max):'';

/** Internal read-only service; no public transport. Caller must authenticate
 * actor (revocation checked), enforce quotas and never log search terms.
 * Existing store role/age checks remain mandatory on invitation writes. */
export async function searchStoreStaffDirectory(db:Firestore,auth:StaffIdentityAuthority,actorUid:string,storeId:string,term:string,requestedRole:string){
 if(!isDocumentId(actorUid)||!isDocumentId(storeId)||typeof term!=='string'||term.trim().length<3||term.trim().length>254||!validRole(requestedRole))
  throw Error('STAFF_DIRECTORY_INVALID');
 const search=term.trim();
 const byEmail=search.includes('@');
 if(byEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(search))throw Error('STAFF_DIRECTORY_INVALID');
 return db.runTransaction(async tx=>{
  const {storeRef,store}=await requireStaffInviteAuthority(db,tx,actorUid,storeId,requestedRole);
  // Auth, never a writable account email, resolves the intended recipient.
  const verifiedUid=byEmail?await resolveVerifiedIdentity(auth,search,true):null;
  if(byEmail&&!verifiedUid)return [];
  const matches=byEmail?[await tx.get(db.doc('users/'+verifiedUid))]:
   (await tx.get(db.collection('users').where('name','==',search).where('isProfileVisible','==',true)
    .select('uid','name','photoUrl','isProfileVisible').limit(10))).docs;
  const candidates=matches.flatMap(doc=>{
   const data=doc.data();
   return data&&doc.id!==actorUid&&doc.id!==store.ownerId&&isDocumentId(doc.id)&&data.uid===doc.id?
    [{id:doc.id,data}]:[];
  });
  const verified=byEmail?candidates:(await Promise.all(candidates.map(async candidate=>
    await resolveVerifiedIdentity(auth,candidate.id,false)===candidate.id?candidate:null))).filter(candidate=>candidate!==null);
  const existing=await Promise.all(verified.map(doc=>tx.get(storeRef.collection('members').doc(doc.id))));
  return verified.flatMap((doc,i)=>{
   if(existing[i].exists)return [];
   const data=doc.data;
   const visible=data.isProfileVisible===true;
   return [{uid:doc.id,name:visible?(clean(data.name,160)||'Kairubido'):'Conta Kyrub',
    photoUrl:visible&&/^https:\/\//i.test(clean(data.photoUrl,2048))?clean(data.photoUrl,2048):''}];
  });
 },{readOnly:true});
}

async function requireStaffInviteAuthority(db:Firestore,tx:Transaction,actorUid:string,storeId:string,requestedRole:string){
 const storeRef=db.doc('stores/'+storeId);
 const store=(await tx.get(storeRef)).data();
 if(!store||store.id!==storeId||!isDocumentId(store.ownerId)||!validRole(requestedRole))throw Error('STAFF_DIRECTORY_FORBIDDEN');
 if(store.ownerId!==actorUid){
  const member=(await tx.get(storeRef.collection('members').doc(actorUid))).data();
  if(member?.storeId!==storeId||member.userId!==actorUid||member.status!=='active'||member.role!=='manager'||requestedRole==='manager')
   throw Error('STAFF_DIRECTORY_FORBIDDEN');
 }
 return {storeRef,store};
}

/** Trusted invitation writer. Release is controlled by the transport.
 * Caller authenticates actor with revocation check and applies quota controls.
 * Revalidate the original exact lookup and role inside the creation transaction.
 * No contact data or private profile presentation is copied to the membership. */
export async function createStoreStaffInvitation(db:Firestore,auth:StaffIdentityAuthority,actorUid:string,storeId:string,targetUid:string,term:string,requestedRole:string){
 if(!isDocumentId(actorUid)||!isDocumentId(storeId)||!isDocumentId(targetUid)||actorUid===targetUid||
    typeof term!=='string'||term.trim().length<3||term.trim().length>254||!validRole(requestedRole))
  throw Error('STAFF_DIRECTORY_INVALID');
 const search=term.trim(),byEmail=search.includes('@');
 if(byEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(search))throw Error('STAFF_DIRECTORY_INVALID');
 return db.runTransaction(async tx=>{
  const {storeRef,store}=await requireStaffInviteAuthority(db,tx,actorUid,storeId,requestedRole);
  if(targetUid===store.ownerId||await resolveVerifiedIdentity(auth,byEmail?search:targetUid,byEmail)!==targetUid)throw Error('STAFF_DIRECTORY_FORBIDDEN');
  const targetRef=db.doc('users/'+targetUid),memberRef=storeRef.collection('members').doc(targetUid);
  const [targetSnapshot,member,control]=await Promise.all([
   tx.get(targetRef),tx.get(memberRef),tx.get(db.doc('erp_age_release_private/current'))
  ]);
  const target=targetSnapshot.data();
  if(!target||target.uid!==targetUid||
     (!byEmail&&(target.name!==search||target.isProfileVisible!==true)))
   throw Error('STAFF_DIRECTORY_FORBIDDEN');
  // The protected writer never inherits the legacy permissive default.
  // Both the explicit release and the two current private records are mandatory.
  const config=control.data();
  if(!control.exists||config?.schemaVersion!==1||config.mode!=='verified_adult_only')
   throw Error('STAFF_DIRECTORY_AGE_REQUIRED');
  const ages=await Promise.all([actorUid,targetUid].map(uid=>tx.get(db.doc('age_eligibility_private/'+uid))));
  if(ages.some((snapshot,index)=>snapshot.data()?.uid!==[actorUid,targetUid][index]||snapshot.data()?.status!=='verified_adult'))
   throw Error('STAFF_DIRECTORY_AGE_REQUIRED');
  if(member.exists)throw Error('STAFF_INVITATION_EXISTS');
  const visible=target.isProfileVisible===true;
  const photo=clean(target.photoUrl,2048);
  const timestamp=FieldValue.serverTimestamp();
  tx.create(memberRef,{
   storeId,storeName:clean(store.name,160),userId:targetUid,
   displayName:visible?(clean(target.name,160)||'Kairubido'):'Conta Kyrub',
   email:'',photoUrl:visible&&/^https:\/\//i.test(photo)?photo:'',
   role:requestedRole,status:'invited',invitedBy:actorUid,
   invitedAt:timestamp,acceptedAt:'',suspendedAt:'',removedAt:'',createdAt:timestamp,updatedAt:timestamp
  });
  return {status:'invited' as const,userId:targetUid};
 });
}
