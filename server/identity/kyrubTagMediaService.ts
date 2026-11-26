import {adminDb,adminStorage,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {isTagId} from '../../shared/kyrubTagContract.js';
import {isPromotionalMediaPath,type PromotionalTagPresentation} from '../../shared/kyrubTagPromotional.js';

import {canReadPublishedPromotionalTag} from './kyrubTagPublicationPolicy.js';

const MAX_MEDIA_BYTES=1024*1024;
const bucket=()=>adminStorage.bucket(getFirebaseAdminProjectId()+'.firebasestorage.app');
type Slot='cover'|'avatar';
const pathOf=(presentation:PromotionalTagPresentation,slot:Slot)=>
 slot==='cover'?presentation.coverPath: presentation.avatarPath;

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
 for(const slot of ['cover','avatar'] as const){
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
 if(!isTagId(id)||(slot!=='cover'&&slot!=='avatar'))return null;
 const ref=adminDb.collection('kyrub_official_tags').doc(id);
 const snap=await ref.get(),data=snap.data();
 if(!data||data.distribution!=='promotional'||data.enabled!==true||data.blocked===true||
  typeof data.ownerId!=='string'||!snap.updateTime)return null;
 if(!canReadPublishedPromotionalTag(id,data,(await adminDb.doc('age_eligibility_private/'+data.ownerId).get()).data(),process.env.KYRUB_TAG_PUBLICATION_ENABLED==='true'))return null;
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
 if(!canReadPublishedPromotionalTag(id,data,(await adminDb.doc('age_eligibility_private/'+data.ownerId).get()).data(),process.env.KYRUB_TAG_PUBLICATION_ENABLED==='true'))return null;
 return bytes;
}
