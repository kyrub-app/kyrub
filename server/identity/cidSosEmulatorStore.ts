// Deliberately emulator-only. Never import the production adminDb or expose this as an API.
// The demo project cannot be replaced by an environment-selected project or real credentials.
import {getApps,initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {createHash} from 'node:crypto';
import {isTagId} from '../../shared/kyrubTagContract.js';
import type {TrustedTag,CidSosConfig,ChannelGrant} from './cidSosPrivateConfig.js';
import type {CidSosOccurrence} from './cidSosAlertPolicy.js';
import type {PrivateSosStore,PendingSosMessage} from './cidSosOccurrenceStore.js';

export const CID_EMULATOR_PROJECT='demo-kyrub-cid-sos';
const APP='cid-sos-local-emulator';
const deny=():never=>{throw Error('CID_SOS_EMULATOR_ONLY');};
export function assertCidSosEmulator(env:NodeJS.ProcessEnv=process.env){
 if(env.KYRUB_CID_SOS_EMULATOR!=='true'||env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8088'||env.GCLOUD_PROJECT!==CID_EMULATOR_PROJECT||env.FIREBASE_PROJECT_ID!==CID_EMULATOR_PROJECT||env.VERCEL||env.VERCEL_ENV||env.GOOGLE_APPLICATION_CREDENTIALS||env.FIREBASE_SERVICE_ACCOUNT_JSON)return deny();
}
export function createCidSosEmulatorStore(tagId:string):PrivateSosStore{
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
 return {async transaction(work){
  assertCidSosEmulator();
  return db.runTransaction(async tx=>{
   assertCidSosEmulator();
   // Read and mutate the same tag document for every new occurrence, serializing
   // concurrent submissions that would otherwise observe the same rate-limit window.
   const locked=await tx.get(root);
   let created=false;
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
     if(!s.exists)return deny();return s.data() as CidSosOccurrence;
    },
    readRecent:async(id,after)=>{
     requireTag(id);if(!Number.isSafeInteger(after))return deny();
     const s=await tx.get(records.where('createdAt','>=',after).limit(4));
     return s.docs.map(d=>d.data() as CidSosOccurrence);
    },
    createOccurrence:async record=>{
     requireTag(record.tagId);requireId(record.id);if(created||!locked.exists)return deny();
     const revision=locked.get('revision');
     if(!Number.isSafeInteger(revision)||revision<0||!Number.isSafeInteger(revision+1))return deny();
     tx.create(records.doc(record.id),record);tx.create(index.doc(record.id),{tagId});
     tx.update(root,{revision:revision+1});created=true;
    },
    createPendingMessage:async(entry:PendingSosMessage)=>{
     if(!created||entry.status!=='simulation-pending')return deny();
     const key=createHash('sha256').update(entry.message.key,'utf8').digest('hex');
     tx.create(outbox.doc(key),entry);
    }
   });
   return result;
  });
 }};
}
