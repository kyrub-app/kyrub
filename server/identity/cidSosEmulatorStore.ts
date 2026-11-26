// Deliberately emulator-only. Never import the production adminDb or expose this as an API.
// The demo project cannot be replaced by an environment-selected project or real credentials.
import {getApps,initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {isTagId} from '../../shared/kyrubTagContract.js';
import type {TrustedTag,CidSosConfig,ChannelGrant} from './cidSosPrivateConfig.js';
import {observeCidVoluntaryLocation} from './cidAssistedLocation.js';
import type {CidSosOccurrence} from './cidSosAlertPolicy.js';
import {recordSimulatedCidSos,type PrivateSosStore,type PrivateSosTransaction,type PendingSosMessage} from './cidSosOccurrenceStore.js';
import {normalizeCidSosRequest} from '../../shared/cidSosRequest.js';
import {createCidOccurrenceChat,openCidChatSession,authorizeCidChatSession,type CidChat,type ChatSession} from './cidOccurrenceChatAccess.js';
type EmitterBinding={requestId:string;payloadDigest:string;sessionSecret:string;now:number};
type SessionCredential={id:string;secret:string};
const digest=(v:string)=>createHash('sha256').update(v,'utf8').digest('hex');
const equal=(a:unknown,b:string)=>typeof a==='string'&&/^[a-f0-9]{64}$/.test(a)&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
const emitterDenied=():never=>{throw Error('CID_EMITTER_FORBIDDEN');};

export const CID_EMULATOR_PROJECT='demo-kyrub-cid-sos';
const APP='cid-sos-local-emulator';
const deny=():never=>{throw Error('CID_SOS_EMULATOR_ONLY');};
export function assertCidSosEmulator(env:NodeJS.ProcessEnv=process.env){
 if(env.KYRUB_CID_SOS_EMULATOR!=='true'||env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8088'||env.GCLOUD_PROJECT!==CID_EMULATOR_PROJECT||env.FIREBASE_PROJECT_ID!==CID_EMULATOR_PROJECT||env.VERCEL||env.VERCEL_ENV||env.GOOGLE_APPLICATION_CREDENTIALS||env.FIREBASE_SERVICE_ACCOUNT_JSON)return deny();
}
export function createCidSosEmulatorStore(tagId:string){
 assertCidSosEmulator();if(!isTagId(tagId))return deny();
 const app=getApps().find(a=>a.name===APP)??initializeApp({projectId:CID_EMULATOR_PROJECT},APP);
 if(app.options.projectId!==CID_EMULATOR_PROJECT)return deny();
 const db=getFirestore(app);
 const root=db.collection('cid_sos_emulator_tags').doc(tagId);
 const records=root.collection('occurrences'),outbox=root.collection('outbox');
 const configRef=root.collection('private').doc('config'),grantsRef=root.collection('private').doc('grants');
 const index=db.collection('cid_sos_emulator_request_index');
 const requireTag=(v:string)=>{if(v!==tagId)return deny();};
 const requireId=(v:string)=>{if(!/^[A-Za-z0-9_-]{22,80}$/.test(v))return deny();};
 async function run<T>(work:(tx:PrivateSosTransaction)=>Promise<T>,emitter?:EmitterBinding){
  assertCidSosEmulator();
  return db.runTransaction(async tx=>{
   assertCidSosEmulator();
   // Read and mutate the same tag document for every new occurrence, serializing
   // concurrent submissions that would otherwise observe the same rate-limit window.
   const locked=await tx.get(root);
   let created=false,session:SessionCredential|undefined;
   const result=await work({
    readTag:async id=>{requireTag(id);return locked.exists?locked.data()?.tag as TrustedTag:null;},
    readConfig:async id=>{requireTag(id);const s=await tx.get(configRef);return s.exists?s.data()?.config as CidSosConfig:null;},
    readGrants:async id=>{requireTag(id);const s=await tx.get(grantsRef);return s.exists?s.data()?.grants as ChannelGrant[]:[];},
    readOccurrence:async id=>{
     requireId(id);const pointer=await tx.get(index.doc(id));
     if(!pointer.exists)return null;
     const existingTag=pointer.get('tagId');
     // Cross-tag reuse is denied without loading or exposing a foreign occurrence.
     if(existingTag!==tagId)return deny();
     const s=await tx.get(records.doc(id));
     if(!s.exists)return deny();
     if(emitter){
      if(id!==emitter.requestId)return emitterDenied();
      const chatRef=records.doc(id).collection('chat').doc('state');
      const [binding,chatDoc]=await Promise.all([tx.get(records.doc(id).collection('private').doc('emitter')),tx.get(chatRef)]);
      const sessionId=binding.get('sessionId'),chat=chatDoc.data() as CidChat|undefined;
      if(!chat||chat.tagId!==tagId||chat.id!==id||typeof sessionId!=='string'||!/^[-_A-Za-z0-9]{43}$/.test(sessionId)||!equal(binding.get('payloadDigest'),emitter.payloadDigest)||!equal(binding.get('secretDigest'),digest(emitter.sessionSecret)))return emitterDenied();
      const stored=(await tx.get(chatRef.collection('sessions').doc(sessionId))).data() as ChatSession|undefined;
      if(!stored||stored.id!==sessionId||authorizeCidChatSession(chat,stored,emitter.sessionSecret,emitter.now,'read').role!=='emitter')return emitterDenied();
      session={id:sessionId,secret:emitter.sessionSecret};
     }
     return s.data() as CidSosOccurrence;
    },
    readRecent:async(id,after)=>{
     requireTag(id);if(!Number.isSafeInteger(after))return deny();
     const s=await tx.get(records.where('createdAt','>=',after).limit(4));
     return s.docs.map(d=>d.data() as CidSosOccurrence);
    },
    createOccurrence:async record=>{
     requireTag(record.tagId);requireId(record.id);if(created||!locked.exists)return deny();
     const revision=locked.get('revision');
     const trusted=locked.get('tag') as TrustedTag|undefined;
     if(!trusted||trusted.tagId!==tagId||trusted.ownerId!==record.ownerId)return deny();
     const observation=observeCidVoluntaryLocation(trusted,record);
     // Atomically retain a pointer to the most recent committed voluntary fix.
     // No duplicate coordinate store, and unrelated later alerts cannot erase it.
     if(observation)tx.set(root.collection('private').doc('last-shared'),{occurrenceId:record.id,observedAt:observation.observedAt});
     if(!Number.isSafeInteger(revision)||revision<0||!Number.isSafeInteger(revision+1))return deny();
     tx.create(records.doc(record.id),record);tx.create(index.doc(record.id),{tagId});
     tx.update(root,{revision:revision+1});created=true;
     if(emitter){
      if(record.id!==emitter.requestId)return emitterDenied();
      const emitterId='emitter_'+randomBytes(32).toString('base64url');
      const {chat,greeting}=createCidOccurrenceChat(record,emitterId,emitter.now);
      const opened=openCidChatSession(chat,emitterId,'emitter-session',emitter.now);
      const chatRef=records.doc(record.id).collection('chat').doc('state');
      const secretDigest=digest(emitter.sessionSecret);
      tx.create(chatRef,chat);tx.create(chatRef.collection('messages').doc(greeting.id),greeting);
      tx.create(chatRef.collection('sessions').doc(opened.record.id),{...opened.record,digest:secretDigest});
      tx.create(records.doc(record.id).collection('private').doc('emitter'),{sessionId:opened.record.id,payloadDigest:emitter.payloadDigest,secretDigest});
      session={id:opened.record.id,secret:emitter.sessionSecret};
     }
    },
    createPendingMessage:async(entry:PendingSosMessage)=>{
     if(!created||entry.status!=='simulation-pending')return deny();
     const key=createHash('sha256').update(entry.message.key,'utf8').digest('hex');
     tx.create(outbox.doc(key),entry);
    }
   });
   if(emitter&&!session)return emitterDenied();
   return {result,session};
  });
 }
 const store:PrivateSosStore={async transaction<T>(work:(tx:PrivateSosTransaction)=>Promise<T>){return (await run(work)).result;}};
 return {...store,
  // A browser-generated 32-byte cryptographic seed represents possession only.
  // No endpoint yet: future HTTP adapter must use a secure cookie, CSRF, rate limits,
  // server time, and never log or expose seed/session credentials in URLs.
  async submitEmitterAlert(input:unknown,seed:unknown,now:number){
   assertCidSosEmulator();
   if(typeof seed!=='string'||!/^[-_A-Za-z0-9]{43}$/.test(seed)||Buffer.from(seed,'base64url').length!==32||Buffer.from(seed,'base64url').toString('base64url')!==seed||!Number.isSafeInteger(now)||now<=0)return emitterDenied();
   const request=normalizeCidSosRequest(input);
   const sessionSecret=createHash('sha256').update('cid-emitter-session-v1:'+tagId+':'+request.id+':'+seed,'utf8').digest('base64url');
   const emitter:EmitterBinding={requestId:request.id,payloadDigest:digest(JSON.stringify(request)),sessionSecret,now};
   const scoped:PrivateSosStore={async transaction<T>(work:(tx:PrivateSosTransaction)=>Promise<T>){
    const result=await run(work,emitter);
    return {...result.result,session:result.session} as T;
   }};
   const result=await recordSimulatedCidSos(scoped,tagId,request,now) as {accepted:true;simulated:true;session?:SessionCredential};
   if(!result.session)return emitterDenied();
   return {accepted:true as const,simulated:true as const,session:result.session};
  }
 };
}
