import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, storage } from './firebase';

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

const contentHash = async (file: File): Promise<string> => {
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
  const hash = await contentHash(file);
  const path = `app-images/${user.uid}/${hash}`;
  const imageReference = ref(storage, path);

  await uploadBytes(imageReference, file, {
    contentType: file.type,
    customMetadata: {
      ownerId: user.uid,
      contentHash: hash,
      originalName: file.name.slice(0, 160),
    },
  });

  return {
    provider: 'firebase_storage',
    fileId: path,
    fileName: file.name || 'Imagem enviada',
    mimeType: file.type,
    sizeBytes: file.size,
    url: await getDownloadURL(imageReference),
  };
};
