import {FieldValue,Timestamp} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {authorizeOrdinaryForward} from './reservedTribeService.js';
import {buildUserNotification,buildUserNotificationId,userNotificationPath} from '../../shared/userNotifications.js';
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
const COOLDOWN_MS=24*60*60*1000;
export function hasCanonicalForwardLink(text:string,communityId:string,postId:string){
 return (text.match(/https?:\/\/[^\s]+/g)??[]).some(raw=>{
  try{
   const url=new URL(raw);
   const local=['localhost','127.0.0.1'].includes(url.hostname)&&['http:','https:'].includes(url.protocol);
   const canonical=['kyrub.com','www.kyrub.com'].includes(url.hostname)&&url.protocol==='https:'&&!url.port;
   return (local||canonical)&&!url.username&&!url.password&&url.pathname==='/'&&!url.hash&&url.searchParams.getAll('community').length===1&&url.searchParams.getAll('post').length===1&&url.searchParams.get('community')===communityId&&url.searchParams.get('post')===postId;
  }catch{return false;}
 });
}
/** Pilot: authorize before reading the receipt; commit all three records or
 * none. The destination is derived from the accepted pair, not the client. */
export async function forwardOrdinaryCommunityPost(actor:string,input:{connectionId:unknown;postId:unknown;communityId:unknown;messageId:unknown;text:unknown}){
 const {connectionId,postId,communityId,messageId}=input;
 if(!validId(connectionId)||!validId(postId)||!validId(communityId)||!validId(messageId)||typeof input.text!=='string')throw Error('TRIBE_INVALID');
 const text=input.text.trim();
 if(!text||text.length>4000||!hasCanonicalForwardLink(text,communityId,postId))throw Error('TRIBE_INVALID');
 return adminDb.runTransaction(async tx=>{
  const relation=await authorizeOrdinaryForward(tx,actor,connectionId);
  const recipientId=relation.senderId===actor?relation.receiverId:relation.senderId;
  const messageRef=adminDb.doc('social_chats/'+connectionId+'/messages/'+messageId);
  const receiptRef=adminDb.doc('community_direct_forward_receipts/'+postId+'__'+actor+'__'+recipientId);
  const notificationId=buildUserNotificationId({category:'user_forward',eventType:'received',sourceId:messageId});
  const notificationRef=adminDb.doc(userNotificationPath(recipientId,notificationId));
  const [source,community,receipt,message,notice]=await tx.getAll(adminDb.doc('community_posts/'+postId),adminDb.doc('communities/'+communityId),receiptRef,messageRef,notificationRef);
  if(!source.exists||source.get('communityId')!==communityId||!community.exists||community.get('visibility')!=='public')throw Error('TRIBE_ACCESS_DENIED');
  if(message.exists||notice.exists){
   if(message.exists&&notice.exists&&message.get('senderId')===actor&&message.get('receiverId')===recipientId&&message.get('text')===text&&notice.get('actorPrincipalId')===actor&&notice.get('sourceId')===messageId&&notice.get('target')?.postId===postId&&notice.get('target')?.communityId===communityId)return {connectionId,messageId,recipientId};
   throw Error('TRIBE_MESSAGE_CONFLICT');
  }
  if(receipt.exists){
   const last=receipt.get('forwardedAt');
   if(receipt.get('actorId')!==actor||receipt.get('receiverId')!==recipientId||receipt.get('postId')!==postId||receipt.get('communityId')!==communityId||receipt.get('connectionId')!==connectionId||!(last instanceof Timestamp)||Date.now()-last.toMillis()<COOLDOWN_MS)throw Error('TRIBE_FORWARD_DUPLICATE');
  }
  const notification=buildUserNotification({recipientUserId:recipientId,category:'user_forward',eventType:'received',sourceId:messageId,actorPrincipalId:actor,title:'Publicação encaminhada por um Kairubido',body:'Abra a publicação original dentro da comunidade.',target:{kind:'community_post',communityId,postId},createdAt:new Date().toISOString()});
  tx.create(messageRef,{senderId:actor,receiverId:recipientId,text,createdAt:FieldValue.serverTimestamp()});
  if(receipt.exists)tx.update(receiptRef,{messageId,forwardedAt:FieldValue.serverTimestamp()});
  else tx.create(receiptRef,{postId,communityId,actorId:actor,receiverId:recipientId,connectionId,messageId,forwardedAt:FieldValue.serverTimestamp()});
  tx.create(notificationRef,notification);
  return {connectionId,messageId,recipientId};
 });
}
