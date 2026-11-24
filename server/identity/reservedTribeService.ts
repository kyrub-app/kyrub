import {FieldValue,FieldPath} from 'firebase-admin/firestore';
import {matchesTribeContactName} from '../../src/utils/tribeContactSearch.js';
import {adminDb} from '../firebaseAdmin.js';
import {createTribeVerifier,verifyTribeCode,failedTribeAttempt,tribeAttemptLocked,issueTribeSession,validTribeSession,validTribeCode,type TribeAttemptState,type TribeVerifier} from './reservedTribeSecurity.js';
/** Server-only foundation. No public route or UI is exposed until every contact surface is gated.
 * Callers must derive actor exclusively from verified authentication, never request body.
 */
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const MAX_RESERVED_CONTACTS=200;
const MAX_DIRECTORY_CONNECTIONS=1000;
function vault(actor:string){
 if(!validId(actor))throw Error('TRIBE_ACCESS_DENIED');
 return adminDb.doc('reserved_tribe_vaults/'+actor);
}
export async function initializeReservedTribe(actor:string,code:unknown){
 const reference=vault(actor);
 const verifier=await createTribeVerifier(code);
 await adminDb.runTransaction(async tx=>{
  const [account,existing]=await Promise.all([tx.get(adminDb.doc('users/'+actor)),tx.get(reference)]);
  if(!account.exists||existing.exists)throw Error('TRIBE_SETUP_UNAVAILABLE');
  tx.create(reference,{...verifier,failures:0,lockedUntil:0,sessionDigest:'',sessionExpiresAt:0,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
 });
}
export async function unlockReservedTribe(actor:string,code:unknown){
 const reference=vault(actor);
 if(!validTribeCode(code))return {ok:false as const};
 return adminDb.runTransaction(async tx=>{
  const snapshot=await tx.get(reference);
  if(!snapshot.exists)return {ok:false as const};
  const row=snapshot.data()!;
  const now=Date.now();
  const attempt:TribeAttemptState={failures:Number.isSafeInteger(row.failures)?row.failures:0,lockedUntil:Number.isSafeInteger(row.lockedUntil)?row.lockedUntil:0};
  if(tribeAttemptLocked(attempt,now))return {ok:false as const,lockedUntil:attempt.lockedUntil};
  const verifier:TribeVerifier={salt:typeof row.salt==='string'?row.salt:'',digest:typeof row.digest==='string'?row.digest:''};
  if(!await verifyTribeCode(code,verifier)){
   const next=failedTribeAttempt(attempt,now);
   tx.update(reference,{...next,updatedAt:FieldValue.serverTimestamp()});
   return {ok:false as const,...(next.lockedUntil?{lockedUntil:next.lockedUntil}:{})};
  }
  const session=issueTribeSession(Date.now());
  // One short-lived capability per account. A new unlock invalidates the previous session.
  tx.update(reference,{failures:0,lockedUntil:0,sessionDigest:session.digest,sessionExpiresAt:session.expiresAt,updatedAt:FieldValue.serverTimestamp()});
  return {ok:true as const,token:session.token,expiresAt:session.expiresAt};
 });
}
export async function hasReservedTribeSession(actor:string,token:unknown){
 const row=(await vault(actor).get()).data();
 return !!row&&validTribeSession(token,row.sessionDigest,row.sessionExpiresAt,Date.now());
}
export async function lockReservedTribe(actor:string){
 const reference=vault(actor);
 await adminDb.runTransaction(async tx=>{
  if((await tx.get(reference)).exists)tx.update(reference,{sessionDigest:'',sessionExpiresAt:0,updatedAt:FieldValue.serverTimestamp()});
 });
}

type Relationship={id:string;senderId:string;receiverId:string;participantIds:string[];status:'pending'|'accepted';senderName?:string;receiverName?:string;senderAvatar?:string;receiverAvatar?:string;senderRole?:string;receiverRole?:string;senderBio?:string;receiverBio?:string};
function relationship(snapshot:FirebaseFirestore.DocumentSnapshot,actor:string):Relationship|null{
 const row=snapshot.data();
 if(!row||!validId(snapshot.id)||!validId(row.senderId)||!validId(row.receiverId)||row.senderId===row.receiverId||
    ![row.senderId,row.receiverId].includes(actor)||!Array.isArray(row.participantIds)||row.participantIds.length!==2||
    !row.participantIds.includes(row.senderId)||!row.participantIds.includes(row.receiverId)||
    !['pending','accepted'].includes(row.status))return null;
 // Never return unknown fields or private account data.
 const result:Relationship={id:snapshot.id,senderId:row.senderId,receiverId:row.receiverId,participantIds:[row.senderId,row.receiverId],status:row.status};
 for(const field of ['senderName','receiverName','senderAvatar','receiverAvatar','senderRole','receiverRole','senderBio','receiverBio'] as const){
  if(typeof row[field]==='string')result[field]=row[field];
 }
 return result;
}
const peerOf=(actor:string,relation:Relationship)=>relation.senderId===actor?relation.receiverId:relation.senderId;
function requireSession(snapshot:FirebaseFirestore.DocumentSnapshot,token:unknown){
 const data=snapshot.data();
 if(!data||!validTribeSession(token,data.sessionDigest,data.sessionExpiresAt,Date.now()))throw Error('TRIBE_ACCESS_DENIED');
}
/** One private membership per peer, never a field on the shared connection.
 * The relationship, chat and counterpart's groups remain untouched.
 * Both supported connection ID orders are checked; a reserved peer stays
 * reserved even if the shared relationship is later removed/recreated.
 */
export async function setReservedTribeContact(actor:string,token:unknown,peer:unknown,reserved:unknown){
 const root=vault(actor);
 if(!validId(peer)||peer===actor||typeof reserved!=='boolean')throw Error('TRIBE_CONTACT_INVALID');
 return adminDb.runTransaction(async tx=>{
  const config=await tx.get(root);requireSession(config,token);
  const marker=root.collection('contacts').doc(peer);
  const current=await tx.get(marker);
  if(!reserved){
   requireSession(config,token);
   if(current.exists)tx.delete(marker);
   return {reserved:false};
  }
  const ids=[...new Set([actor+'_'+peer,peer+'_'+actor])].filter(validId);
  const records=await Promise.all(ids.map(id=>tx.get(adminDb.doc('connections/'+id))));
  const accepted=records.map(item=>relationship(item,actor)).find(item=>item?.status==='accepted'&&peerOf(actor,item)===peer);
  if(!accepted)throw Error('TRIBE_CONNECTION_REQUIRED');
  if(!current.exists){
   const members=await tx.get(root.collection('contacts').limit(MAX_RESERVED_CONTACTS+1));
   if(members.size>=MAX_RESERVED_CONTACTS)throw Error('TRIBE_LIMIT_REACHED');
   requireSession(config,token);
   tx.create(marker,{peerId:peer,createdAt:FieldValue.serverTimestamp()});
   // Once enrolled, require the server directory even after the last removal.
   tx.update(root,{directoryProtected:true,updatedAt:FieldValue.serverTimestamp()});
  }
  requireSession(config,token);
  return {reserved:true};
 });
}
/** Server-only directory projection. No protected IDs/counts are returned to
 * the ordinary list. The existing direct Firestore query is NOT yet replaced;
 * do not expose membership mutations until that migration is finished.
 */
async function projectTribeDirectory(actor:string,scope:'ordinary'|'reserved',token?:unknown){
 const root=vault(actor);
 return adminDb.runTransaction(async tx=>{
  const [account,config]=await Promise.all([tx.get(adminDb.doc('users/'+actor)),tx.get(root)]);
  if(!account.exists)throw Error('TRIBE_ACCESS_DENIED');
  if(scope==='reserved')requireSession(config,token);
  const [markers,connections,favorites,groups]=await Promise.all([
   tx.get(root.collection('contacts').limit(MAX_RESERVED_CONTACTS+1)),
   tx.get(adminDb.collection('connections').where('participantIds','array-contains',actor).limit(MAX_DIRECTORY_CONNECTIONS+1)),
   tx.get(adminDb.collection('users/'+actor+'/contact_favorites').limit(MAX_DIRECTORY_CONNECTIONS+1)),
   tx.get(adminDb.collection('users/'+actor+'/contact_groups').limit(31))
  ]);
  if(markers.size>MAX_RESERVED_CONTACTS||connections.size>MAX_DIRECTORY_CONNECTIONS||favorites.size>MAX_DIRECTORY_CONNECTIONS||groups.size>30)throw Error('TRIBE_DIRECTORY_LIMIT');
  const hidden=new Set(markers.docs.map(item=>item.id));
  const filtered=connections.docs.flatMap(item=>{
   const relation=relationship(item,actor);
   if(!relation)return [];
   const isReserved=hidden.has(peerOf(actor,relation));
   return scope==='reserved'?(isReserved&&relation.status==='accepted'?[relation]:[]):(!isReserved?[relation]:[]);
  });
  const acceptedPeers=new Set(filtered.filter(item=>item.status==='accepted').map(item=>peerOf(actor,item)));
  const favoriteIds=favorites.docs.filter(item=>acceptedPeers.has(item.id)&&item.get('favorited')===true).map(item=>item.id);
  const tribes=scope==='ordinary'?groups.docs.flatMap(item=>{
   const data=item.data();
   if(data.ownerId!==actor||typeof data.name!=='string'||!Array.isArray(data.memberIds))return [];
   return [{id:item.id,name:data.name,memberIds:[...new Set<string>(data.memberIds.filter((id:unknown):id is string=>validId(id)&&acceptedPeers.has(id)))]}];
  }):[];
  const forwardTargets=scope==='ordinary'?filtered.filter(item=>item.status==='accepted').map(item=>({connectionId:item.id,peerId:peerOf(actor,item)})):[];
  if(scope==='reserved')requireSession(config,token);
  return {connections:filtered,favoriteIds,tribes,forwardTargets};
 });
}
export const getOrdinaryTribeDirectory=(actor:string)=>projectTribeDirectory(actor,'ordinary');
export const getReservedTribeDirectory=(actor:string,token:unknown)=>projectTribeDirectory(actor,'reserved',token);
export const listOrdinaryTribeConnections=async(actor:string)=>(await getOrdinaryTribeDirectory(actor)).connections;
export const listReservedTribeConnections=async(actor:string,token:unknown)=>(await getReservedTribeDirectory(actor,token)).connections;

/** Ordinary forwarding may never target a reserved peer, even when unlocked.
 * Call from the same transaction as the forwarding write.
 */
export async function authorizeOrdinaryForward(tx:FirebaseFirestore.Transaction,actor:string,connectionId:string){
 return authorizeTribeRelationship(tx,actor,connectionId);
}

/** Use for server chat/directory operations after verified auth, in the same
 * transaction as the operation. A public relationship is not permission
 * to access this actor's reserved conversations without the vault capability.
 */
export async function authorizeTribeRelationship(tx:FirebaseFirestore.Transaction,actor:string,connectionId:string,token?:unknown){
 const root=vault(actor);
 if(!validId(connectionId))throw Error('TRIBE_ACCESS_DENIED');
 const reference=adminDb.doc('connections/'+connectionId);
 const relation=relationship(await tx.get(reference),actor);
 if(!relation||relation.status!=='accepted')throw Error('TRIBE_ACCESS_DENIED');
 const peer=peerOf(actor,relation);
 const [marker,ownBlock,otherBlock]=await Promise.all([
  tx.get(root.collection('contacts').doc(peer)),
  tx.get(adminDb.doc('social_contact_blocks/'+actor+'/blocked/'+peer)),
  tx.get(adminDb.doc('social_contact_blocks/'+peer+'/blocked/'+actor))
 ]);
 if(ownBlock.exists||otherBlock.exists)throw Error('TRIBE_ACCESS_DENIED');
 if(marker.exists)requireSession(await tx.get(root),token);
 return relation;
}

/** Server-only notification policy, read in the same transaction as inbox or
 * read-state changes. Never return private marker IDs to the browser.
 */
export async function readReservedTribeNotificationScope(tx:FirebaseFirestore.Transaction,actor:string,token?:unknown){
 const root=vault(actor);
 const [config,markers]=await Promise.all([tx.get(root),tx.get(root.collection('contacts').limit(MAX_RESERVED_CONTACTS+1))]);
 if(markers.size>MAX_RESERVED_CONTACTS)throw Error('TRIBE_DIRECTORY_LIMIT');
 if(token!==undefined)requireSession(config,token);
 return {protectedDirectory:config.get('directoryProtected')===true,peers:new Set(markers.docs.map(item=>item.id))};
}

/** Search only public suggestions eligible for this actor, never return hidden
 * IDs, account emails, phone numbers or full Firestore documents. This replaces
 * the old suggestion derivation from an unfiltered users snapshot once wired.
 * Ordinary search has no secret-code parameter and is never an unlock attempt.
 */
export async function searchOrdinaryTribeSuggestions(actor:string,search:unknown,requestedLimit=30){
 const root=vault(actor);
 if(typeof search!=='string'||search.length>128||!Number.isSafeInteger(requestedLimit)||requestedLimit<1||requestedLimit>50)throw Error('TRIBE_SEARCH_INVALID');
 return adminDb.runTransaction(async tx=>{
  const [account,markers,connections,ownBlocks]=await Promise.all([
   tx.get(adminDb.doc('users/'+actor)),
   tx.get(root.collection('contacts').limit(MAX_RESERVED_CONTACTS+1)),
   tx.get(adminDb.collection('connections').where('participantIds','array-contains',actor).limit(MAX_DIRECTORY_CONNECTIONS+1)),
   tx.get(adminDb.collection('social_contact_blocks/'+actor+'/blocked').limit(MAX_DIRECTORY_CONNECTIONS+1))
  ]);
  if(!account.exists)throw Error('TRIBE_ACCESS_DENIED');
  if(markers.size>MAX_RESERVED_CONTACTS||connections.size>MAX_DIRECTORY_CONNECTIONS||ownBlocks.size>MAX_DIRECTORY_CONNECTIONS)throw Error('TRIBE_DIRECTORY_LIMIT');
  const hidden=new Set([actor,...markers.docs.map(item=>item.id),...ownBlocks.docs.map(item=>item.id)]);
  const outgoing=new Map<string,Relationship>();
  for(const item of connections.docs){
   const relation=relationship(item,actor);if(!relation)continue;
   const peer=peerOf(actor,relation);
   if(relation.status==='accepted'||relation.receiverId===actor)hidden.add(peer);
   else outgoing.set(peer,relation);
  }
  const matches:Array<{id:string;name:string;avatar:string;role:string;connectionStatus:'none'|'pending_sent';connectionId?:string}>=[];
  const directory=adminDb.collection('users').where('isProfileVisible','==',true).orderBy(FieldPath.documentId());
  let cursor:FirebaseFirestore.QueryDocumentSnapshot|undefined;
  // Bounded scan is intentionally conservative. A dedicated indexed directory
  // is needed for scale; returning a partial page is preferable to a leak.
  for(let pageIndex=0;pageIndex<10&&matches.length<requestedLimit;pageIndex++){
   const page=await tx.get((cursor?directory.startAfter(cursor):directory).limit(100));
   const eligible=page.docs.filter(doc=>{
    const name=doc.get('name');
    return validId(doc.id)&&!hidden.has(doc.id)&&typeof name==='string'&&!!name.trim()&&matchesTribeContactName(name,search);
   });
   // Inspect reverse blocks only for eligible profiles; the other direction
   // was excluded by the actor's own marker collection above.
   for(const doc of eligible){
    if(matches.length>=requestedLimit)break;
    const blocked=await tx.get(adminDb.doc('social_contact_blocks/'+doc.id+'/blocked/'+actor));
    if(blocked.exists)continue;
    const pending=outgoing.get(doc.id);
    const avatar=doc.get('photoUrl'),role=doc.get('role');
    matches.push({id:doc.id,name:String(doc.get('name')).slice(0,160),avatar:typeof avatar==='string'?avatar.slice(0,2048):'',role:typeof role==='string'?role.slice(0,60):'Kairubido',connectionStatus:pending?'pending_sent':'none',...(pending?{connectionId:pending.id}:{})});
   }
   if(page.size<100)break;
   cursor=page.docs[page.size-1];
  }
  return matches;
 });
}

/** Used by the isolated pilot only. No contact IDs or secret material. */
export async function getReservedTribeSetupStatus(actor:string){
 const root=vault(actor);
 return adminDb.runTransaction(async tx=>{
  const [account,config]=await Promise.all([tx.get(adminDb.doc('users/'+actor)),tx.get(root)]);
  if(!account.exists)throw Error('TRIBE_ACCESS_DENIED');
  return {configured:config.exists,directoryProtected:config.get('directoryProtected')===true};
 });
}
export async function lockReservedTribeSession(actor:string,token:unknown){
 const root=vault(actor);
 return adminDb.runTransaction(async tx=>{
  const config=await tx.get(root);
  if(!config.exists)return {locked:true as const};
  // A stale browser tab cannot invalidate a newer unlock.
  if(!validTribeSession(token,config.get('sessionDigest'),config.get('sessionExpiresAt'),Date.now()))return {locked:true as const};
  tx.update(root,{sessionDigest:'',sessionExpiresAt:0,updatedAt:FieldValue.serverTimestamp()});
  return {locked:true as const};
 });
}
