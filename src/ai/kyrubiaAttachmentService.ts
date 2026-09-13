import type { User } from 'firebase/auth';
import {
  deleteObject,
  getBytes,
  ref,
  uploadBytes,
} from 'firebase/storage';
import {
  KYRUB_AI_ATTACHMENT_LIMITS,
  type KyrubAiAttachmentMimeType,
  type KyrubAiAttachmentRef,
} from '../../shared/aiConsultant';
import { uploadCurrentUserImage } from '../utils/appImageStorage';
import { storage } from '../utils/firebase';
import { loadKyrubiaOperationalWorkflow } from './operationalWorkflowStore';

const ACCEPTED_MIME_TYPES = new Set<KyrubAiAttachmentMimeType>([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

const IMAGE_MIME_TYPES = new Set<KyrubAiAttachmentMimeType>([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const TRUSTED_FIREBASE_DOWNLOAD_HOSTS = new Set([
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
]);

const extensionMimeType = (name: string): KyrubAiAttachmentMimeType | null => {
  const extension = name.trim().toLocaleLowerCase('pt-BR').split('.').pop() ?? '';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'pdf') return 'application/pdf';
  return null;
};

const normalizeMimeType = (file: File): KyrubAiAttachmentMimeType | null => {
  const declared = file.type.trim().toLocaleLowerCase('pt-BR');
  if (ACCEPTED_MIME_TYPES.has(declared as KyrubAiAttachmentMimeType)) {
    return declared as KyrubAiAttachmentMimeType;
  }
  return extensionMimeType(file.name);
};

const safeFileName = (name: string): string =>
  name.replace(/[\u0000-\u001f\u007f]/g, '').trim()
    .slice(0, KYRUB_AI_ATTACHMENT_LIMITS.maxNameCharacters) || 'anexo';

const createAttachmentId = (): string => {
  try {
    return `att_${globalThis.crypto.randomUUID().replace(/-/g, '')}`;
  } catch {
    return `att_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
  }
};

const normalizedFile = (file: File): File => {
  const mimeType = normalizeMimeType(file);
  if (!mimeType) {
    throw new Error(
      `O arquivo “${safeFileName(file.name)}” não é compatível. Use JPG, PNG, WEBP ou PDF.`
    );
  }
  if (file.type === mimeType) return file;
  return new File([file], safeFileName(file.name), {
    type: mimeType,
    lastModified: file.lastModified,
  });
};

const isWaitingForCanonicalProductPhoto = (
  user: User,
  conversationId: string
): boolean => {
  if (typeof localStorage === 'undefined') return false;
  const workflow = loadKyrubiaOperationalWorkflow(
    localStorage,
    user.uid,
    conversationId
  );
  return workflow?.objective === 'create_product' &&
    workflow.stage === 'collecting_product_photo';
};

const trustedCanonicalImageUrl = (
  user: User,
  attachment: KyrubAiAttachmentRef
): string | null => {
  const canonicalPath = attachment.canonicalImageStoragePath;
  const canonicalUrl = attachment.canonicalImageUrl;
  if (
    typeof canonicalPath !== 'string' ||
    typeof canonicalUrl !== 'string' ||
    !canonicalPath.startsWith(`app-images/${user.uid}/`)
  ) {
    return null;
  }

  try {
    const parsed = new URL(canonicalUrl);
    if (
      parsed.protocol !== 'https:' ||
      !TRUSTED_FIREBASE_DOWNLOAD_HOSTS.has(parsed.hostname)
    ) {
      return null;
    }
    const marker = '/o/';
    const markerIndex = parsed.pathname.lastIndexOf(marker);
    if (markerIndex < 0) return null;
    const encodedObjectPath = parsed.pathname.slice(markerIndex + marker.length);
    if (decodeURIComponent(encodedObjectPath) !== canonicalPath) return null;
    return canonicalUrl;
  } catch {
    return null;
  }
};

export const normalizeKyrubiaAttachmentFiles = (
  input: Iterable<File>
): File[] => {
  const files = Array.from(input, normalizedFile);
  if (files.length > KYRUB_AI_ATTACHMENT_LIMITS.maxFilesPerMessage) {
    throw new Error(
      `Envie no máximo ${KYRUB_AI_ATTACHMENT_LIMITS.maxFilesPerMessage} anexos por mensagem.`
    );
  }

  let totalBytes = 0;
  for (const file of files) {
    if (file.size <= 0) {
      throw new Error(`O arquivo “${safeFileName(file.name)}” está vazio.`);
    }
    const mimeType = normalizeMimeType(file);
    const maximum = mimeType === 'application/pdf'
      ? KYRUB_AI_ATTACHMENT_LIMITS.maxPdfBytes
      : KYRUB_AI_ATTACHMENT_LIMITS.maxImageBytes;
    if (file.size > maximum) {
      const maximumMb = Math.floor(maximum / (1024 * 1024));
      throw new Error(
        `O arquivo “${safeFileName(file.name)}” ultrapassa o limite de ${maximumMb} MB.`
      );
    }
    totalBytes += file.size;
  }

  if (totalBytes > KYRUB_AI_ATTACHMENT_LIMITS.maxTotalBytesPerMessage) {
    const maximumMb = Math.floor(
      KYRUB_AI_ATTACHMENT_LIMITS.maxTotalBytesPerMessage / (1024 * 1024)
    );
    throw new Error(`Os anexos juntos ultrapassam o limite de ${maximumMb} MB por mensagem.`);
  }

  return files;
};

export const mergeKyrubiaAttachmentFiles = (
  current: File[],
  added: Iterable<File>
): File[] => normalizeKyrubiaAttachmentFiles([...current, ...Array.from(added)]);

export const uploadKyrubiaAttachments = async (
  user: User,
  conversationId: string,
  files: File[]
): Promise<KyrubAiAttachmentRef[]> => {
  const normalized = normalizeKyrubiaAttachmentFiles(files);
  const uploaded: KyrubAiAttachmentRef[] = [];
  const persistCanonicalProductPhoto = isWaitingForCanonicalProductPhoto(
    user,
    conversationId
  );
  let canonicalProductPhotoBound = false;

  try {
    for (const file of normalized) {
      const attachmentId = createAttachmentId();
      const mimeType = normalizeMimeType(file);
      if (!mimeType) throw new Error('Tipo de anexo inválido.');
      const storagePath = [
        'kyrubia-attachments',
        user.uid,
        conversationId,
        attachmentId,
      ].join('/');
      const attachmentRef = ref(storage, storagePath);
      await uploadBytes(attachmentRef, file, {
        contentType: mimeType,
        cacheControl: 'private,max-age=0,no-store',
        customMetadata: {
          ownerId: user.uid,
          conversationId,
          attachmentId,
          purpose: 'kyrubia-conversation',
          originalName: safeFileName(file.name),
        },
      });

      const uploadedAttachment: KyrubAiAttachmentRef = {
        id: attachmentId,
        name: safeFileName(file.name),
        mimeType,
        size: file.size,
        storagePath,
      };
      uploaded.push(uploadedAttachment);

      if (
        persistCanonicalProductPhoto &&
        !canonicalProductPhotoBound &&
        IMAGE_MIME_TYPES.has(mimeType)
      ) {
        const canonicalImage = await uploadCurrentUserImage(file);
        uploadedAttachment.canonicalImageStoragePath = canonicalImage.fileId;
        uploadedAttachment.canonicalImageUrl = canonicalImage.url;
        canonicalProductPhotoBound = true;
      }
    }
    return uploaded;
  } catch (error) {
    await Promise.allSettled(
      uploaded.map(item => deleteObject(ref(storage, item.storagePath)))
    );
    throw error;
  }
};

export const isKyrubiaImageAttachment = (
  attachment: KyrubAiAttachmentRef
): boolean => IMAGE_MIME_TYPES.has(attachment.mimeType);

export const promoteKyrubiaImageAttachment = async (
  user: User,
  attachment: KyrubAiAttachmentRef
): Promise<string> => {
  if (!isKyrubiaImageAttachment(attachment)) {
    throw new Error('Envie uma imagem JPG, PNG ou WEBP para usar como foto do produto.');
  }
  const ownPrefix = `kyrubia-attachments/${user.uid}/`;
  if (!attachment.storagePath.startsWith(ownPrefix)) {
    throw new Error('A foto precisa pertencer à sua conversa autenticada.');
  }

  const directCanonicalUrl = trustedCanonicalImageUrl(user, attachment);
  if (directCanonicalUrl) return directCanonicalUrl;

  // Compatibility fallback for attachments created before direct canonical photo
  // persistence existed. New product-photo turns avoid this fragile browser
  // download-and-reupload round trip entirely.
  const bytes = await getBytes(
    ref(storage, attachment.storagePath),
    KYRUB_AI_ATTACHMENT_LIMITS.maxImageBytes
  );
  const file = new File([bytes], safeFileName(attachment.name), {
    type: attachment.mimeType,
  });
  const uploadedImage = await uploadCurrentUserImage(file);
  return uploadedImage.url;
};

export const deleteKyrubiaAttachments = async (
  user: User,
  attachments: KyrubAiAttachmentRef[]
): Promise<void> => {
  const ownPrefix = `kyrubia-attachments/${user.uid}/`;
  const uniquePaths = Array.from(new Set(
    attachments
      .map(item => item.storagePath)
      .filter(path => path.startsWith(ownPrefix))
  ));
  await Promise.allSettled(
    uniquePaths.map(path => deleteObject(ref(storage, path)))
  );
};