import {FieldValue,type Firestore,type Transaction} from 'firebase-admin/firestore';
import {isDocumentId} from './publicSocialAddressPolicy.js';

const validRole=(role:unknown)=>['manager','cashier','seller','production'].includes(String(role));
const clean=(value:unknown,max:number)=>typeof value==='string'?value.trim().slice(0,max):'';

/** Internal read-only service; no public transport. Caller must authenticate
 * actor (revocation checked), enforce quotas and never log search terms.
 * Existing store role/age checks remain mandatory on invitation writes. */
export async function searchStoreStaffDirectory(db:Firestore,actorUid:string,storeId:string,term:string,requestedRole:string){
 if(!isDocumentId(actorUid)||!isDocumentId(storeId)||typeof term!=='string'||term.trim().length<3||term.trim().length>254||!validRole(requestedRole))
  throw Error('STAFF_DIRECTORY_INVALID');
 const search=term.trim();
 const byEmail=search.includes('@');
 if(byEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(search))throw Error('STAFF_DIRECTORY_INVALID');
 return db.runTransaction(async tx=>{
  const {storeRef,store}=await requireStaffInviteAuthority(db,tx,actorUid,storeId,requestedRole);
  let query=db.collection('users').where(byEmail?'email':'name','==',byEmail?search.toLowerCase():search);
  // An exact contact address allows an intentional invitation even when social
  // discovery is off. Name lookup only discovers explicitly visible accounts.
  if(!byEmail)query=query.where('isProfileVisible','==',true);
  const matches=await tx.get(query.select('uid','name','photoUrl','isProfileVisible').limit(10));
  const candidates=matches.docs.filter(doc=>doc.id!==actorUid&&doc.id!==store.ownerId&&isDocumentId(doc.id)&&doc.data().uid===doc.id);
  const existing=await Promise.all(candidates.map(doc=>tx.get(storeRef.collection('members').doc(doc.id))));
  return candidates.flatMap((doc,i)=>{
   if(existing[i].exists)return [];
   const data=doc.data();
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

/** Internal trusted invitation writer. No HTTP route or client activation.
 * Caller authenticates actor with revocation check and applies quota controls.
 * Revalidate the original exact lookup and role inside the creation transaction.
 * No contact data or private profile presentation is copied to the membership. */
export async function createStoreStaffInvitation(db:Firestore,actorUid:string,storeId:string,targetUid:string,term:string,requestedRole:string){
 if(!isDocumentId(actorUid)||!isDocumentId(storeId)||!isDocumentId(targetUid)||actorUid===targetUid||
    typeof term!=='string'||term.trim().length<3||term.trim().length>254||!validRole(requestedRole))
  throw Error('STAFF_DIRECTORY_INVALID');
 const search=term.trim(),byEmail=search.includes('@');
 if(byEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(search))throw Error('STAFF_DIRECTORY_INVALID');
 return db.runTransaction(async tx=>{
  const {storeRef,store}=await requireStaffInviteAuthority(db,tx,actorUid,storeId,requestedRole);
  if(targetUid===store.ownerId)throw Error('STAFF_DIRECTORY_FORBIDDEN');
  const targetRef=db.doc('users/'+targetUid),memberRef=storeRef.collection('members').doc(targetUid);
  const [targetSnapshot,member,control]=await Promise.all([
   tx.get(targetRef),tx.get(memberRef),tx.get(db.doc('erp_age_release_private/current'))
  ]);
  const target=targetSnapshot.data();
  if(!target||target.uid!==targetUid||
     (byEmail?target.email!==search.toLowerCase():target.name!==search||target.isProfileVisible!==true))
   throw Error('STAFF_DIRECTORY_FORBIDDEN');
  if(control.exists){
   const config=control.data();
   if(config?.schemaVersion!==1||config.mode!=='verified_adult_only')throw Error('STAFF_DIRECTORY_AGE_REQUIRED');
   const ages=await Promise.all([actorUid,targetUid].map(uid=>tx.get(db.doc('age_eligibility_private/'+uid))));
   if(ages.some((snapshot,index)=>snapshot.data()?.uid!==[actorUid,targetUid][index]||snapshot.data()?.status!=='verified_adult'))
    throw Error('STAFF_DIRECTORY_AGE_REQUIRED');
  }
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
