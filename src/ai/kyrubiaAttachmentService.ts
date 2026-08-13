import type { User } from 'firebase/auth';
import {
  deleteObject,
  ref,
  uploadBytes,
} from 'firebase/storage';
import {
  KYRUB_AI_ATTACHMENT_LIMITS,
  type KyrubAiAttachmentMimeType,
  type KyrubAiAttachmentRef,
} from '../../shared/aiConsultant';
import { storage } from '../utils/firebase';

const ACCEPTED_MIME_TYPES = new Set<KyrubAiAttachmentMimeType>([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
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
      uploaded.push({
        id: attachmentId,
        name: safeFileName(file.name),
        mimeType,
        size: file.size,
        storagePath,
      });
    }
    return uploaded;
  } catch (error) {
    await Promise.allSettled(
      uploaded.map(item => deleteObject(ref(storage, item.storagePath)))
    );
    throw error;
  }
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
