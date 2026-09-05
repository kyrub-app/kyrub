import { createHash } from 'node:crypto';
import { adminStorage } from '../firebaseAdmin.js';
import { KyrubActionExecutionError } from './actionExecutionService.js';

const MAX_PRODUCT_MEDIA_ITEMS = 10;
const MAX_PRODUCT_MEDIA_BYTES = 10 * 1024 * 1024;
const STORAGE_BUCKET =
  process.env.FIREBASE_STORAGE_BUCKET?.trim() ||
  'kyrub-b8d0e.firebasestorage.app';

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const deterministicDownloadToken = (seed: string): string => {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const publicFirebaseStorageUrl = (
  bucketName: string,
  objectPath: string,
  token: string
): string =>
  `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucketName)}/o/${encodeURIComponent(objectPath)}?alt=media&token=${encodeURIComponent(token)}`;

export const normalizeKyrubiaProductAttachmentPaths = (
  value: unknown
): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new KyrubActionExecutionError(
      400,
      'INVALID_PRODUCT_MEDIA',
      'As imagens escolhidas para o produto são inválidas.'
    );
  }

  const seen = new Set<string>();
  const paths = value.flatMap(item => {
    const path = clean(item);
    if (!path || seen.has(path)) return [];
    seen.add(path);
    return [path];
  });

  if (paths.length === 0 || paths.length > MAX_PRODUCT_MEDIA_ITEMS) {
    throw new KyrubActionExecutionError(
      400,
      'INVALID_PRODUCT_MEDIA',
      `Selecione entre 1 e ${MAX_PRODUCT_MEDIA_ITEMS} imagens para o produto.`
    );
  }
  return paths;
};

export type PromotedProductAttachments = {
  urls: string[];
  objectPaths: string[];
  createdObjectPaths: string[];
};

export const promoteKyrubiaProductAttachments = async (input: {
  actorUid: string;
  productId: string;
  sourceAttachmentPaths: string[];
}): Promise<PromotedProductAttachments> => {
  const ownerPrefix = `kyrubia-attachments/${input.actorUid}/`;
  const bucket = adminStorage.bucket(STORAGE_BUCKET);
  const urls: string[] = [];
  const objectPaths: string[] = [];
  const createdObjectPaths: string[] = [];

  for (const sourcePath of input.sourceAttachmentPaths) {
    if (
      !sourcePath.startsWith(ownerPrefix) ||
      sourcePath.includes('..') ||
      sourcePath.includes('\\')
    ) {
      throw new KyrubActionExecutionError(
        403,
        'PRODUCT_MEDIA_OWNERSHIP_REQUIRED',
        'Uma das imagens não pertence à conversa do usuário autenticado.'
      );
    }

    const source = bucket.file(sourcePath);
    const [exists] = await source.exists();
    if (!exists) {
      throw new KyrubActionExecutionError(
        404,
        'PRODUCT_MEDIA_NOT_FOUND',
        'Uma das imagens da conversa não está mais disponível.'
      );
    }

    const [metadata] = await source.getMetadata();
    const contentType = clean(metadata.contentType).toLowerCase();
    const extension = IMAGE_EXTENSIONS[contentType];
    if (!extension) {
      throw new KyrubActionExecutionError(
        400,
        'PRODUCT_MEDIA_TYPE_UNSUPPORTED',
        'Somente imagens JPG, PNG ou WEBP podem virar mídia de produto.'
      );
    }
    const size = Number(metadata.size ?? 0);
    if (!Number.isFinite(size) || size <= 0 || size > MAX_PRODUCT_MEDIA_BYTES) {
      throw new KyrubActionExecutionError(
        400,
        'PRODUCT_MEDIA_SIZE_INVALID',
        'Uma das imagens excede o limite permitido para mídia de produto.'
      );
    }

    const fingerprint = createHash('sha256')
      .update(`${input.actorUid}:${input.productId}:${sourcePath}`)
      .digest('hex')
      .slice(0, 32);
    const destinationPath = `app-images/${input.actorUid}/${input.productId}-${fingerprint}.${extension}`;
    const token = deterministicDownloadToken(destinationPath);
    const destination = bucket.file(destinationPath);
    const [destinationExists] = await destination.exists();

    if (!destinationExists) {
      const [buffer] = await source.download();
      await destination.save(buffer, {
        resumable: false,
        contentType,
        metadata: {
          cacheControl: 'public,max-age=31536000,immutable',
          metadata: {
            firebaseStorageDownloadTokens: token,
            kyrubSourceAttachment: sourcePath,
            kyrubProductId: input.productId,
          },
        },
      });
      createdObjectPaths.push(destinationPath);
    }

    objectPaths.push(destinationPath);
    urls.push(publicFirebaseStorageUrl(STORAGE_BUCKET, destinationPath, token));
  }

  return { urls, objectPaths, createdObjectPaths };
};

export const cleanupNewProductAttachments = async (
  objectPaths: string[]
): Promise<void> => {
  if (objectPaths.length === 0) return;
  const bucket = adminStorage.bucket(STORAGE_BUCKET);
  await Promise.allSettled(
    objectPaths.map(path => bucket.file(path).delete({ ignoreNotFound: true }))
  );
};
