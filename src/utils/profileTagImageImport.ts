import {auth} from './firebase';
import {isTagId,type OwnedKyrubTag} from '../../shared/kyrubTagContract';
export const PROFILE_IMPORT_SLOTS=['avatar','cover','background'] as const;
export type ProfileImportSlot=typeof PROFILE_IMPORT_SLOTS[number];
export const PROFILE_IMPORT_LABELS={avatar:'Foto de perfil',cover:'Imagem de capa',background:'Imagem de fundo'} as const;
export const availableTagImages=(tag:OwnedKyrubTag|undefined)=>PROFILE_IMPORT_SLOTS.filter(slot=>!!tag?.presentation?.[slot==='avatar'?'avatarPath':slot==='cover'?'coverPath':'backgroundPath']);
export async function importTagProfileImages(uid:string,id:string,slots:ProfileImportSlot[]){
 const user=auth.currentUser;
 if(!user||user.uid!==uid||!isTagId(id)||!slots.length)throw Error('AUTH_REQUIRED');
 const token=await user.getIdToken(true);
 if(auth.currentUser?.uid!==uid)throw Error('SESSION_CHANGED');
 const response=await fetch('/api/health?transport=manage-kyrub-tag&id='+encodeURIComponent(id),{
  method:'POST',cache:'no-store',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify({action:'import-tag-profile-images',slots})
 });
 if(!response.ok||auth.currentUser?.uid!==uid)throw Error('TAG_IMAGE_IMPORT_FAILED');
 return await response.json() as {images:Partial<Record<'photoUrl'|'coverUrl'|'backgroundUrl',string>>;skipped:ProfileImportSlot[]};
}
