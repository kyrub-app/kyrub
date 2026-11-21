import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {adminDb} from '../firebaseAdmin.js';
import {isTagId,isTagModel,tagUrl,type KyrubTagModel,type OwnedKyrubTag} from '../../shared/kyrubTagContract.js';
import {parseCardTargets,isBoundTarget,cardLink,CARD_LIMIT,type CardLink} from './publicCardPolicy.js';
import {resolveTarget} from './publicVisitCardService.js';
const tags=()=>adminDb.collection('kyrub_official_tags');
const validActor=(actor:string)=>{if(!/^[A-Za-z0-9_-]{1,128}$/.test(actor))throw Error('TAG_FORBIDDEN');};
const hash=(id:string,code:string)=>createHash('sha256').update('kyrub-tag-v1:'+id+':'+code).digest('hex');
function owned(id:string,data:Record<string,unknown>):OwnedKyrubTag{
 if(!isTagId(id)||!isTagModel(data.model))throw Error('TAG_UNAVAILABLE');
 const targets=Array.isArray(data.targets)?data.targets.filter(isBoundTarget).slice(0,CARD_LIMIT):[];
 return {id,model:data.model,enabled:data.enabled===true,urls:targets.map(t=>cardLink(t,'Destino').url)};
}
// Trusted manufacturing service only. No client or HTTP provisioning route.
// Return the secret once for a separate sealed activation code, never NDEF.
export async function provisionKyrubTag(model:KyrubTagModel){
 if(!isTagModel(model))throw Error('TAG_INVALID');
 const id=randomBytes(16).toString('hex'),code=randomBytes(16).toString('hex');
 await tags().doc(id).create({model,ownerId:null,enabled:false,targets:[],activationHash:hash(id,code),createdAt:new Date().toISOString()});
 return {id,code,url:tagUrl(id)};
}
export async function claimKyrubTag(actor:string,id:string,code:unknown){
 validActor(actor);
 if(!isTagId(id)||!isTagId(code))throw Error('TAG_INVALID');
 return adminDb.runTransaction(async tx=>{
  const ref=tags().doc(id);
  const [snapshot,account]=await Promise.all([tx.get(ref),tx.get(adminDb.doc('users/'+actor))]);
  const data=snapshot.data();
  if(!account.exists||!data||!isTagModel(data.model))throw Error('TAG_FORBIDDEN');
  // A consumed code can never change the original owner. Even disabled tags
  // remain bound. Use GET to recover after a successful claim.
  if(data.ownerId!==null||typeof data.activationHash!=='string'||!/^[a-f0-9]{64}$/.test(data.activationHash))throw Error('TAG_FORBIDDEN');
  if(!timingSafeEqual(Buffer.from(data.activationHash,'hex'),Buffer.from(hash(id,code),'hex')))throw Error('TAG_FORBIDDEN');
  const next={model:data.model,ownerId:actor,enabled:false,targets:[],activationHash:null,claimedAt:new Date().toISOString()};
  tx.update(ref,next);
  return owned(id,next);
 });
}
export async function listOwnedKyrubTags(actor:string){
 validActor(actor);
 const records=await tags().where('ownerId','==',actor).limit(101).get();
 return {tags:records.docs.slice(0,100).map(d=>owned(d.id,d.data())),hasMore:records.size>100};
}
export async function configureKyrubTag(actor:string,id:string,urls:unknown){
 validActor(actor);
 if(!isTagId(id))throw Error('TAG_INVALID');
 const requested=parseCardTargets(urls);
 const ref=tags().doc(id);
 const initial=(await ref.get()).data();
 if(initial?.ownerId!==actor)throw Error('TAG_FORBIDDEN');
 const resolved=await Promise.all(requested.map(t=>resolveTarget(actor,t)));
 if(resolved.some(t=>!t))throw Error('CARD_TARGET_UNAVAILABLE');
 const targets=resolved.flatMap(t=>t?[t.binding]:[]);
 return adminDb.runTransaction(async tx=>{
  const data=(await tx.get(ref)).data();
  if(!data||data.ownerId!==actor)throw Error('TAG_FORBIDDEN');
  tx.update(ref,{targets,enabled:true});
  return owned(id,{...data,targets,enabled:true});
 });
}
export async function disableKyrubTag(actor:string,id:string){
 validActor(actor);
 if(!isTagId(id))throw Error('TAG_INVALID');
 return adminDb.runTransaction(async tx=>{
  const ref=tags().doc(id);
  const data=(await tx.get(ref)).data();
  if(!data||data.ownerId!==actor)throw Error('TAG_FORBIDDEN');
  tx.update(ref,{enabled:false});
  return owned(id,{...data,enabled:false});
 });
}
export async function resolveKyrubTag(id:string):Promise<{id:string;model:KyrubTagModel;status:'unclaimed'|'active';links:CardLink[]}|null>{
 if(!isTagId(id))return null;
 const ref=tags().doc(id),snapshot=await ref.get(),data=snapshot.data();
 if(!data||!isTagModel(data.model))return null;
 if(data.ownerId===null)return {id,model:data.model,status:'unclaimed',links:[]};
 if(data.enabled!==true||typeof data.ownerId!=='string'||!Array.isArray(data.targets)||data.targets.length>CARD_LIMIT)return null;
 const targets=data.targets.filter(isBoundTarget);
 const links=(await Promise.all(targets.map(t=>resolveTarget(data.ownerId,t,t.bindingId)))).flatMap(t=>t?[t.link]:[]);
 const current=await ref.get();
 if(!snapshot.updateTime||!current.updateTime||!current.updateTime.isEqual(snapshot.updateTime)||current.data()?.enabled!==true)return null;
 return {id,model:data.model,status:'active',links};
}
