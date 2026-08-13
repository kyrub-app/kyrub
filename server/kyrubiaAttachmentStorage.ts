import {
  KYRUB_AI_ATTACHMENT_LIMITS,
  type KyrubAiAttachmentMimeType,
  type KyrubAiAttachmentRef,
} from '../shared/aiConsultant.js';
import { adminStorage } from './firebaseAdmin.js';

const DEFAULT_STORAGE_BUCKET = 'kyrub-b8d0e.firebasestorage.app';
const ACCEPTED_MIME_TYPES = new Set<KyrubAiAttachmentMimeType>([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

export class KyrubiaAttachmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KyrubiaAttachmentValidationError';
  }
}

const positiveInteger = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
  }
  return 0;
};

const expectedPath = (
  uid: string,
  conversationId: string,
  attachmentId: string
): string => `kyrubia-attachments/${uid}/${conversationId}/${attachmentId}`;

const maximumBytesForMime = (mimeType: KyrubAiAttachmentMimeType): number =>
  mimeType === 'application/pdf'
    ? KYRUB_AI_ATTACHMENT_LIMITS.maxPdfBytes
    : KYRUB_AI_ATTACHMENT_LIMITS.maxImageBytes;

const validateReferenceShape = (
  uid: string,
  conversationId: string,
  attachment: KyrubAiAttachmentRef
): void => {
  if (!/^att_[a-z0-9]+$/i.test(attachment.id)) {
    throw new KyrubiaAttachmentValidationError('O identificador de um anexo é inválido.');
  }
  if (!ACCEPTED_MIME_TYPES.has(attachment.mimeType)) {
    throw new KyrubiaAttachmentValidationError('O tipo de um anexo não é compatível.');
  }
  const expected = expectedPath(uid, conversationId, attachment.id);
  if (attachment.storagePath !== expected) {
    throw new KyrubiaAttachmentValidationError('A referência privada de um anexo é inválida.');
  }
  const maximum = maximumBytesForMime(attachment.mimeType);
  if (!Number.isSafeInteger(attachment.size) || attachment.size <= 0 || attachment.size > maximum) {
    throw new KyrubiaAttachmentValidationError('O tamanho declarado de um anexo é inválido.');
  }
};

export type KyrubiaInlineAttachmentPart = {
  inline_data: {
    mime_type: KyrubAiAttachmentMimeType;
    data: string;
  };
};

export const loadKyrubiaInlineAttachmentParts = async (
  uid: string,
  conversationId: string,
  attachments: KyrubAiAttachmentRef[]
): Promise<KyrubiaInlineAttachmentPart[]> => {
  if (attachments.length > KYRUB_AI_ATTACHMENT_LIMITS.maxFilesPerMessage) {
    throw new KyrubiaAttachmentValidationError('Há anexos demais nesta mensagem.');
  }

  const bucket = adminStorage.bucket(
    process.env.FIREBASE_STORAGE_BUCKET?.trim() || DEFAULT_STORAGE_BUCKET
  );
  const parts: KyrubiaInlineAttachmentPart[] = [];
  let totalBytes = 0;

  for (const attachment of attachments) {
    validateReferenceShape(uid, conversationId, attachment);
    const file = bucket.file(attachment.storagePath);
    let metadata;
    try {
      [metadata] = await file.getMetadata();
    } catch {
      throw new KyrubiaAttachmentValidationError(
        `O anexo “${attachment.name}” não está disponível no armazenamento privado.`
      );
    }

    const actualMime = metadata.contentType as KyrubAiAttachmentMimeType | undefined;
    const actualSize = positiveInteger(metadata.size);
    const custom = metadata.metadata ?? {};
    if (
      actualMime !== attachment.mimeType ||
      !actualMime ||
      !ACCEPTED_MIME_TYPES.has(actualMime) ||
      actualSize !== attachment.size ||
      actualSize > maximumBytesForMime(attachment.mimeType) ||
      custom.ownerId !== uid ||
      custom.conversationId !== conversationId ||
      custom.attachmentId !== attachment.id ||
      custom.purpose !== 'kyrubia-conversation'
    ) {
      throw new KyrubiaAttachmentValidationError(
        `O anexo “${attachment.name}” não passou pela validação privada do Kyrub.`
      );
    }

    totalBytes += actualSize;
    if (totalBytes > KYRUB_AI_ATTACHMENT_LIMITS.maxTotalBytesPerMessage) {
      throw new KyrubiaAttachmentValidationError(
        'Os anexos juntos ultrapassam o limite permitido por mensagem.'
      );
    }

    let bytes: Buffer;
    try {
      [bytes] = await file.download();
    } catch {
      throw new KyrubiaAttachmentValidationError(
        `Não foi possível ler o anexo “${attachment.name}” no armazenamento privado.`
      );
    }

    if (bytes.byteLength !== actualSize) {
      throw new KyrubiaAttachmentValidationError(
        `O anexo “${attachment.name}” mudou durante a leitura e foi rejeitado.`
      );
    }

    parts.push({
      inline_data: {
        mime_type: attachment.mimeType,
        data: bytes.toString('base64'),
      },
    });
  }

  return parts;
};
