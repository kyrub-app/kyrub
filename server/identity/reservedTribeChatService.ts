import {FieldPath,FieldValue,Timestamp} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {authorizeTribeRelationship} from './reservedTribeService.js';

const validId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const stamp=(value:unknown)=>value instanceof Timestamp?{seconds:value.seconds,nanoseconds:value.nanoseconds}:null;
const chatRef=(connectionId:string)=>adminDb.collection('social_chats').doc(connectionId);

/** Server-only chat operations for an unlocked reserved session. All reads and
 * mutations share the same relationship + vault transaction. No client token
 * can be passed to Firestore rules, and direct reserved chat access is denied.
 * Callers must authenticate the actor independently of this session token.
 */
export async function readTribeChat(actor:string,connectionId:string,token?:unknown){
 return adminDb.runTransaction(async tx=>{
  const relation=await authorizeTribeRelationship(tx,actor,connectionId,token);
  const ref=chatRef(connectionId);
  const history=await tx.get(ref.collection('history_state').doc(actor));
  const cutoff=history.get('clearedAt');
  let query:FirebaseFirestore.Query=ref.collection('messages');
  if(cutoff instanceof Timestamp)query=query.where('createdAt','>',cutoff);
  const messages=await tx.get(query.orderBy('createdAt','desc').orderBy(FieldPath.documentId(),'desc').limit(100));
  // Recheck expiry and authorization before returning the protected projection.
  await authorizeTribeRelationship(tx,actor,connectionId,token);
  const peer=relation.senderId===actor?relation.receiverId:relation.senderId;
  return {messages:messages.docs.flatMap(doc=>{
   const data=doc.data();
   if(!validId(doc.id)||typeof data.text!=='string'||!(data.createdAt instanceof Timestamp)||
      !((data.senderId===actor&&data.receiverId===peer)||(data.senderId===peer&&data.receiverId===actor)))return [];
   return [{id:doc.id,senderId:data.senderId as string,receiverId:data.receiverId as string,text:data.text,createdAt:stamp(data.createdAt)}];
  }).reverse(),clearedAt:stamp(cutoff)};
 });
}

export async function sendTribeChatMessage(actor:string,connectionId:string,token:unknown,messageId:unknown,text:unknown){
 if(!validId(messageId)||typeof text!=='string'||!text.trim()||text.trim().length>4000)throw Error('TRIBE_MESSAGE_INVALID');
 const normalized=text.trim();
 return adminDb.runTransaction(async tx=>{
  const relation=await authorizeTribeRelationship(tx,actor,connectionId,token);
  const peer=relation.senderId===actor?relation.receiverId:relation.senderId;
  const reference=chatRef(connectionId).collection('messages').doc(messageId);
  const existing=await tx.get(reference);
  await authorizeTribeRelationship(tx,actor,connectionId,token);
  if(existing.exists){
   const row=existing.data()!;
   if(row.senderId!==actor||row.receiverId!==peer||row.text!==normalized)throw Error('TRIBE_MESSAGE_CONFLICT');
   return {id:messageId};
  }
  tx.create(reference,{senderId:actor,receiverId:peer,text:normalized,createdAt:FieldValue.serverTimestamp()});
  return {id:messageId};
 });
}

export async function clearTribeChatHistory(actor:string,connectionId:string,token?:unknown){
 return adminDb.runTransaction(async tx=>{
  await authorizeTribeRelationship(tx,actor,connectionId,token);
  // Same owner-specific marker as the ordinary chat. Never delete shared messages.
  tx.set(chatRef(connectionId).collection('history_state').doc(actor),{clearedAt:FieldValue.serverTimestamp()});
  return {cleared:true as const};
 });
}
