import {randomUUID} from 'node:crypto';
import {FieldValue} from 'firebase-admin/firestore';
import {assertTagPilotWriteIsolated} from './kyrubTagPilotIsolation.js';
import {normalizePromotionalPresentation} from '../../shared/kyrubTagPromotional.js';
import {adminDb,adminStorage,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {isTagId} from '../../shared/kyrubTagContract.js';
import {isPromotionalMediaPath,type PromotionalTagPresentation} from '../../shared/kyrubTagPromotional.js';

const MAX_MEDIA_BYTES=1024*1024;
const bucket=()=>adminStorage.bucket(getFirebaseAdminProjectId()+'.firebasestorage.app');
type Slot='cover'|'avatar'|'background';
const pathOf=(presentation:PromotionalTagPresentation,slot:Slot)=>
 slot==='cover'?presentation.coverPath:slot==='avatar'?presentation.avatarPath:presentation.backgroundPath;

async function verifiedObject(path:string,id:string,slot:Slot,ownerId?:string){
 if(!isPromotionalMediaPath(path,id,slot))throw Error('TAG_MEDIA_INVALID');
 const file=bucket().file(path);
 const [meta]=await file.getMetadata();
 const metadata=meta.metadata??{};
 if(meta.contentType!=='image/webp'||Number(meta.size)<=0||Number(meta.size)>MAX_MEDIA_BYTES||
  metadata.tagId!==id||metadata.purpose!==slot||typeof metadata.ownerId!=='string'||
  ownerId!==undefined&&metadata.ownerId!==ownerId)throw Error('TAG_MEDIA_INVALID');
 return file;
}

/** Tag owner may only publish uploaded images whose GCS metadata names this UID. */
export async function validatePromotionalMediaReferences(
 actor:string,id:string,presentation:PromotionalTagPresentation
){
 for(const slot of ['cover','avatar','background'] as const){
  const path=pathOf(presentation,slot);
  if(path)await verifiedObject(path,id,slot,actor);
 }
}

/**
 * Images intentionally have no public Firebase Storage token/URL. Only this
 * same-origin proxy returns bytes, following a fresh server check that the
 * tag is published, still owned and not blocked or transferred meanwhile.
 * Previously cached/downloaded images cannot be recalled from a visitor.
 */
export async function getPublicPromotionalTagImage(id:string,slot:unknown):Promise<Buffer|null>{
 if(!isTagId(id)||(slot!=='cover'&&slot!=='avatar'&&slot!=='background'))return null;
 const ref=adminDb.collection('kyrub_official_tags').doc(id);
 const snap=await ref.get(),data=snap.data();
 if(!data||data.distribution!=='promotional'||data.enabled!==true||data.blocked===true||data.presentationMode==='follow-profile'||
  typeof data.ownerId!=='string'||!snap.updateTime)return null;
 const presentation=data.presentation as PromotionalTagPresentation|undefined;
 const path=presentation?pathOf(presentation,slot):'';
 if(!path||!isPromotionalMediaPath(path,id,slot))return null;
 const file=await verifiedObject(path,id,slot,data.ownerId);
 const [bytes]=await file.download();
 if(bytes.length===0||bytes.length>MAX_MEDIA_BYTES)throw Error('TAG_MEDIA_INVALID');
 // A concurrent block, ownership transfer or media change invalidates the
 // result even after a successful object fetch.
 const after=await ref.get();
 if(!after.updateTime?.isEqual(snap.updateTime)||after.get('blocked')===true||
   after.get('enabled')!==true||after.get('ownerId')!==data.ownerId)return null;
 return bytes;
}

const imageField={avatar:'photoUrl',cover:'coverUrl',background:'backgroundUrl'} as const;
const slots=['avatar','cover','background'] as const;
const isSlot=(value:unknown):value is Slot=>slots.includes(value as Slot);

/** The server derives all source paths from the owned Tag, not from client input.
 * Copy only selected empty profile slots; never overwrite an existing image.
 * The destination is an independent ordinary profile asset, not a Tag capability.
 */
export async function importTagProfileImages(actor:string,id:string,selection:unknown){
 assertTagPilotWriteIsolated();
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(actor)||!isTagId(id)||!Array.isArray(selection)||selection.length<1||selection.length>3||!selection.every(isSlot)||new Set(selection).size!==selection.length)throw Error('TAG_INVALID');
 const requested=selection as Slot[];
 const accountRef=adminDb.doc('users/'+actor),profileRef=accountRef.collection('public_profile').doc('main');
 const markerRef=adminDb.doc('kyrub_tag_minimal_identities/'+actor),tagRef=adminDb.doc('kyrub_official_tags/'+id);
 const [account,profile,marker,tag]=await Promise.all([accountRef.get(),profileRef.get(),markerRef.get(),tagRef.get()]);
 if((!account.exists&&marker.get('mode')!=='full')||marker.get('mode')==='tag_only'||!profile.exists||profile.get('userId')!==actor||
  tag.get('ownerId')!==actor||tag.get('distribution')!=='promotional'||tag.get('enabled')!==true||tag.get('blocked')===true)throw Error('TAG_FORBIDDEN');
 const source=normalizePromotionalPresentation(tag.get('presentation'));
 const pending=requested.filter(slot=>!profile.get(imageField[slot]));
 if(pending.some(slot=>!pathOf(source,slot)))throw Error('TAG_MEDIA_INVALID');
 if(!pending.length)return {images:{},skipped:requested};
 const prepared:Partial<Record<Slot,{path:string;url:string}>>={};
 // Stage independent files with fresh download tokens; no source URL/token is reused.
 for(const slot of pending){
  const path=pathOf(source,slot)!;
  const original=await verifiedObject(path,id,slot,actor);
  const [bytes]=await original.download();
  if(!bytes.length||bytes.length>MAX_MEDIA_BYTES)throw Error('TAG_MEDIA_INVALID');
  const destination='profile-images/'+actor+'/'+slot+'-'+randomUUID()+'.webp';
  const token=randomUUID();
  const store=bucket();
  await store.file(destination).save(bytes,{resumable:false,metadata:{contentType:'image/webp',metadata:{firebaseStorageDownloadTokens:token}}});
  prepared[slot]={path:destination,url:'https://firebasestorage.googleapis.com/v0/b/'+encodeURIComponent(store.name)+'/o/'+encodeURIComponent(destination)+'?alt=media&token='+encodeURIComponent(token)};
 }
 // Reject if source ownership, paths, publication or profile slots changed in flight.
 // Existing images are never replaced; a response lost after commit can be retried.
 return adminDb.runTransaction(async tx=>{
  const [freshTag,freshAccount,freshProfile,freshMarker]=await Promise.all([tx.get(tagRef),tx.get(accountRef),tx.get(profileRef),tx.get(markerRef)]);
  if(freshTag.get('ownerId')!==actor||freshTag.get('distribution')!=='promotional'||freshTag.get('enabled')!==true||freshTag.get('blocked')===true||
     (!freshAccount.exists&&freshMarker.get('mode')!=='full')||freshMarker.get('mode')==='tag_only'||!freshProfile.exists||freshProfile.get('userId')!==actor)throw Error('TAG_FORBIDDEN');
  const fresh=normalizePromotionalPresentation(freshTag.get('presentation'));
  if(pending.some(slot=>pathOf(source,slot)!==pathOf(fresh,slot)||!!freshProfile.get(imageField[slot])))throw Error('TAG_CHANGED');
  const images:Record<string,string>={};
  for(const slot of pending)images[imageField[slot]]=prepared[slot]!.url;
  tx.update(profileRef,{...images,updatedAt:FieldValue.serverTimestamp()});
  if(freshAccount.exists&&images.photoUrl)tx.update(accountRef,{photoUrl:images.photoUrl,updatedAt:FieldValue.serverTimestamp()});
  return {images,skipped:requested.filter(slot=>!pending.includes(slot))};
 });
}
