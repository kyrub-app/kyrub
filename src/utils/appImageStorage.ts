import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, storage } from './firebase';
import {optimizeCommunityWallImage} from './communityWallImageOptimization';

export const APP_IMAGE_MAX_SIZE_BYTES = 10 * 1024 * 1024;
export const APP_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';

const allowedContentTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export interface FirebaseImageSelection {
  provider: 'firebase_storage';
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

const pendingUploads=new Map<string,Promise<string>>();

const contentHash = async (file: Blob): Promise<string> => {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map(value => value.toString(16).padStart(2, '0'))
    .join('');
};

const validateImage = (file: File): void => {
  if (!allowedContentTypes.has(file.type)) {
    throw new Error('Use uma imagem JPEG, PNG ou WebP.');
  }
  if (file.size <= 0) {
    throw new Error('A imagem selecionada está vazia.');
  }
  if (file.size > APP_IMAGE_MAX_SIZE_BYTES) {
    throw new Error('A imagem precisa ter no máximo 10 MB.');
  }
};

export const uploadCurrentUserImage = async (
  file: File
): Promise<FirebaseImageSelection> => {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Faça login novamente antes de enviar a imagem.');
  }

  validateImage(file);
  // Only large JPEGs are eligible; the existing conservative codec retains
  // originals on unsupported browsers or when the size gain is insufficient.
  const payload=await optimizeCommunityWallImage(file);
  const hash = await contentHash(payload);
  if(auth.currentUser?.uid!==user.uid)throw Error('A sessão mudou. Tente novamente.');
  const path = `app-images/${user.uid}/${hash}`;
  const imageReference = ref(storage, path);
  let pending=pendingUploads.get(path);
  if(!pending){
    const task=(async()=>{
      await uploadBytes(imageReference, payload, {
        contentType: payload.type,
        customMetadata: {ownerId:user.uid,contentHash:hash,originalName:file.name.slice(0,160)},
      });
      if(auth.currentUser?.uid!==user.uid)throw Error('A sessão mudou. Tente novamente.');
      return getDownloadURL(imageReference);
    })().finally(()=>{if(pendingUploads.get(path)===task)pendingUploads.delete(path);});
    pendingUploads.set(path,task);
    pending=task;
  }
  const url=await pending;
  if(auth.currentUser?.uid!==user.uid)throw Error('A sessão mudou. Tente novamente.');

  return {
    provider: 'firebase_storage',
    fileId: path,
    fileName: file.name || 'Imagem enviada',
    mimeType: payload.type,
    sizeBytes: payload.size,
    url,
  };
};
