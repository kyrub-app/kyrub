import {getBytes,ref,uploadBytes} from 'firebase/storage';
import {auth,storage} from './firebase';
import {isTagId} from '../../shared/kyrubTagContract';
import {isPromotionalMediaPath,promotionalMediaPath} from '../../shared/kyrubTagPromotional';

const MAX_SOURCE_BYTES=8*1024*1024;
const MAX_WEBP_BYTES=1024*1024;
type Slot='cover'|'avatar';
const allowed=new Set(['image/jpeg','image/png','image/webp']);

async function sanitizedWebp(file:File,slot:Slot):Promise<Blob>{
 if(!allowed.has(file.type)||file.size===0||file.size>MAX_SOURCE_BYTES)
  throw Error('Use uma foto JPEG, PNG ou WebP de até 8 MB.');
 const bitmap=await createImageBitmap(file);
 try{
  const maximum=slot==='cover'?1440:640;
  const scale=Math.min(1,maximum/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));
  canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const ctx=canvas.getContext('2d');
  if(!ctx)throw Error('Não foi possível preparar a foto neste dispositivo.');
  ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  for(const quality of [0.82,0.7,0.55,0.4]){
   const output=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/webp',quality));
   if(output&&output.type==='image/webp'&&output.size>0&&output.size<=MAX_WEBP_BYTES)return output;
  }
  throw Error('Esta imagem ficou grande demais após o tratamento. Escolha outra foto.');
 }finally{bitmap.close();}
}

/** Re-encoding removes source EXIF/location metadata; storage creates no shareable URL. */
export async function uploadPromotionalTagImage(file:File,id:string,slot:Slot){
 const user=auth.currentUser;
 if(!user||!user.emailVerified||!isTagId(id))throw Error('Confirme seu e-mail antes de enviar a foto.');
 const blob=await sanitizedWebp(file,slot);
 if(auth.currentUser?.uid!==user.uid)throw Error('A sessão mudou. Tente novamente.');
 const asset=crypto.randomUUID().replace(/-/g,'');
 const path=promotionalMediaPath(id,slot,asset);
 await uploadBytes(ref(storage,path),blob,{
  contentType:'image/webp',
  customMetadata:{ownerId:user.uid,tagId:id,purpose:slot}
 });
 return {path,previewUrl:URL.createObjectURL(blob)};
}

export async function loadPrivatePromotionalTagImage(id:string,slot:Slot,path:string){
 if(!isPromotionalMediaPath(path,id,slot)||!auth.currentUser?.emailVerified)return null;
 const bytes=await getBytes(ref(storage,path),MAX_WEBP_BYTES+1);
 if(bytes.byteLength>MAX_WEBP_BYTES)throw Error('Foto inválida.');
 return URL.createObjectURL(new Blob([bytes],{type:'image/webp'}));
}

export const publicPromotionalTagImageUrl=(id:string,slot:Slot)=>
 '/api/health?transport=public-kyrub-tag-media&id='+encodeURIComponent(id)+'&slot='+slot;
