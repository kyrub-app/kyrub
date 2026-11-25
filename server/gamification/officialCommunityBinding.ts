import { createHash } from 'node:crypto';
import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { projectGlobalChallenge } from './globalChallengeAdminValidation.js';
import { FIRST_STORE_PUBLISHED_CHALLENGE_ID, planFirstStorePublishedReward } from './firstStorePublishedReward.js';
import { OFFICIAL_CHALLENGE_AUTHOR_ID, type OfficialChallengeDisclosure, type OfficialCommunityBinding, type OfficialCommunityCandidate } from '../../shared/globalChallengeAdmin.js';

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


// The first release is deliberately restricted to the existing test project.
// A separate reviewed release must authorize real institutional publication.
export function officialChallengeDisclosureEnabled(env:NodeJS.ProcessEnv,project:unknown){
 return env.KYRUB_OFFICIAL_CHALLENGE_DISCLOSURE_ENABLED==='true'&&project==='demo-global-challenges'&&
 env.FIREBASE_PROJECT_ID==='demo-global-challenges'&&/^(127\.0\.0\.1|localhost):\d+$/.test(env.FIRESTORE_EMULATOR_HOST??'')&&
 /^(127\.0\.0\.1|localhost):\d+$/.test(env.FIREBASE_AUTH_EMULATOR_HOST??'')&&
 !env.VERCEL&&!env.FIREBASE_SERVICE_ACCOUNT_JSON&&!env.GOOGLE_APPLICATION_CREDENTIALS;
}
export async function discloseOfficialChallenge(actor:string,challengeId:string,shareToSquare:boolean):Promise<OfficialChallengeDisclosure>{
 const db=adminDb;
 if(!officialChallengeDisclosureEnabled(process.env,(db as Firestore&{projectId?:string}).projectId))throw Error('OFFICIAL_CHALLENGE_DISCLOSURE_DISABLED');
 if(!validId(challengeId)||typeof shareToSquare!=='boolean')throw Error('CHALLENGE_INPUT_INVALID');
 // Only the verified first-publication adapter is admitted in this pilot.
 if(challengeId!==FIRST_STORE_PUBLISHED_CHALLENGE_ID)throw Error('OFFICIAL_CHALLENGE_NOT_AVAILABLE');
 const now=new Date(),occurredAt=now.toISOString(),timestamp=Timestamp.fromDate(now);
 return db.runTransaction(async tx=>{
  await requireAdmin(db,tx,actor);
  const binding=await tx.get(db.doc(BINDING));
  const b=binding.data();
  if(!b||b.schemaVersion!==1||b.kind!=='official_community'||!validId(b.communityId)||!validId(b.ownerId))throw Error('OFFICIAL_COMMUNITY_UNAVAILABLE');
  const community=await readOwnerCommunity(db,tx,b.communityId,b.ownerId);
  if(!community)throw Error('OFFICIAL_COMMUNITY_UNAVAILABLE');
  const challengeRef=db.doc('global_challenges/'+challengeId);
  const receiptRef=challengeRef.collection('audit').doc('institutional_disclosure');
  const postId='official_challenge_'+createHash('sha256').update(challengeId).digest('hex');
  const postRef=db.doc('community_posts/'+postId);
  const squareRef=db.doc('community_square_posts/'+postId);
  const [definition,receipt,post,pointer]=await Promise.all([tx.get(challengeRef),tx.get(receiptRef),tx.get(postRef),tx.get(squareRef)]);
  if(!definition.exists)throw Error('GLOBAL_CHALLENGE_NOT_FOUND');
  const challenge=projectGlobalChallenge(definition.data());
  if(challenge.id!==challengeId||!['published','active'].includes(challenge.status)||
   (challenge.startsAt&&Date.parse(challenge.startsAt)>now.getTime())||
   (challenge.endsAt&&Date.parse(challenge.endsAt)<=now.getTime()))throw Error('OFFICIAL_CHALLENGE_NOT_AVAILABLE');
  // Reuse the exact eligibility contract (2 XP, zero Pitangas, one completion).
  try { planFirstStorePublishedReward(challenge,{userId:actor,storeId:'pilot-contract-check',publishedAt:occurredAt,isFirstPublication:true,isOwnerVerified:true,isMarketplaceVisible:true}); }
  catch { throw Error('OFFICIAL_CHALLENGE_NOT_AVAILABLE'); }
  const result={challengeId,communityId:community.communityId,postId,sharedToSquare:shareToSquare};
  if(receipt.exists){
   if(receipt.get('challengeId')!==challengeId||receipt.get('communityId')!==community.communityId||receipt.get('postId')!==postId||
    receipt.get('sharedToSquare')!==shareToSquare||!post.exists||post.get('institutionalChallengeId')!==challengeId||
    post.get('authorId')!==OFFICIAL_CHALLENGE_AUTHOR_ID||post.get('communityId')!==community.communityId||
    (shareToSquare&&!pointer.exists)||(!shareToSquare&&pointer.exists))throw Error('OFFICIAL_DISCLOSURE_CONFLICT');
   return {...result,replay:true};
  }
  if(post.exists||pointer.exists)throw Error('OFFICIAL_DISCLOSURE_CONFLICT');
  // Do not snapshot reward amounts in editable text. The challenge catalog
  // remains the sole authority on its status and prospective reward.
  const description=challenge.description.length>2400?challenge.description.slice(0,2400)+'…':challenge.description;
  const content=challenge.title+'\n\n'+description+'\n\nConfira os detalhes em Desafios da plataforma, na Central Pessoal. A divulgação não concede recompensas.';
  tx.create(postRef,{postId,communityId:community.communityId,authorId:OFFICIAL_CHALLENGE_AUTHOR_ID,authorName:'Kyrub Oficial',authorAvatar:'',institutionalChallengeId:challengeId,
   content,mediaUrls:[],allowComments:true,pinnedCommentId:'',createdAtIso:occurredAt,createdAt:timestamp,updatedAtIso:occurredAt,updatedAt:timestamp});
  if(shareToSquare)tx.create(squareRef,{postId,communityId:community.communityId,createdAt:timestamp});
  tx.create(receiptRef,{...result,action:'official_challenge.disclosed',actorId:actor,occurredAt});
  return {...result,replay:false};
 });
}
