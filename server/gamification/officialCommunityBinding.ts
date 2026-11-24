import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type { OfficialCommunityBinding, OfficialCommunityCandidate } from '../../shared/globalChallengeAdmin.js';

const BINDING='kyrub_admin/control_plane/institutional_channels/official_community';
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
function candidate(data:FirebaseFirestore.DocumentData|undefined,id:string,ownerId:string):OfficialCommunityCandidate|null{
 if(!data||!validId(id)||data.communityId!==id||data.ownerId!==ownerId||data.visibility!=='public'||
  typeof data.name!=='string'||!data.name.trim()||data.name.length>80)return null;
 return {communityId:id,name:data.name};
}
async function requireAdmin(db:Firestore,tx:Transaction,actor:string){
 if(!validId(actor))throw Error('FORBIDDEN');
 const profile=await tx.get(db.doc('kyrub_admin/control_plane/admins/'+actor));
 if(!profile.exists||profile.get('uid')!==actor||profile.get('role')!=='super_admin'||profile.get('status')!=='active')throw Error('FORBIDDEN');
}
async function readOwnerCommunity(db:Firestore,tx:Transaction,id:string,ownerId:string){
 if(!validId(id)||!validId(ownerId))return null;
 const [community,membership]=await Promise.all([tx.get(db.doc('communities/'+id)),tx.get(db.doc('community_members/'+id+'__'+ownerId))]);
 const selected=candidate(community.data(),id,ownerId);
 if(!selected||!membership.exists||membership.get('communityId')!==id||membership.get('userId')!==ownerId||
  membership.get('membershipId')!==id+'__'+ownerId||membership.get('role')!=='owner'||membership.get('status')!=='active')return null;
 return selected;
}
export async function readOfficialCommunityBinding(actor:string):Promise<OfficialCommunityBinding>{
 const db=adminDb;
 return db.runTransaction(async tx=>{
  await requireAdmin(db,tx,actor);
  const existing=await tx.get(db.doc(BINDING));
  if(existing.exists){
   const data=existing.data();
   if(data?.schemaVersion!==1||data?.kind!=='official_community'||!validId(data?.communityId)||!validId(data?.ownerId))return {state:'unavailable'};
   const community=await readOwnerCommunity(db,tx,data.communityId,data.ownerId);
   return community?{state:'linked',community}:{state:'unavailable'};
  }
  // Only show the signed-in administrator's own public communities. Never
  // search by name across other owners or automatically select a destination.
  const owned=await tx.get(db.collection('communities').where('ownerId','==',actor).limit(51));
  const candidates=owned.docs.slice(0,50).map(d=>candidate(d.data(),d.id,actor)).filter((v):v is OfficialCommunityCandidate=>v!==null);
  return {state:'unlinked',candidates,truncated:owned.size>50};
 });
}
export async function linkOfficialCommunity(actor:string,id:string,occurredAt:string):Promise<OfficialCommunityBinding>{
 if(!validId(id)||!Number.isFinite(Date.parse(occurredAt)))throw Error('OFFICIAL_COMMUNITY_INPUT_INVALID');
 const db=adminDb;
 const ref=db.doc(BINDING);
 return db.runTransaction(async tx=>{
  await requireAdmin(db,tx,actor);
  const previous=await tx.get(ref);
  if(previous.exists&&(previous.get('schemaVersion')!==1||previous.get('kind')!=='official_community'||previous.get('communityId')!==id||previous.get('ownerId')!==actor))throw Error('OFFICIAL_COMMUNITY_ALREADY_LINKED');
  // Require ownership AND the active owner membership. An admin cannot seize
  // an unrelated user's community, even if it uses the Kyrub name.
  const community=await readOwnerCommunity(db,tx,id,actor);
  if(!community)throw Error('OFFICIAL_COMMUNITY_OWNER_REQUIRED');
  if(!previous.exists){
   tx.create(ref,{schemaVersion:1,kind:'official_community',communityId:id,ownerId:actor,linkedBy:actor,linkedAt:occurredAt});
   tx.create(ref.collection('audit').doc('linked'),{action:'official_community.linked',actorId:actor,communityId:id,occurredAt});
  }
  return {state:'linked',community};
 });
}
