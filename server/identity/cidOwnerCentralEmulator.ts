// Isolated emulator-only owner directory. No production routes, credentials or cloud writes.
import {getApps,initializeApp} from 'firebase-admin/app';
import {getFirestore,type Transaction} from 'firebase-admin/firestore';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import type {AuthenticationResponseJSON} from '@simplewebauthn/server';
import {assertCidSosEmulator,CID_EMULATOR_PROJECT} from './cidSosEmulatorStore.js';
import {CID_CHAT_EMULATOR_ORIGIN} from './cidChatEmulatorStore.js';
import {isTagId} from '../../shared/kyrubTagContract.js';
import {isolatedTagPasskeyScope,issueTagPasskeyChallenge,assertUnusedTagPasskeyChallenge,type TagPasskeyChallenge} from './kyrubTagPasskeyPolicy.js';
import {tagAuthenticationOptions,verifyTagAuthentication,type StoredTagPasskey} from './kyrubTagPasskeyVerifier.js';
import {assertSamePasskeyCredential} from './kyrubTagPasskeyState.js';
import {buildTrustedCidSosProfile,projectPublicCidSos,type TrustedTag,type CidSosConfig,type ChannelGrant} from './cidSosPrivateConfig.js';
import {observeCidVoluntaryLocation,projectOwnerAssistedLocation,type CidLocationObservation} from './cidAssistedLocation.js';
import type {CidSosOccurrence} from './cidSosAlertPolicy.js';
const APP='cid-owner-central-local-emulator';
const TTL=30*60000;
const deny=():never=>{throw Error('CID_OWNER_CENTRAL_FORBIDDEN');};
const token=()=>randomBytes(32).toString('base64url');
const hash=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
const opaque=(s:unknown):s is string=>typeof s==='string'&&/^[A-Za-z0-9_-]{43}$/.test(s);
const time=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
type Credential={id:string;secret:string};
type Challenge=TagPasskeyChallenge&{central:true;version:string;attempts:number};
type Session={id:string;tagId:string;ownerId:string;credentialId:string;digest:string;issuedAt:number;expiresAt:number;revokedAt?:number};
export function createCidOwnerCentralEmulator(tagId:string){
 assertCidSosEmulator();if(!isTagId(tagId))return deny();
 const app=getApps().find(a=>a.name===APP)??initializeApp({projectId:CID_EMULATOR_PROJECT},APP);
 if(app.options.projectId!==CID_EMULATOR_PROJECT)return deny();
 const db=getFirestore(app),root=db.collection('cid_sos_emulator_tags').doc(tagId);
 const central=root.collection('private').doc('owner-central');
 const challenges=central.collection('challenges'),sessions=central.collection('sessions');
 const liveTag=db.collection('kyrub_official_tags').doc(tagId),liveCredential=db.collection('kyrub_tag_passkey_credentials').doc(tagId);
 const quota=db.collection('cid_sos_emulator_owner_quotas').doc(tagId);
 const check=(now:number)=>{assertCidSosEmulator();if(!time(now))return deny();};
 async function current(tx:Transaction){
  const [t,c,r]=await Promise.all([tx.get(liveTag),tx.get(liveCredential),tx.get(root)]);
  const ownerId=t.get('ownerId'),stored=c.get('credential') as StoredTagPasskey|undefined,tag=r.get('tag') as TrustedTag|undefined;
  if(typeof ownerId!=='string'||!ownerId||!tag||tag.tagId!==tagId||tag.ownerId!==ownerId||!tag.active||t.get('ownerAuthMode')!=='passkey'||t.get('enabled')!==true||t.get('blocked')===true||c.get('ownerId')!==ownerId||!stored||typeof stored.id!=='string'||!c.updateTime)return deny();
  const index=await tx.get(db.collection('kyrub_tag_passkey_credential_index').doc(hash(stored.id)));
  if(index.get('tagId')!==tagId||index.get('ownerId')!==ownerId||index.get('revokedAt')!=null)return deny();
  return {ownerId,stored,tag,version:c.updateTime.seconds+':'+c.updateTime.nanoseconds};
 }
 async function authorize(tx:Transaction,credential:Credential,now:number){
  if(!credential||!opaque(credential.id)||!opaque(credential.secret))return deny();
  const ref=sessions.doc(credential.id);
  const [s,c]=await Promise.all([tx.get(ref),current(tx)]);
  const session=s.data() as Session|undefined;
  if(!session||session.id!==credential.id||session.tagId!==tagId||session.ownerId!==c.ownerId||session.credentialId!==c.stored.id||session.revokedAt!==undefined||!time(session.issuedAt)||!time(session.expiresAt)||session.expiresAt-session.issuedAt!==TTL||now<session.issuedAt||now>=session.expiresAt||typeof session.digest!=='string'||!/^[a-f0-9]{64}$/.test(session.digest)||!timingSafeEqual(Buffer.from(session.digest,'hex'),Buffer.from(hash(credential.secret),'hex')))return deny();
  return {...c,ref};
 }
 return {
  async begin(origin:string,now:number){
   check(now);const scope=isolatedTagPasskeyScope(CID_CHAT_EMULATOR_ORIGIN,origin);
   const issued=await db.runTransaction(async tx=>{
    check(now);const c=await current(tx),q=await tx.get(quota);
    const bucket=Math.floor(now/60000),count=q.get('bucket')===bucket?q.get('count'):0;
    if(!Number.isSafeInteger(count)||count<0||count>=6)return deny();
    const record:Challenge={...issueTagPasskeyChallenge({tagId,purpose:'identify-owner',ownerId:c.ownerId,credentialId:c.stored.id,scope},now),central:true,version:c.version,attempts:0};
    tx.set(quota,{bucket,count:count+1});tx.create(challenges.doc(record.id),record);return {record,stored:c.stored};
   });
   return {challengeId:issued.record.id,options:await tagAuthenticationOptions(issued.record,issued.stored,now)};
  },
  async finish(origin:string,id:string,response:AuthenticationResponseJSON,now:number){
   check(now);if(!opaque(id))return deny();
   const scope=isolatedTagPasskeyScope(CID_CHAT_EMULATOR_ORIGIN,origin),ref=challenges.doc(id);
   const initial=await db.runTransaction(async tx=>{
    check(now);const [c,s]=await Promise.all([current(tx),tx.get(ref)]),record=s.data() as Challenge|undefined;
    if(!record||record.id!==id||record.central!==true||record.version!==c.version||!Number.isSafeInteger(record.attempts)||record.attempts<0||record.attempts>=3)return deny();
    assertUnusedTagPasskeyChallenge(record,{tagId,purpose:'identify-owner',ownerId:c.ownerId,credentialId:c.stored.id,scope},now);
    tx.update(ref,{attempts:record.attempts+1});return {record,stored:c.stored};
   });
   const next=await verifyTagAuthentication(initial.record,initial.stored,response,now);
   return db.runTransaction(async tx=>{
    check(now);const [c,s]=await Promise.all([current(tx),tx.get(ref)]),record=s.data() as Challenge|undefined;
    if(!record||record.id!==id||record.central!==true||record.challenge!==initial.record.challenge||record.version!==c.version||record.attempts!==initial.record.attempts+1)return deny();
    assertUnusedTagPasskeyChallenge(record,{tagId,purpose:'identify-owner',ownerId:c.ownerId,credentialId:c.stored.id,scope},now);
    assertSamePasskeyCredential(initial.stored,c.stored);
    const secret=token(),session:Session={id:token(),tagId,ownerId:c.ownerId,credentialId:next.id,digest:hash(secret),issuedAt:now,expiresAt:now+TTL};
    tx.update(liveCredential,{credential:next,lastVerifiedAt:new Date(now).toISOString()});tx.update(ref,{usedAt:now});tx.create(sessions.doc(session.id),session);
    return {id:session.id,secret};
   });
  },
  async read(credential:Credential,now:number){
   check(now);return db.runTransaction(async tx=>{
    check(now);const c=await authorize(tx,credential,now);
    const [configDoc,grantDoc,list,access]=await Promise.all([tx.get(root.collection('private').doc('config')),tx.get(root.collection('private').doc('grants')),tx.get(root.collection('occurrences').orderBy('createdAt','desc').limit(51)),tx.get(root.collection('private').doc('last-access'))]);
    const config=configDoc.get('config') as CidSosConfig|undefined,grants=grantDoc.get('grants') as ChannelGrant[]|undefined;
    const entries=list.docs.slice(0,50).map(d=>{
     const o=d.data() as CidSosOccurrence;
     if(o.id!==d.id||o.tagId!==tagId||o.ownerId!==c.ownerId||!time(o.createdAt)||o.createdAt>now)return deny();
     return o;
    });
    const observations:CidLocationObservation[]=entries.flatMap(o=>{const value=observeCidVoluntaryLocation(c.tag,o);return value?[value]:[];});
    const last=access.get('observation') as CidLocationObservation|undefined;
    if(last?.kind==='cid-access'&&last.tagId===tagId)observations.push(last);
    const profile=config&&Array.isArray(grants)?buildTrustedCidSosProfile(c.tag,config,grants,now):null;
    const capability=projectPublicCidSos(c.tag,config??null,grants??[],now);
    const people=config?[config.owner,...config.contacts].map((p,i)=>({name:p.name,role:i===0?'owner':'contact',channels:p.channels.map(ch=>({channel:ch.channel,verified:!!(i===0?profile?.owner:profile?.contacts.find(x=>x.id===p.id))?.channels.some(x=>x.channel===ch.channel&&x.address===ch.address)}))})):[];
    return {tagId,occurrences:entries.map(o=>({id:o.id,reason:o.reason,createdAt:o.createdAt,status:o.status,...(o.resolution?{resolution:o.resolution}:{})})),hasOlderOccurrences:list.size>50,notices:entries.map(o=>({occurrenceId:o.id,createdAt:o.resolvedAt??o.createdAt,kind:o.status==='open'?'alert':'resolution'})),sos:{enabled:config?.enabled===true,...capability,people},location:projectOwnerAssistedLocation(c.tag,c.ownerId,observations,now)};
   });
  },
  async revoke(credential:Credential,now:number){check(now);return db.runTransaction(async tx=>{check(now);const c=await authorize(tx,credential,now);tx.update(c.ref,{revokedAt:now});return {revoked:true as const};});}
 };
}
