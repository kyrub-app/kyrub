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
function socialRevisionRef(actor:string){
 if(!validId(actor))throw Error('TRIBE_ACCESS_DENIED');
 return adminDb.doc('social_directory_revisions/'+actor);
}
/** Integration contract: call AFTER all reads, in the SAME transaction as a
 * committed social block/unblock (or relationship change). Both perspectives
 * become stale, including accounts that have never configured a reserved vault.
 * No peer IDs, block direction or secret state are stored in the revision.
 */
export function invalidateSocialPair(tx:FirebaseFirestore.Transaction,actor:string,peer:string){
 if(!validId(actor)||!validId(peer)||actor===peer)throw Error('TRIBE_CONTACT_INVALID');
 for(const uid of [actor,peer]){
  tx.set(socialRevisionRef(uid),{revision:FieldValue.increment(1)},{merge:true});
 }
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
   if(current.exists){tx.delete(marker);tx.update(root,{directoryRevision:FieldValue.increment(1),updatedAt:FieldValue.serverTimestamp()});}
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
   tx.update(root,{directoryProtected:true,directoryRevision:FieldValue.increment(1),updatedAt:FieldValue.serverTimestamp()});
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
  const [account,config,socialRevision]=await Promise.all([tx.get(adminDb.doc('users/'+actor)),tx.get(root),tx.get(socialRevisionRef(actor))]);
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
  const eligible=connections.docs.flatMap(item=>{
   const relation=relationship(item,actor);
   if(!relation)return [];
   const isReserved=hidden.has(peerOf(actor,relation));
   return scope==='reserved'?(isReserved&&relation.status==='accepted'?[relation]:[]):(!isReserved?[relation]:[]);
  });
  // A stale relationship may survive a legacy or concurrent block operation.
  // Never expose its identity, favorite, group membership or forwarding target.
  // Read both directions in the SAME projection transaction. Deduplicate
  // peers and batch reads, keeping the existing bounded directory scan.
  const peers=[...new Set(eligible.map(item=>peerOf(actor,item)))];
  const blocked=new Set<string>();
  for(let offset=0;offset<peers.length;offset+=100){
   const batch=peers.slice(offset,offset+100);
   const refs=batch.flatMap(peer=>[
    adminDb.doc('social_contact_blocks/'+actor+'/blocked/'+peer),
    adminDb.doc('social_contact_blocks/'+peer+'/blocked/'+actor)
   ]);
   const rows=await tx.getAll(...refs);
   batch.forEach((peer,index)=>{if(rows[index*2].exists||rows[index*2+1].exists)blocked.add(peer);});
  }
  const filtered=eligible.filter(item=>!blocked.has(peerOf(actor,item)));
  const acceptedPeers=new Set(filtered.filter(item=>item.status==='accepted').map(item=>peerOf(actor,item)));
  const favoriteIds=favorites.docs.filter(item=>acceptedPeers.has(item.id)&&item.get('favorited')===true).map(item=>item.id);
  const tribes=scope==='ordinary'?groups.docs.flatMap(item=>{
   const data=item.data();
   if(data.ownerId!==actor||typeof data.name!=='string'||!Array.isArray(data.memberIds))return [];
   return [{id:item.id,name:data.name,memberIds:[...new Set<string>(data.memberIds.filter((id:unknown):id is string=>validId(id)&&acceptedPeers.has(id)))]}];
  }):[];
  const forwardTargets=scope==='ordinary'?filtered.filter(item=>item.status==='accepted').map(item=>({connectionId:item.id,peerId:peerOf(actor,item)})):[];
  if(scope==='reserved')requireSession(config,token);
  return {connections:filtered,favoriteIds,tribes,forwardTargets,revision:directoryRevision(config,socialRevision)};
 });
}
export const getOrdinaryTribeDirectory=(actor:string)=>projectTribeDirectory(actor,'ordinary');
export const getReservedTribeDirectory=(actor:string,token:unknown)=>projectTribeDirectory(actor,'reserved',token);
export const listOrdinaryTribeConnections=async(actor:string)=>(await getOrdinaryTribeDirectory(actor)).connections;
export const listReservedTribeConnections=async(actor:string,token:unknown)=>(await getReservedTribeDirectory(actor,token)).connections;

/** Common integration boundary for ordinary relationship lookups/mutations
 * from a public profile, Kyrub Tag, contact card or other server entrypoint.
 * Call inside the SAME transaction before reading/returning relationship data
 * or writing anything; target must already be resolved and actor verified.
 * False deliberately conflates unavailable, self, blocked and reserved.
 * The caller must not disclose why. Never examine the counterpart's vault.
 */
export async function ordinaryPresentationPeerAllowed(tx:FirebaseFirestore.Transaction,actor:string,peer:unknown):Promise<boolean>{
 if(!validId(actor)||!validId(peer)||peer===actor)return false;
 const [marker,ownBlock,otherBlock]=await Promise.all([
  tx.get(vault(actor).collection('contacts').doc(peer)),
  tx.get(adminDb.doc('social_contact_blocks/'+actor+'/blocked/'+peer)),
  tx.get(adminDb.doc('social_contact_blocks/'+peer+'/blocked/'+actor))
 ]);
 return !marker.exists&&!ownBlock.exists&&!otherBlock.exists;
}

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
 if(marker.exists){requireSession(await tx.get(root),token);}
 else if(token!==undefined)throw Error('TRIBE_ACCESS_DENIED');
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

const directoryRevision=(snapshot:FirebaseFirestore.DocumentSnapshot,social:FirebaseFirestore.DocumentSnapshot):number=>{
 // Both counters are monotonic; their sum changes for either kind of
 // invalidation and keeps the existing numeric transport contract.
 const read=(value:unknown):number=>{
  if(value===undefined)return 0;
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw Error('TRIBE_ACCESS_DENIED');
  return value;
 };
 const total=read(snapshot.get('directoryRevision'))+read(social.get('revision'));
 if(!Number.isSafeInteger(total))throw Error('TRIBE_ACCESS_DENIED');
 return total;
};
/** Used by the isolated pilot only. No contact IDs or secret material. */
export async function getReservedTribeSetupStatus(actor:string){
 const root=vault(actor);
 return adminDb.runTransaction(async tx=>{
  const [account,config,socialRevision]=await Promise.all([tx.get(adminDb.doc('users/'+actor)),tx.get(root),tx.get(socialRevisionRef(actor))]);
  if(!account.exists)throw Error('TRIBE_ACCESS_DENIED');
  return {configured:config.exists,directoryProtected:config.get('directoryProtected')===true,revision:directoryRevision(config,socialRevision)};
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

/** Ordinary block/unblock contract for the presentation integration.
 * Like PR #1273, block removes matching shared connections, not messages.
 * A reserved target in the actor's own vault is not accessible through this
 * ordinary operation. Never read the counterpart's reservation marker.
 * Unblocking never recreates a relationship. The dedicated reserved action
 * and blocked-list UI are deliberately outside this contract.
 */
export async function setOrdinarySocialContactBlock(actor:string,peer:unknown,blocked:unknown){
 const root=vault(actor);
 if(!validId(peer)||peer===actor||typeof blocked!=='boolean')throw Error('TRIBE_CONTACT_INVALID');
 const own=adminDb.doc('social_contact_blocks/'+actor+'/blocked/'+peer);
 const ids=[...new Set([actor+'_'+peer,peer+'_'+actor])].filter(validId);
 return adminDb.runTransaction(async tx=>{
  const [account,identity,marker,existing,target,...records]=await Promise.all([
   tx.get(adminDb.doc('users/'+actor)),
   tx.get(adminDb.doc('kyrub_tag_minimal_identities/'+actor)),
   tx.get(root.collection('contacts').doc(peer)),
   tx.get(own),tx.get(adminDb.doc('users/'+peer)),
   ...ids.map(id=>tx.get(adminDb.doc('connections/'+id)))
  ]);
  if(!account.exists||identity.get('mode')==='tag_only'||marker.exists)throw Error('TRIBE_ACCESS_DENIED');
  if(!blocked){
   if(existing.exists){tx.delete(own);invalidateSocialPair(tx,actor,peer);}
   return {blocked:false};
  }
  if(!target.exists&&!existing.exists)throw Error('TRIBE_ACCESS_DENIED');
  const matching=records.filter(record=>{
   const relation=relationship(record,actor);
   return relation!==null&&peerOf(actor,relation)===peer;
  });
  if(!existing.exists){
   const name=target.get('name');
   tx.create(own,{targetId:peer,name:typeof name==='string'&&name.trim()?name.trim().slice(0,160):'Kairubido',createdAt:FieldValue.serverTimestamp()});
  }
  for(const record of matching)tx.delete(record.ref);
  if(!existing.exists||matching.length)invalidateSocialPair(tx,actor,peer);
  return {blocked:true};
 });
}

/** Ordinary mutations never grant access to a reserved peer. The other
 * participant's privacy classification is independent of the actor's. */
export async function mutateOrdinaryConnection(actor:string,peer:unknown,operation:unknown){
 const root=vault(actor);
 if(!validId(peer)||peer===actor||!['request','accept','remove'].includes(String(operation)))throw Error('TRIBE_CONTACT_INVALID');
 const canonical=[actor,peer].sort().join('_');
 const ids=[...new Set([canonical,peer+'_'+actor,actor+'_'+peer])].filter(validId);
 if(!validId(canonical))throw Error('TRIBE_CONTACT_INVALID');
 return adminDb.runTransaction(async tx=>{
  const [account,target,marker,ownBlock,reverseBlock,...pairs]=await Promise.all([
   tx.get(adminDb.doc('users/'+actor)),tx.get(adminDb.doc('users/'+peer)),
   tx.get(root.collection('contacts').doc(peer)),
   tx.get(adminDb.doc('social_contact_blocks/'+actor+'/blocked/'+peer)),
   tx.get(adminDb.doc('social_contact_blocks/'+peer+'/blocked/'+actor)),
   ...ids.map(id=>tx.get(adminDb.doc('connections/'+id)))
  ]);
  if(!account.exists||marker.exists)throw Error('TRIBE_ACCESS_DENIED');
  const existing=pairs.filter(snap=>snap.exists);
  if(existing.length>1)throw Error('TRIBE_ACCESS_DENIED');
  const record=existing[0];
  const relation=record?relationship(record,actor):null;
  if(record&&(!relation||peerOf(actor,relation)!==peer))throw Error('TRIBE_ACCESS_DENIED');
  if(operation==='remove'){
   if(record){tx.delete(record.ref);invalidateSocialPair(tx,actor,peer);}
   return {status:'none'};
  }
  if(!target.exists||ownBlock.exists||reverseBlock.exists)throw Error('TRIBE_ACCESS_DENIED');
  if(operation==='accept'){
   if(relation?.status==='accepted')return {status:'accepted'};
   if(!record||relation?.status!=='pending'||relation.receiverId!==actor)throw Error('TRIBE_ACCESS_DENIED');
   tx.update(record.ref,{status:'accepted',acceptedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
   invalidateSocialPair(tx,actor,peer);
   return {status:'accepted'};
  }
  if(relation)return {status:relation.status};
  if(target.get('isProfileVisible')!==true)throw Error('TRIBE_ACCESS_DENIED');
  const name=(snap:FirebaseFirestore.DocumentSnapshot)=>typeof snap.get('name')==='string'?String(snap.get('name')).slice(0,160):'Kairubido';
  const avatar=(snap:FirebaseFirestore.DocumentSnapshot)=>snap.get('isProfileVisible')===true&&typeof snap.get('photoUrl')==='string'?String(snap.get('photoUrl')).slice(0,2048):'';
  tx.create(adminDb.doc('connections/'+canonical),{senderId:actor,receiverId:peer,participantIds:[actor,peer].sort(),status:'pending',senderName:name(account),receiverName:name(target),senderAvatar:avatar(account),receiverAvatar:avatar(target),createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
  invalidateSocialPair(tx,actor,peer);
  return {status:'pending'};
 });
}
export async function setOrdinaryTribeFavorite(actor:string,connectionId:unknown,favorited:unknown){
 vault(actor);
 if(!validId(connectionId)||typeof favorited!=='boolean')throw Error('TRIBE_CONTACT_INVALID');
 return adminDb.runTransaction(async tx=>{
  const relation=await authorizeTribeRelationship(tx,actor,connectionId);
  const reference=adminDb.doc('users/'+actor+'/contact_favorites/'+peerOf(actor,relation));
  if(favorited)tx.set(reference,{connectionId,favorited:true,updatedAt:FieldValue.serverTimestamp()});
  else tx.delete(reference);
  return {favorited};
 });
}

/** Keep the original private group schema. Use explicit desired membership,
 * not a replacement of the projected member list or a blind toggle.
 * This preserves hidden members and concurrent updates. */
export async function createOrdinaryTribe(actor:string,groupId:unknown,name:unknown){
 vault(actor);
 if(!validId(groupId)||typeof name!=='string'||!name.trim()||name.trim().length>60)throw Error('TRIBE_CONTACT_INVALID');
 const clean=name.trim(),collection=adminDb.collection('users/'+actor+'/contact_groups');
 return adminDb.runTransaction(async tx=>{
  const [account,existing,groups]=await Promise.all([
   tx.get(adminDb.doc('users/'+actor)),tx.get(collection.doc(groupId)),tx.get(collection.limit(31))
  ]);
  if(!account.exists)throw Error('TRIBE_ACCESS_DENIED');
  if(existing.exists){
   if(existing.get('ownerId')!==actor||existing.get('groupId')!==groupId||existing.get('name')!==clean)throw Error('TRIBE_GROUP_CONFLICT');
   return {id:groupId};
  }
  if(groups.size>=30)throw Error('TRIBE_LIMIT_REACHED');
  tx.create(collection.doc(groupId),{groupId,ownerId:actor,name:clean,memberIds:[],createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
  return {id:groupId};
 });
}
export async function setOrdinaryTribeMember(actor:string,groupId:unknown,connectionId:unknown,member:unknown){
 vault(actor);
 if(!validId(groupId)||!validId(connectionId)||typeof member!=='boolean')throw Error('TRIBE_CONTACT_INVALID');
 return adminDb.runTransaction(async tx=>{
  const reference=adminDb.doc('users/'+actor+'/contact_groups/'+groupId);
  const [account,group,relation]=await Promise.all([
   tx.get(adminDb.doc('users/'+actor)),tx.get(reference),authorizeTribeRelationship(tx,actor,connectionId)
  ]);
  const original=group.get('memberIds');
  if(!account.exists||!group.exists||group.get('ownerId')!==actor||group.get('groupId')!==groupId||!Array.isArray(original)||original.some(item=>!validId(item)))throw Error('TRIBE_ACCESS_DENIED');
  const peer=peerOf(actor,relation);
  const members=new Set<string>(original);
  if(member&&!members.has(peer)&&members.size>=200)throw Error('TRIBE_LIMIT_REACHED');
  if(members.has(peer)===member)return {member};
  if(member)members.add(peer);else members.delete(peer);
  tx.update(reference,{memberIds:[...members],updatedAt:FieldValue.serverTimestamp()});
  return {member};
 });
}
/** Deleting a group intentionally removes that classification for everyone
 * in it, but does not modify a connection, reserved marker, favorite or chat. */
export async function deleteOrdinaryTribe(actor:string,groupId:unknown){
 vault(actor);
 if(!validId(groupId))throw Error('TRIBE_CONTACT_INVALID');
 return adminDb.runTransaction(async tx=>{
  const ref=adminDb.doc('users/'+actor+'/contact_groups/'+groupId);
  const [account,group]=await Promise.all([tx.get(adminDb.doc('users/'+actor)),tx.get(ref)]);
  if(!account.exists)throw Error('TRIBE_ACCESS_DENIED');
  if(group.exists){
   if(group.get('ownerId')!==actor||group.get('groupId')!==groupId)throw Error('TRIBE_ACCESS_DENIED');
   tx.delete(ref);
  }
  return {deleted:true as const};
 });
}

/** Lightweight authorization probe, no contact identifiers or message data. */
export async function checkReservedTribeSession(actor:string,token:unknown){
 const root=vault(actor);
 return adminDb.runTransaction(async tx=>{
  const [config,socialRevision]=await Promise.all([tx.get(root),tx.get(socialRevisionRef(actor))]);
  requireSession(config,token);
  return {revision:directoryRevision(config,socialRevision)};
 });
}
