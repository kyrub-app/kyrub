import {createHash} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {assertTagPilotWriteIsolated,stableTagPilotHost} from './kyrubTagPilotIsolation.js';
import {isTagId} from '../../shared/kyrubTagContract.js';
import {isBoundTarget,parseCardTargets} from './publicCardPolicy.js';
import {resolveTarget} from './publicVisitCardService.js';
import {isolatedTagPasskeyScope,issueTagPasskeyChallenge,assertUnusedTagPasskeyChallenge,newTagPasskeyRecoveryCode,tagPasskeyRecoveryHash,type TagPasskeyChallenge} from './kyrubTagPasskeyPolicy.js';
import {tagRegistrationOptions,tagAuthenticationOptions,verifyTagRegistration,verifyTagAuthentication,type StoredTagPasskey} from './kyrubTagPasskeyVerifier.js';
import {assertPasskeyTagState,isPasskeyMutation,normalizePasskeyMutation,assertSamePasskeyCredential,type PasskeyMutation} from './kyrubTagPasskeyState.js';
import type {PromotionalTagPresentation} from '../../shared/kyrubTagPromotional.js';
import type {RegistrationResponseJSON,AuthenticationResponseJSON} from '@simplewebauthn/server';

// Internal isolated lifecycle. No HTTP route yet; no Firebase custom token or
// ordinary session is an authorization to mutate a passkey-owned tag.
const tags=()=>adminDb.collection('kyrub_official_tags');
const credentials=()=>adminDb.collection('kyrub_tag_passkey_credentials');
const challenges=()=>adminDb.collection('kyrub_tag_passkey_challenges');
const indexes=()=>adminDb.collection('kyrub_tag_passkey_credential_index');
const quotas=()=>adminDb.collection('kyrub_tag_passkey_quotas');
type RecordData=TagPasskeyChallenge&{presentation:PromotionalTagPresentation|null;tagVersion:string;credentialVersion:string|null};
function scope(origin:string){
 assertTagPilotWriteIsolated();
 if(process.env.KYRUB_TAG_PASSKEY_PILOT_ENABLED!=='true')throw Error('TAG_PASSKEY_DISABLED');
 const host=stableTagPilotHost();
 if(!host)throw Error('TAG_PASSKEY_ORIGIN');
 return isolatedTagPasskeyScope('https://'+host,origin);
}
function version(t:Timestamp|undefined){if(!t)throw Error('TAG_CHANGED');return t.seconds+':'+t.nanoseconds;}
function readCredential(data:FirebaseFirestore.DocumentData|undefined,ownerId:unknown):StoredTagPasskey{
 const c=data?.credential;
 if(data?.ownerId!==ownerId||!c||typeof c.id!=='string'||typeof c.publicKey!=='string'||
 typeof c.userHandle!=='string'||!Number.isSafeInteger(c.counter)||typeof c.backedUp!=='boolean')throw Error('TAG_FORBIDDEN');
 return c as StoredTagPasskey;
}
const validChallengeId=(id:unknown):id is string=>typeof id==='string'&&/^[A-Za-z0-9_-]{43}$/.test(id);
const credentialIndexId=(id:string)=>createHash('sha256').update(id).digest('hex');

export async function beginTagPasskeyMutation(origin:string,tagId:string,purpose:PasskeyMutation,input?:unknown){
 const rp=scope(origin);
 if(!isTagId(tagId)||!isPasskeyMutation(purpose))throw Error('TAG_INVALID');
 const presentation=normalizePasskeyMutation(purpose,input);
 const issued=await adminDb.runTransaction(async tx=>{
  const tagRef=tags().doc(tagId),credentialRef=credentials().doc(tagId),quotaRef=quotas().doc(tagId);
  const [tag,credential,quota]=await Promise.all([tx.get(tagRef),tx.get(credentialRef),tx.get(quotaRef)]);
  const data=tag.data();
  assertPasskeyTagState(data,purpose);
  if(purpose==='register'&&credential.exists)throw Error('TAG_FORBIDDEN');
  const stored=purpose==='register'?null:readCredential(credential.data(),data!.ownerId);
  const now=Date.now(),bucket=Math.floor(now/60000);
  const count=quota.get('bucket')===bucket?Number(quota.get('count')):0;
  if(!Number.isSafeInteger(count)||count<0||count>=6)throw Error('TAG_PASSKEY_RATE_LIMIT');
  const record=issueTagPasskeyChallenge({tagId,purpose,ownerId:purpose==='register'?null:data!.ownerId as string,credentialId:stored?.id??null,scope:rp},now);
  const privateRecord:RecordData={...record,presentation,tagVersion:version(tag.updateTime),credentialVersion:credential.exists?version(credential.updateTime):null};
  tx.create(challenges().doc(record.id),{...privateRecord,deleteAfter:Timestamp.fromMillis(record.expiresAt+600000)});
  tx.set(quotaRef,{bucket,count:count+1,deleteAfter:Timestamp.fromMillis(now+120000)});
  return {record,stored};
 });
 const options=issued.stored?await tagAuthenticationOptions(issued.record,issued.stored):await tagRegistrationOptions(issued.record);
 return {challengeId:issued.record.id,options};
}

export async function finishTagPasskeyMutation(origin:string,tagId:string,challengeId:string,response:RegistrationResponseJSON|AuthenticationResponseJSON){
 const rp=scope(origin);
 if(!isTagId(tagId)||!validChallengeId(challengeId))throw Error('TAG_INVALID');
 const tagRef=tags().doc(tagId),challengeRef=challenges().doc(challengeId),credentialRef=credentials().doc(tagId);
 const [initial,challenge,credential]=await Promise.all([tagRef.get(),challengeRef.get(),credentialRef.get()]);
 const record=challenge.data() as RecordData|undefined,data=initial.data();
 if(!record||record.id!==challengeId||!isPasskeyMutation(record.purpose))throw Error('TAG_PASSKEY_CHALLENGE_INVALID');
 assertPasskeyTagState(data,record.purpose);
 const registering=record.purpose==='register';
 const stored=registering?null:readCredential(credential.data(),data!.ownerId);
 const expected={tagId,purpose:record.purpose,ownerId:registering?null:data!.ownerId as string,credentialId:stored?.id??null,scope:rp};
 assertUnusedTagPasskeyChallenge(record,expected);
 if(record.tagVersion!==version(initial.updateTime)||record.credentialVersion!==(credential.exists?version(credential.updateTime):null))throw Error('TAG_CHANGED');
 const nextCredential=stored?await verifyTagAuthentication(record,stored,response as AuthenticationResponseJSON):await verifyTagRegistration(record,response as RegistrationResponseJSON);
 const ownerId=registering?'tagpk_'+record.id:data!.ownerId as string;
 const marker=adminDb.doc('kyrub_tag_minimal_identities/'+ownerId),account=adminDb.doc('users/'+ownerId),index=indexes().doc(credentialIndexId(nextCredential.id));
 const presentation=normalizePasskeyMutation(record.purpose,record.presentation);
 const existing=Array.isArray(data!.targets)?data!.targets.filter(isBoundTarget):[];
 const targets=presentation?.destinations!==undefined?await Promise.all((presentation.destinations.length?parseCardTargets(presentation.destinations):[]).map(t=>resolveTarget(ownerId,t,existing.find(e=>e.kind===t.kind&&e.identifier===t.identifier)?.bindingId))):null;
 if(targets?.some(t=>!t))throw Error('CARD_TARGET_UNAVAILABLE');
 const bound=targets===null?existing:targets.flatMap(t=>t?[t.binding]:[]);
 const recoveryCode=registering||record.purpose==='rotate-recovery'?newTagPasskeyRecoveryCode():null;
 return adminDb.runTransaction(async tx=>{
  const [tag,currentChallenge,currentCredential,currentIndex,currentMarker,currentAccount]=await Promise.all([tx.get(tagRef),tx.get(challengeRef),tx.get(credentialRef),tx.get(index),tx.get(marker),tx.get(account)]);
  const current=tag.data(),live=currentChallenge.data() as RecordData|undefined;
  if(!live||live.id!==challengeId||live.challenge!==record.challenge||!challenge.updateTime?.isEqual(currentChallenge.updateTime!)||
   record.tagVersion!==version(tag.updateTime)||record.credentialVersion!==(currentCredential.exists?version(currentCredential.updateTime):null))throw Error('TAG_CHANGED');
  assertPasskeyTagState(current,record.purpose);
  assertUnusedTagPasskeyChallenge(live,expected);
  const now=Date.now(),stamp=new Date(now).toISOString();
  if(registering){
   if(currentCredential.exists||currentIndex.exists||currentMarker.exists||currentAccount.exists||!presentation||!recoveryCode)throw Error('TAG_FORBIDDEN');
   tx.create(marker,{uid:ownerId,mode:'tag_only',source:'kyrub_tag_passkey',createdFromTag:tagId,createdAt:stamp});
   tx.create(index,{tagId,ownerId});
   tx.create(credentialRef,{ownerId,credential:nextCredential,createdAt:stamp});
   tx.update(tagRef,{ownerId,firstOwnerId:ownerId,ownerAuthMode:'passkey',passkeyRecoveryHash:tagPasskeyRecoveryHash(tagId,recoveryCode),presentation,targets:bound,enabled:true,blocked:false,claimedAt:stamp,updatedAt:stamp});
  }else{
   if(!stored||current!.ownerId!==ownerId||currentIndex.get('tagId')!==tagId||currentIndex.get('ownerId')!==ownerId)throw Error('TAG_FORBIDDEN');
   assertSamePasskeyCredential(stored,readCredential(currentCredential.data(),ownerId));
   tx.update(credentialRef,{credential:nextCredential,lastVerifiedAt:stamp});
   if(record.purpose==='edit'&&presentation)tx.update(tagRef,{presentation,targets:bound,enabled:true,updatedAt:stamp});
   else if(record.purpose==='block')tx.update(tagRef,{blocked:true,enabled:false,blockedAt:stamp,updatedAt:stamp});
   else if(record.purpose==='unblock')tx.update(tagRef,{blocked:false,enabled:true,blockedAt:null,updatedAt:stamp});
   else if(record.purpose==='rotate-recovery'&&recoveryCode)tx.update(tagRef,{passkeyRecoveryHash:tagPasskeyRecoveryHash(tagId,recoveryCode),recoveryRotatedAt:stamp});
   else throw Error('TAG_INVALID');
  }
  // Consume proof atomically with the mutation: a failed or racing write cannot
  // grant ownership; no general-purpose login session is created.
  tx.update(challengeRef,{usedAt:now,presentation:null});
  return {tagId,purpose:record.purpose,recoveryCode};
 });
}
