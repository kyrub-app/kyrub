import {FieldValue} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {isSocialAddress} from './publicSocialAddressPolicy.js';
import {isTagId} from '../../shared/kyrubTagContract.js';
type Source='profile'|'tag'|'contact';
type Action='connect'|'cancel'|'accept'|'decline';
const valid=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const clean=(v:unknown,max:number)=>typeof v==='string'?v.trim().slice(0,max):'';
const member=(account:FirebaseFirestore.DocumentSnapshot,marker:FirebaseFirestore.DocumentSnapshot)=>account.exists&&marker.get('mode')!=='tag_only';
export async function presentationRelationship(actor:string|null,source:unknown,id:unknown,action?:unknown){
 if(!['profile','tag','contact'].includes(String(source))||
   typeof id!=='string'||(source==='profile'?!isSocialAddress('profile',id):!valid(id))||source==='tag'&&!isTagId(id)||
   source==='contact'&&!actor||actor!==null&&!valid(actor)||
   action!==undefined&&(!actor||!['connect','cancel','accept','decline'].includes(String(action))))throw Error('RELATIONSHIP_INVALID');
 return adminDb.runTransaction(async tx=>{
  let targetId=id;
  if(source==='tag'){
   const tag=await tx.get(adminDb.doc('kyrub_official_tags/'+id));
   if(tag.get('distribution')!=='promotional'||tag.get('enabled')!==true||tag.get('blocked')===true||!valid(tag.get('ownerId')))return {state:'unavailable'};
   targetId=tag.get('ownerId') as string;
   const [account,marker]=await Promise.all([tx.get(adminDb.doc('users/'+targetId)),tx.get(adminDb.doc('kyrub_tag_minimal_identities/'+targetId))]);
   if(!member(account,marker))return {state:'tag_only'};
   if(tag.get('socialEnabled')!==true||account.get('isProfileVisible')!==true)return {state:'unavailable'};
  }else if(source==='profile'){
   const mapping=await tx.get(adminDb.doc('public_social_addresses/profile:'+id));
   if(mapping.get('kind')!=='profile'||mapping.get('identifier')!==id||!valid(mapping.get('targetId')))return {state:'unavailable'};
   targetId=mapping.get('targetId') as string;
  }
  const target=await tx.get(adminDb.doc('users/'+targetId));
  const targetMarker=await tx.get(adminDb.doc('kyrub_tag_minimal_identities/'+targetId));
  if(!member(target,targetMarker))return {state:'unavailable'};
  if(actor===targetId)return {state:'self'};
  if(!actor)return {state:target.get('isProfileVisible')===true?'guest':'unavailable'};
  const viewer=await tx.get(adminDb.doc('users/'+actor));
  const viewerMarker=await tx.get(adminDb.doc('kyrub_tag_minimal_identities/'+actor));
  if(!member(viewer,viewerMarker))return {state:'join'};
  const [ownBlock,otherBlock]=await Promise.all([tx.get(blockRef(actor,targetId)),tx.get(blockRef(targetId,actor))]);
  if(ownBlock.exists||otherBlock.exists)return {state:'unavailable'};
  const connectionId=[actor,targetId].sort().join('_');
  if(connectionId.length>128)throw Error('RELATIONSHIP_INVALID');
  const ref=adminDb.doc('connections/'+connectionId);
  const connection=await tx.get(ref);
  const row=connection.data();
  if(row&&(!Array.isArray(row.participantIds)||row.participantIds.length!==2||!row.participantIds.includes(actor)||!row.participantIds.includes(targetId)||
    ![actor,targetId].includes(row.senderId)||![actor,targetId].includes(row.receiverId)||row.senderId===row.receiverId))throw Error('RELATIONSHIP_INVALID');
  if(source!=='contact'&&target.get('isProfileVisible')!==true)return {state:'unavailable'};
  if(!row&&target.get('isProfileVisible')!==true)return {state:'unavailable'};
  const state=row?.status==='accepted'?'accepted':row?.status==='pending'?(row.senderId===actor?'pending_sent':'pending_received'):'none';
  if(row&&state==='none')throw Error('RELATIONSHIP_INVALID');
  const publicProfile=await tx.get(target.ref.collection('public_profile').doc('main'));
  const peer={id:targetId,name:clean(publicProfile.get('name')||target.get('name'),160)||'Kairubido',avatar:clean(publicProfile.get('photoUrl')||target.get('photoUrl'),2048),role:clean(publicProfile.get('occupation'),90)||'Kairubido',connectionId,connectionStatus:'accepted'};
  if(action==='connect'&&state==='none'){
   const ownProfile=await tx.get(viewer.ref.collection('public_profile').doc('main'));
   tx.create(ref,{senderId:actor,receiverId:targetId,participantIds:[actor,targetId].sort(),status:'pending',
     senderName:clean(ownProfile.get('name')||viewer.get('name'),160)||'Kairubido',
     senderAvatar:clean(ownProfile.get('photoUrl')||viewer.get('photoUrl'),2048),
     senderRole:clean(ownProfile.get('occupation'),90)||'Kairubido',
     receiverName:peer.name,receiverAvatar:peer.avatar,receiverRole:peer.role,
     createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
   return {state:'pending_sent'};
  }
  if(action==='accept'&&state==='pending_received'){
   tx.update(ref,{status:'accepted',acceptedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
   return {state:'accepted',peer};
  }
  if(action==='cancel'&&state==='pending_sent'||action==='decline'&&state==='pending_received'){
   tx.delete(ref);return {state:'none'};
  }
  if(action!==undefined&&!(action==='connect'&&state==='pending_sent'||action==='accept'&&state==='accepted'||(action==='cancel'||action==='decline')&&state==='none'))throw Error('RELATIONSHIP_CHANGED');
  return state==='accepted'?{state,peer}:{state};
 });
}

const blockRef=(actor:string,target:string)=>adminDb.doc('social_contact_blocks/'+actor+'/blocked/'+target);

/** Directional, private block; remove only the matching relationship, not message history. */
export async function setSocialContactBlock(actor:string,target:string,blocked:boolean){
 if(!valid(actor)||!valid(target)||actor===target||typeof blocked!=='boolean')throw Error('RELATIONSHIP_INVALID');
 return adminDb.runTransaction(async tx=>{
  const own=blockRef(actor,target);
  const [account,marker,existing,targetAccount]=await Promise.all([
   tx.get(adminDb.doc('users/'+actor)),tx.get(adminDb.doc('kyrub_tag_minimal_identities/'+actor)),tx.get(own),tx.get(adminDb.doc('users/'+target))
  ]);
  if(!member(account,marker))throw Error('RELATIONSHIP_INVALID');
  if(!blocked){if(existing.exists)tx.delete(own);return {blocked:false};}
  if(!targetAccount.exists&&!existing.exists)throw Error('RELATIONSHIP_INVALID');
  const ids=[...new Set([actor+'_'+target,target+'_'+actor])].filter(id=>id.length<=128);
  const refs=ids.map(id=>adminDb.doc('connections/'+id));
  const rows=await Promise.all(refs.map(ref=>tx.get(ref)));
  const profile=await tx.get(targetAccount.ref.collection('public_profile').doc('main'));
  if(!existing.exists)tx.create(own,{targetId:target,name:clean(profile.get('name')||targetAccount.get('name'),160)||'Kairubido',createdAt:FieldValue.serverTimestamp()});
  rows.forEach((row,i)=>{
   const v=row.data();
   if(v&&((v.senderId===actor&&v.receiverId===target)||(v.senderId===target&&v.receiverId===actor))&&
      Array.isArray(v.participantIds)&&v.participantIds.length===2&&v.participantIds.includes(actor)&&v.participantIds.includes(target))tx.delete(refs[i]);
  });
  return {blocked:true};
 });
}
