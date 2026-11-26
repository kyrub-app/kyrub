// Emulator only. This is an approximate page-access indicator, not security logs,
// proof of human presence, an NFC read receipt, or a location tracking service.
import {getApps,initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {assertCidSosEmulator,CID_EMULATOR_PROJECT} from './cidSosEmulatorStore.js';
import {observeCidAccess,type CidAccessObservation} from './cidAssistedLocation.js';
import type {TrustedTag} from './cidSosPrivateConfig.js';
import {isTagId} from '../../shared/kyrubTagContract.js';
const APP='cid-access-local-emulator';
export const CID_ACCESS_BUCKET_MS=60000;
const deny=():never=>{throw Error('CID_ACCESS_UNAVAILABLE');};
export async function recordCidAccessEmulator(tagId:string,now:number){
 assertCidSosEmulator();
 if(!isTagId(tagId)||!Number.isSafeInteger(now)||now<CID_ACCESS_BUCKET_MS)return deny();
 const app=getApps().find(a=>a.name===APP)??initializeApp({projectId:CID_EMULATOR_PROJECT},APP);
 if(app.options.projectId!==CID_EMULATOR_PROJECT)return deny();
 const db=getFirestore(app),root=db.collection('cid_sos_emulator_tags').doc(tagId),ref=root.collection('private').doc('last-access');
 const observedAt=Math.floor(now/CID_ACCESS_BUCKET_MS)*CID_ACCESS_BUCKET_MS;
 await db.runTransaction(async tx=>{
  assertCidSosEmulator();
  const [r,live,old]=await Promise.all([tx.get(root),tx.get(db.collection('kyrub_official_tags').doc(tagId)),tx.get(ref)]);
  const tag=r.get('tag') as TrustedTag|undefined;
  if(!tag||tag.tagId!==tagId||!tag.active||live.get('ownerId')!==tag.ownerId||live.get('enabled')!==true||live.get('blocked')===true)return deny();
  const prior=old.get('observation') as CidAccessObservation|undefined;
  if(prior&&(prior.kind!=='cid-access'||prior.tagId!==tagId||!Number.isSafeInteger(prior.observedAt)))return deny();
  if(prior&&prior.observedAt>=observedAt)return;
  tx.set(ref,{observation:observeCidAccess(tag,observedAt)});
 });
 // Never expose the previous observation or a counter to a visitor.
 return {accepted:true as const,simulated:true as const};
}
