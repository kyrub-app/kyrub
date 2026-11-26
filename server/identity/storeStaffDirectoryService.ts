import type {Firestore} from 'firebase-admin/firestore';
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
  const storeRef=db.doc('stores/'+storeId);
  const store=(await tx.get(storeRef)).data();
  if(!store||store.id!==storeId||!isDocumentId(store.ownerId))throw Error('STAFF_DIRECTORY_FORBIDDEN');
  if(store.ownerId!==actorUid){
   const member=(await tx.get(storeRef.collection('members').doc(actorUid))).data();
   if(member?.storeId!==storeId||member.userId!==actorUid||member.status!=='active'||member.role!=='manager'||requestedRole==='manager')
    throw Error('STAFF_DIRECTORY_FORBIDDEN');
  }
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
