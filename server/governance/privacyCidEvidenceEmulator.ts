// Local test project only. Existing verifier is reused; no production routes.
// The prior CID/channel association is a fixture, not a claim of civil identity.
import {getApps,initializeApp} from 'firebase-admin/app';
import {getFirestore,type Transaction} from 'firebase-admin/firestore';
import {createHash,timingSafeEqual} from 'node:crypto';
import type {AuthenticationResponseJSON} from '@simplewebauthn/server';
import {assertPrivacyEmulator,PRIVACY_EMULATOR_PROJECT,PRIVACY_TRACKING_TTL_MS} from './privacyRightsEmulator.js';
import {normalizePrivacyRequest} from '../../shared/privacyRights.js';
import {isolatedTagPasskeyScope,issueTagPasskeyChallenge,assertUnusedTagPasskeyChallenge,type TagPasskeyChallenge} from '../identity/kyrubTagPasskeyPolicy.js';
import {tagAuthenticationOptions,verifyTagAuthentication,type StoredTagPasskey} from '../identity/kyrubTagPasskeyVerifier.js';
import {assertSamePasskeyCredential} from '../identity/kyrubTagPasskeyState.js';
const APP='privacy-cid-evidence-local-emulator';
export const PRIVACY_CID_ORIGIN='https://kyrub-cid-emulator.vercel.app';
const deny=():never=>{throw Error('PRIVACY_CID_EVIDENCE_FORBIDDEN');};
const opaque=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const time=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const matches=(s:unknown,d:unknown)=>opaque(s)&&typeof d==='string'&&/^[a-f0-9]{64}$/.test(d)&&timingSafeEqual(Buffer.from(hash(s),'hex'),Buffer.from(d,'hex'));
type Challenge=TagPasskeyChallenge&{protocol:string;revision:number;credentialVersion:string;attempts:number;simulation:true};
export function createPrivacyCidEvidenceEmulator(){
 assertPrivacyEmulator();
 const app=getApps().find(a=>a.name===APP)??initializeApp({projectId:PRIVACY_EMULATOR_PROJECT},APP);
 if(app.options.projectId!==PRIVACY_EMULATOR_PROJECT)return deny();
 const db=getFirestore(app),requests=db.collection('privacy_emulator_requests'),tracking=db.collection('privacy_emulator_tracking'),challenges=db.collection('privacy_emulator_cid_challenges'),quota=db.collection('privacy_emulator_cid_quota'),evidence=db.collection('privacy_emulator_identity_evidence');
 function check(protocol:string,code:string,now:number){assertPrivacyEmulator();if(!uuid(protocol)||!opaque(code)||!time(now))return deny();}
 async function current(tx:Transaction,protocol:string,code:string,now:number){
  const [t,s]=await Promise.all([tx.get(tracking.doc(protocol)),tx.get(requests.doc(protocol))]),a=t.data(),r=s.data();
  if(!a||a.protocol!==protocol||a.simulation!==true||a.revokedAt!==undefined||!time(a.createdAt)||!time(a.expiresAt)||now<a.createdAt||now>=a.expiresAt||a.expiresAt-a.createdAt>PRIVACY_TRACKING_TTL_MS||!matches(code,a.digest)||!r||r.protocol!==protocol||r.simulation!==true||r.status!=='received'||r.identityStatus!=='pending-verification'||r.actionStatus!=='not-executed'||r.triageStatus!=='verification-required'||r.revision!==1||r.receivedAt!==a.createdAt||!opaque(r.channelReference)||normalizePrivacyRequest(r.draft).context!=='cid')return deny();
  const binding=r.boundCid;
  if(!binding||typeof binding.tagId!=='string'||!/^[a-f0-9]{32}$/.test(binding.tagId)||typeof binding.ownerId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(binding.ownerId))return deny();
  const tagId:string=binding.tagId,ownerId:string=binding.ownerId,credentialRef=db.collection('kyrub_tag_passkey_credentials').doc(tagId);
  const [channel,tag,credential,prior]=await Promise.all([tx.get(db.collection('privacy_emulator_channels').doc(r.channelReference)),tx.get(db.collection('kyrub_official_tags').doc(tagId)),tx.get(credentialRef),tx.get(evidence.doc(protocol))]);
  if(channel.get('simulation')!==true||channel.get('id')!==r.channelReference||channel.get('revokedAt')!==undefined||channel.get('boundTagId')!==tagId||channel.get('boundOwnerId')!==ownerId||!time(channel.get('verifiedAt'))||channel.get('verifiedAt')>r.receivedAt||tag.get('ownerId')!==ownerId||tag.get('ownerAuthMode')!=='passkey'||tag.get('enabled')!==true||tag.get('blocked')===true||credential.get('ownerId')!==ownerId||!credential.updateTime||prior.exists)return deny();
  const stored=credential.get('credential') as StoredTagPasskey|undefined;
  if(!stored||typeof stored.id!=='string'||!stored.id)return deny();
  const index=await tx.get(db.collection('kyrub_tag_passkey_credential_index').doc(hash(stored.id)));
  if(index.get('tagId')!==tagId||index.get('ownerId')!==ownerId||index.get('revokedAt')!=null)return deny();
  return {tagId,ownerId,stored,credentialRef,version:credential.updateTime.seconds+':'+credential.updateTime.nanoseconds,requestRef:s.ref};
 }
 return {
  async begin(protocol:string,code:string,origin:string,now:number){
   check(protocol,code,now);const scope=isolatedTagPasskeyScope(PRIVACY_CID_ORIGIN,origin);
   const issued=await db.runTransaction(async tx=>{
    check(protocol,code,now);const c=await current(tx,protocol,code,now),q=await tx.get(quota.doc(c.tagId)),bucket=Math.floor(now/60000),count=q.get('bucket')===bucket?q.get('count'):0;
    if(!Number.isSafeInteger(count)||count<0||count>=5)return deny();
    const record:Challenge={...issueTagPasskeyChallenge({tagId:c.tagId,ownerId:c.ownerId,credentialId:c.stored.id,purpose:'identify-owner',scope},now),protocol,revision:1,credentialVersion:c.version,attempts:0,simulation:true};
    tx.create(challenges.doc(record.id),record);tx.set(q.ref,{bucket,count:count+1});return {record,stored:c.stored};
   });
   return {challengeId:issued.record.id,options:await tagAuthenticationOptions(issued.record,issued.stored,now)};
  },
  async finish(protocol:string,code:string,origin:string,id:string,response:AuthenticationResponseJSON,now:number){
   check(protocol,code,now);if(!opaque(id))return deny();const scope=isolatedTagPasskeyScope(PRIVACY_CID_ORIGIN,origin),ref=challenges.doc(id);
   const validate=(record:Challenge|undefined,c:Awaited<ReturnType<typeof current>>)=>{
    if(!record||record.id!==id||record.protocol!==protocol||record.revision!==1||record.simulation!==true||record.credentialVersion!==c.version||!Number.isSafeInteger(record.attempts)||record.attempts<0||record.attempts>3)return deny();
    assertUnusedTagPasskeyChallenge(record,{tagId:c.tagId,ownerId:c.ownerId,credentialId:c.stored.id,purpose:'identify-owner',scope},now);return record;
   };
   const initial=await db.runTransaction(async tx=>{
    check(protocol,code,now);const [c,s]=await Promise.all([current(tx,protocol,code,now),tx.get(ref)]),record=validate(s.data() as Challenge|undefined,c);
    if(record.attempts>=3)return deny();tx.update(ref,{attempts:record.attempts+1});return {record,stored:c.stored};
   });
   const next=await verifyTagAuthentication(initial.record,initial.stored,response,now);
   return db.runTransaction(async tx=>{
    check(protocol,code,now);const [c,s]=await Promise.all([current(tx,protocol,code,now),tx.get(ref)]),record=validate(s.data() as Challenge|undefined,c);
    if(record.challenge!==initial.record.challenge||record.attempts!==initial.record.attempts+1)return deny();
    assertSamePasskeyCredential(initial.stored,c.stored);
    tx.update(c.credentialRef,{credential:next,lastVerifiedAt:new Date(now).toISOString()});tx.update(ref,{usedAt:now});
    tx.create(evidence.doc(protocol),{protocol,tagId:c.tagId,ownerId:c.ownerId,credentialId:next.id,kind:'cid-passkey-control',confirmedAt:now,simulation:true,authorizesExecution:false});
    tx.update(c.requestRef,{evidenceStatus:'cid-control-confirmed'});
    return {protocol,evidenceStatus:'cid-control-confirmed' as const,identityStatus:'pending-verification' as const,actionStatus:'not-executed' as const,simulated:true as const};
   });
  }
 };
}
