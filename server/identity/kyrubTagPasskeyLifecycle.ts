import {createHash} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {assertTagPilotWriteIsolated,stableTagPilotHost,productionTagPasskeyTestId} from './kyrubTagPilotIsolation.js';
import {isTagId} from '../../shared/kyrubTagContract.js';
import {isBoundTarget,parseCardTargets} from './publicCardPolicy.js';
import {resolveTarget} from './publicVisitCardService.js';
import {assertProductionPasskeyUnit} from './kyrubTagPasskeyReleasePolicy.js';
import {productionTagPasskeyScope,isolatedTagPasskeyScope,issueTagPasskeyChallenge,assertUnusedTagPasskeyChallenge,newTagPasskeyRecoveryCode,tagPasskeyRecoveryHash,matchesTagPasskeyRecovery,type TagPasskeyChallenge} from './kyrubTagPasskeyPolicy.js';
import {tagRegistrationOptions,tagAuthenticationOptions,verifyTagRegistration,verifyTagAuthentication,type StoredTagPasskey} from './kyrubTagPasskeyVerifier.js';
import {assertPasskeyTagState,isPasskeyMutation,normalizePasskeyMutation,assertSamePasskeyCredential,assertRecoveryCredentialReplacement,assertTagAccountLink,type PasskeyMutation} from './kyrubTagPasskeyState.js';
import type {PromotionalTagPresentation} from '../../shared/kyrubTagPromotional.js';
import type {RegistrationResponseJSON,AuthenticationResponseJSON} from '@simplewebauthn/server';

// Isolated lifecycle. No Firebase custom token or
// ordinary session is an authorization to mutate a passkey-owned tag.
const tags=()=>adminDb.collection('kyrub_official_tags');
const credentials=()=>adminDb.collection('kyrub_tag_passkey_credentials');
const challenges=()=>adminDb.collection('kyrub_tag_passkey_challenges');
const indexes=()=>adminDb.collection('kyrub_tag_passkey_credential_index');
const quotas=()=>adminDb.collection('kyrub_tag_passkey_quotas');
type RecordData=TagPasskeyChallenge&{presentation:PromotionalTagPresentation|null;tagVersion:string;credentialVersion:string|null;linkedAccountActor?:string};
function scope(origin:string,tagId:string){
 if(process.env.VERCEL_ENV==='production'){
  const approved=productionTagPasskeyTestId();
  if(!approved||approved!==tagId)throw Error('TAG_PASSKEY_DISABLED');
  return productionTagPasskeyScope(origin);
 }
 assertTagPilotWriteIsolated();
 if(process.env.KYRUB_TAG_PASSKEY_PILOT_ENABLED!=='true'||process.env.KYRUB_TAG_PROMO_FIRST_CLAIM_ENABLED!=='true')throw Error('TAG_PASSKEY_DISABLED');
 const host=stableTagPilotHost();
 if(!host)throw Error('TAG_PASSKEY_ORIGIN');
 return isolatedTagPasskeyScope('https://'+host,origin);
}
function assertReleaseUnit(tagId:string,data:Record<string,unknown>|undefined){
 if(process.env.VERCEL_ENV==='production'){
  const approved=productionTagPasskeyTestId();if(!approved)throw Error('TAG_PASSKEY_DISABLED');
  assertProductionPasskeyUnit(approved,tagId,data);
 }
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
function recoveryMatches(tagId:string,data:FirebaseFirestore.DocumentData|undefined,secret:unknown){
 return typeof secret==='string'&&typeof data?.passkeyRecoveryHash==='string'&&matchesTagPasskeyRecovery(tagId,secret,data.passkeyRecoveryHash);
}
function requireRecoveryInput(purpose:PasskeyMutation,secret:unknown){
 if(purpose==='recover'?typeof secret!=='string'||!validChallengeId(secret):secret!==undefined)throw Error('TAG_INVALID');
}

export async function beginTagPasskeyMutation(origin:string,tagId:string,purpose:PasskeyMutation,input?:unknown,recoverySecret?:unknown,accountActor?:string){
 const rp=scope(origin,tagId);
 if(!isTagId(tagId)||!isPasskeyMutation(purpose))throw Error('TAG_INVALID');
 requireRecoveryInput(purpose,recoverySecret);
 if((purpose==='link-account')!==!!accountActor)throw Error('TAG_FORBIDDEN');
 const presentation=normalizePasskeyMutation(purpose,input);
 const issued=await adminDb.runTransaction(async tx=>{
  const tagRef=tags().doc(tagId),credentialRef=credentials().doc(tagId),quotaRef=quotas().doc(purpose==='recover'?tagId+'-recover':tagId);
  const [tag,credential,quota]=await Promise.all([tx.get(tagRef),tx.get(credentialRef),tx.get(quotaRef)]);
  const data=tag.data();
  assertReleaseUnit(tagId,data);
  assertPasskeyTagState(data,purpose);
  if(purpose==='link-account'){
   assertTagAccountLink(data,accountActor);
   const [account,marker]=await Promise.all([tx.get(adminDb.doc('users/'+accountActor)),tx.get(adminDb.doc('kyrub_tag_minimal_identities/'+accountActor))]);
   if(!account.exists||marker.get('mode')==='tag_only')throw Error('TAG_ACCOUNT_REQUIRED');
  }
  if(purpose==='register'&&credential.exists)throw Error('TAG_FORBIDDEN');
  const stored=purpose==='register'?null:readCredential(credential.data(),data!.ownerId);
  const now=Date.now(),bucket=Math.floor(now/60000);
  const count=quota.get('bucket')===bucket?Number(quota.get('count')):0;
  if(!Number.isSafeInteger(count)||count<0||count>=(purpose==='recover'?3:6))throw Error('TAG_PASSKEY_RATE_LIMIT');
  // Commit the quota even on a wrong recovery code; do not throw inside this
  // transaction after setting it, since that would roll back the attempt.
  tx.set(quotaRef,{bucket,count:count+1,deleteAfter:Timestamp.fromMillis(now+120000)});
  if(purpose==='recover'&&!recoveryMatches(tagId,data,recoverySecret))return null;
  const record=issueTagPasskeyChallenge({tagId,purpose,ownerId:purpose==='register'?null:data!.ownerId as string,credentialId:stored?.id??null,scope:rp},now);
  const privateRecord:RecordData={...record,presentation,tagVersion:version(tag.updateTime),credentialVersion:credential.exists?version(credential.updateTime):null,...(accountActor?{linkedAccountActor:accountActor}:{})};
  tx.create(challenges().doc(record.id),{...privateRecord,deleteAfter:Timestamp.fromMillis(record.expiresAt+600000)});
  return {record,stored};
 });
 if(!issued)throw Error('TAG_FORBIDDEN');
 const options=issued.stored&&purpose!=='recover'?await tagAuthenticationOptions(issued.record,issued.stored):await tagRegistrationOptions(issued.record);
 return {challengeId:issued.record.id,options};
}

export async function finishTagPasskeyMutation(origin:string,tagId:string,challengeId:string,response:RegistrationResponseJSON|AuthenticationResponseJSON,recoverySecret?:unknown,accountActor?:string){
 const rp=scope(origin,tagId);
 if(!isTagId(tagId)||!validChallengeId(challengeId))throw Error('TAG_INVALID');
 const tagRef=tags().doc(tagId),challengeRef=challenges().doc(challengeId),credentialRef=credentials().doc(tagId);
 // Bound invalid proofs before invoking cryptography. A failed assertion never
 // receives unlimited retries; the quota is shared across all challenges of a unit.
 await adminDb.runTransaction(async tx=>{
  const quotaRef=quotas().doc(tagId+'-verify');
  const [attempt,quota]=await Promise.all([tx.get(challengeRef),tx.get(quotaRef)]);
  const candidate=attempt.data() as (RecordData&{attempts?:number})|undefined;
  if(!candidate||candidate.id!==challengeId||candidate.tagId!==tagId||candidate.scope.origin!==rp.origin||candidate.usedAt!==null||Date.now()>=candidate.expiresAt)throw Error('TAG_PASSKEY_CHALLENGE_INVALID');
  const now=Date.now(),bucket=Math.floor(now/60000),count=quota.get('bucket')===bucket?Number(quota.get('count')):0,attempts=candidate.attempts??0;
  if(!Number.isSafeInteger(count)||count<0||count>=12||!Number.isSafeInteger(attempts)||attempts<0||attempts>=3)throw Error('TAG_PASSKEY_RATE_LIMIT');
  tx.update(challengeRef,{attempts:attempts+1});
  tx.set(quotaRef,{bucket,count:count+1,deleteAfter:Timestamp.fromMillis(now+120000)});
 });
 const [initial,challenge,credential]=await Promise.all([tagRef.get(),challengeRef.get(),credentialRef.get()]);
 const record=challenge.data() as RecordData|undefined,data=initial.data();
 if(!record||record.id!==challengeId||!isPasskeyMutation(record.purpose))throw Error('TAG_PASSKEY_CHALLENGE_INVALID');
 assertReleaseUnit(tagId,data);
 assertPasskeyTagState(data,record.purpose);
 requireRecoveryInput(record.purpose,recoverySecret);
 if(record.purpose==='link-account'){assertTagAccountLink(data,accountActor);if(record.linkedAccountActor!==accountActor)throw Error('TAG_FORBIDDEN');}
 else if(accountActor!==undefined)throw Error('TAG_FORBIDDEN');
 const registering=record.purpose==='register',recovering=record.purpose==='recover';
 if(recovering&&!recoveryMatches(tagId,data,recoverySecret))throw Error('TAG_FORBIDDEN');
 const stored=registering?null:readCredential(credential.data(),data!.ownerId);
 const expected={tagId,purpose:record.purpose,ownerId:registering?null:data!.ownerId as string,credentialId:stored?.id??null,scope:rp};
 assertUnusedTagPasskeyChallenge(record,expected);
 if(record.tagVersion!==version(initial.updateTime)||record.credentialVersion!==(credential.exists?version(credential.updateTime):null))throw Error('TAG_CHANGED');
 const nextCredential=stored&&!recovering?await verifyTagAuthentication(record,stored,response as AuthenticationResponseJSON):await verifyTagRegistration(record,response as RegistrationResponseJSON);
 if(recovering){if(!stored)throw Error('TAG_FORBIDDEN');assertRecoveryCredentialReplacement(stored,nextCredential);}
 const ownerId=registering?'tagpk_'+record.id:data!.ownerId as string;
 const marker=adminDb.doc('kyrub_tag_minimal_identities/'+ownerId),account=adminDb.doc('users/'+ownerId),index=indexes().doc(credentialIndexId(nextCredential.id));
 const presentation=normalizePasskeyMutation(record.purpose,record.presentation);
 const existing=Array.isArray(data!.targets)?data!.targets.filter(isBoundTarget):[];
 const targets=presentation?.destinations!==undefined?await Promise.all((presentation.destinations.length?parseCardTargets(presentation.destinations):[]).map(t=>resolveTarget(typeof data!.linkedAccountId==='string'?data!.linkedAccountId:ownerId,t,existing.find(e=>e.kind===t.kind&&e.identifier===t.identifier)?.bindingId))):null;
 if(targets?.some(t=>!t))throw Error('CARD_TARGET_UNAVAILABLE');
 const bound=targets===null?existing:targets.flatMap(t=>t?[t.binding]:[]);
 const recoveryCode=registering||recovering||record.purpose==='rotate-recovery'?newTagPasskeyRecoveryCode():null;
 const oldIndex=recovering&&stored?indexes().doc(credentialIndexId(stored.id)):null;
 return adminDb.runTransaction(async tx=>{
  const [tag,currentChallenge,currentCredential,currentIndex,currentMarker,currentAccount,previousIndex]=await Promise.all([tx.get(tagRef),tx.get(challengeRef),tx.get(credentialRef),tx.get(index),tx.get(marker),tx.get(account),oldIndex?tx.get(oldIndex):Promise.resolve(null)]);
  const current=tag.data(),live=currentChallenge.data() as RecordData|undefined;
  if(!live||live.id!==challengeId||live.challenge!==record.challenge||!challenge.updateTime?.isEqual(currentChallenge.updateTime!)||
   record.tagVersion!==version(tag.updateTime)||record.credentialVersion!==(currentCredential.exists?version(currentCredential.updateTime):null))throw Error('TAG_CHANGED');
  assertReleaseUnit(tagId,current);
  assertPasskeyTagState(current,record.purpose);
  if(record.purpose==='link-account'){
   assertTagAccountLink(current,accountActor);
   if(live.linkedAccountActor!==accountActor)throw Error('TAG_FORBIDDEN');
   const [linkedAccount,linkedMarker]=await Promise.all([tx.get(adminDb.doc('users/'+accountActor)),tx.get(adminDb.doc('kyrub_tag_minimal_identities/'+accountActor))]);
   if(!linkedAccount.exists||linkedMarker.get('mode')==='tag_only')throw Error('TAG_ACCOUNT_REQUIRED');
  }
  assertUnusedTagPasskeyChallenge(live,expected);
  const now=Date.now(),stamp=new Date(now).toISOString();
  if(registering){
   if(currentCredential.exists||currentIndex.exists||currentMarker.exists||currentAccount.exists||!presentation||!recoveryCode)throw Error('TAG_FORBIDDEN');
   tx.create(marker,{uid:ownerId,mode:'tag_only',source:'kyrub_tag_passkey',createdFromTag:tagId,createdAt:stamp});
   tx.create(index,{tagId,ownerId});
   tx.create(credentialRef,{ownerId,credential:nextCredential,createdAt:stamp});
   tx.update(tagRef,{ownerId,firstOwnerId:ownerId,ownerAuthMode:'passkey',passkeyRecoveryHash:tagPasskeyRecoveryHash(tagId,recoveryCode),presentation,targets:bound,enabled:true,blocked:false,claimedAt:stamp,updatedAt:stamp});
  }else if(recovering){
   if(!stored||!oldIndex||!previousIndex||!recoveryCode||current!.ownerId!==ownerId||currentIndex.exists||
    previousIndex.get('tagId')!==tagId||previousIndex.get('ownerId')!==ownerId||previousIndex.get('revokedAt')!=null||
    !recoveryMatches(tagId,current,recoverySecret))throw Error('TAG_FORBIDDEN');
   assertSamePasskeyCredential(stored,readCredential(currentCredential.data(),ownerId));
   assertRecoveryCredentialReplacement(stored,nextCredential);
   // Keep a revoked index tombstone so an obsolete credential cannot be re-used.
   tx.update(oldIndex,{revokedAt:stamp});
   tx.create(index,{tagId,ownerId});
   tx.update(credentialRef,{credential:nextCredential,lastVerifiedAt:stamp,recoveredAt:stamp});
   tx.update(tagRef,{passkeyRecoveryHash:tagPasskeyRecoveryHash(tagId,recoveryCode),blocked:true,enabled:false,blockedAt:stamp,recoveredAt:stamp,updatedAt:stamp});
  }else{
   if(!stored||current!.ownerId!==ownerId||currentIndex.get('tagId')!==tagId||currentIndex.get('ownerId')!==ownerId||currentIndex.get('revokedAt')!=null)throw Error('TAG_FORBIDDEN');
   assertSamePasskeyCredential(stored,readCredential(currentCredential.data(),ownerId));
   tx.update(credentialRef,{credential:nextCredential,lastVerifiedAt:stamp});
   if(record.purpose==='edit'&&presentation)tx.update(tagRef,{presentation,targets:bound,enabled:true,updatedAt:stamp});
   else if(record.purpose==='block')tx.update(tagRef,{blocked:true,enabled:false,blockedAt:stamp,updatedAt:stamp});
   else if(record.purpose==='unblock')tx.update(tagRef,{blocked:false,enabled:true,blockedAt:null,updatedAt:stamp});
   else if(record.purpose==='link-account'&&accountActor)tx.update(tagRef,{linkedAccountId:accountActor,linkedAccountAt:current!.linkedAccountAt??stamp,updatedAt:stamp});
   else if(record.purpose==='rotate-recovery'&&recoveryCode)tx.update(tagRef,{passkeyRecoveryHash:tagPasskeyRecoveryHash(tagId,recoveryCode),recoveryRotatedAt:stamp});
   else if(record.purpose!=='identify-owner')throw Error('TAG_INVALID');
  }
  // Consume proof atomically with the mutation: a failed or racing write cannot
  // grant ownership; no general-purpose login session is created.
  tx.update(challengeRef,{usedAt:now,presentation:null});
  return {tagId,purpose:record.purpose,recoveryCode};
 });
}
