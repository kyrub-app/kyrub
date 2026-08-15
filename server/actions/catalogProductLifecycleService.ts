import { FieldValue, type Timestamp } from 'firebase-admin/firestore';
import type {
  KyrubActionExecutionResult,
} from '../../shared/kyrubActions.js';
import type {
  KyrubCatalogDraftListItem,
  KyrubCatalogDraftListResponse,
  KyrubCatalogDraftProductInput,
} from '../../shared/kyrubCatalogDrafts.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';
import { KyrubActionExecutionError } from './actionExecutionService.js';
import {
  executeAuthorizedKyrubCatalogDraft as executeStagedCatalogDraft,
  isKyrubCatalogDraftExecutionRequest,
  isKyrubCatalogDraftListRequest,
} from './catalogDraftExecutionService.js';

const MAX_PRODUCTS = 200;
const FREE_PRODUCT_LIMIT = 5;

const cleanText = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const finiteNonNegative = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;

const integerNonNegative = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const verifyActor = async (authorization: string) => {
  const token = bearerToken(authorization);
  if (!token) {
    throw new KyrubActionExecutionError(
      401,
      'AUTH_REQUIRED',
      'Faça login novamente para acessar seus produtos.'
    );
  }

  try {
    return await verifyFirebaseIdToken(token);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
    if (code === 'AUTH_UNAVAILABLE') {
      throw new KyrubActionExecutionError(
        503,
        'AUTH_UNAVAILABLE',
        'Não foi possível validar sua sessão agora.'
      );
    }
    throw new KyrubActionExecutionError(
      401,
      'AUTH_REQUIRED',
      'Sua sessão expirou. Entre novamente no Kyrub.'
    );
  }
};

const privateStoreForActor = async (uid: string) => {
  const snapshot = await adminDb.doc(`users/${uid}/stores/${uid}`).get();
  if (!snapshot.exists) {
    throw new KyrubActionExecutionError(
      409,
      'STORE_REQUIRED',
      'Ative sua Loja Kyrub antes de cadastrar produtos.'
    );
  }

  const data = snapshot.data() as Record<string, unknown>;
  const canonicalStoreId = cleanText(data.canonicalStoreId, 160);
  if (!canonicalStoreId) {
    throw new KyrubActionExecutionError(
      409,
      'CANONICAL_STORE_REQUIRED',
      'A Loja Kyrub ainda não possui um catálogo canônico ativo.'
    );
  }

  return { data, canonicalStoreId };
};

const timestampToIso = (value: unknown): string => {
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as Timestamp).toDate().toISOString();
  }
  return typeof value === 'string' ? value : '';
};

const requestRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new KyrubActionExecutionError(
      400,
      'INVALID_REQUEST',
      'A solicitação de produto é inválida.'
    );
  }
  return value as Record<string, unknown>;
};

const proposalProduct = (rawRequest: unknown): KyrubCatalogDraftProductInput => {
  const body = requestRecord(rawRequest);
  const proposal = requestRecord(body.proposal);
  const product = requestRecord(proposal.product);
  const name = cleanText(product.name, 120);
  const category = cleanText(product.category, 120);
  const price = finiteNonNegative(product.price);

  if (!name) {
    throw new KyrubActionExecutionError(
      400,
      'INVALID_PRODUCT_DRAFT',
      'Informe o nome do produto antes de adicioná-lo ao catálogo.'
    );
  }
  if (!category || price === null) {
    throw new KyrubActionExecutionError(
      409,
      'INCOMPLETE_PRODUCT_DRAFT',
      'Antes de adicionar o produto ao catálogo, confirme pelo menos o preço e a categoria.'
    );
  }

  return product as KyrubCatalogDraftProductInput;
};

const canonicalProductData = (
  actorUid: string,
  canonicalStoreId: string,
  productId: string,
  product: KyrubCatalogDraftProductInput,
  actionExecutionId: string
) => {
  const isService = product.isService === true;
  const price = product.isComplimentary === true
    ? 0
    : finiteNonNegative(product.price) ?? 0;
  const stock = isService ? 0 : integerNonNegative(product.stock) ?? 0;

  return {
    id: productId,
    storeId: canonicalStoreId,
    supplierId: canonicalStoreId,
    name: cleanText(product.name, 120),
    description: cleanText(product.description, 2_000),
    price,
    image: cleanText(product.image, 2_000),
    stock,
    category: cleanText(product.category, 120),
    isService,
    publicationStatus: 'draft',
    createdByUserId: actorUid,
    createdByRole: 'owner',
    updatedByUserId: actorUid,
    updatedByRole: 'owner',
    legacyStoreId: actorUid,
    legacyProductId: productId,
    legacySupplierId: actorUid,
    legacyUpdatedAt: '',
    migratedFromPath: `tenants/${actorUid}#publicProducts/${productId}`,
    archivedAt: '',
    migration: {
      mode: 'dual_write',
      migratedByUserId: actorUid,
      migratedByRole: 'owner',
    },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    kyrubiaActionExecutionId: actionExecutionId,
  };
};

const canonicalProductFromSnapshot = (
  id: string,
  data: Record<string, unknown>
): KyrubCatalogDraftListItem | null => {
  if (cleanText(data.publicationStatus, 20) !== 'draft') return null;

  const name = cleanText(data.name, 120);
  const category = cleanText(data.category, 120);
  const price = finiteNonNegative(data.price);
  const stock = integerNonNegative(data.stock);
  if (!name || !category || price === null || stock === null) return null;

  return {
    id,
    storeId: cleanText(data.legacyStoreId, 160),
    canonicalStoreId: cleanText(data.storeId, 160),
    status: 'draft',
    source: { kind: 'catalog_analysis' },
    product: {
      name,
      description: cleanText(data.description, 2_000),
      price,
      stock,
      category,
      image: cleanText(data.image, 2_000),
      isService: data.isService === true,
    },
    issues: [],
    createdAtIso: timestampToIso(data.createdAt),
    updatedAtIso: timestampToIso(data.updatedAt),
  };
};

export { isKyrubCatalogDraftExecutionRequest, isKyrubCatalogDraftListRequest };

export const executeAuthorizedKyrubCatalogDraft = async (
  authorization: string,
  rawRequest: unknown
): Promise<KyrubActionExecutionResult> => {
  const product = proposalProduct(rawRequest);
  const actor = await verifyActor(authorization);
  const { canonicalStoreId } = await privateStoreForActor(actor.uid);

  // Reuse the mature policy/idempotency executor, then immediately promote the
  // temporary record into the one canonical product entity with status=draft.
  const result = await executeStagedCatalogDraft(authorization, rawRequest);
  const productId = cleanText(result.entityId, 160);
  if (!productId) {
    throw new KyrubActionExecutionError(
      500,
      'PRODUCT_DRAFT_FAILED',
      'O Kyrub não conseguiu identificar o produto criado.'
    );
  }

  const stagingReference = adminDb.doc(
    `kyrub_catalog_drafts/${actor.uid}/drafts/${productId}`
  );
  const canonicalReference = adminDb.doc(
    `stores/${canonicalStoreId}/products/${productId}`
  );

  await adminDb.runTransaction(async transaction => {
    const [staged, existingCanonical] = await Promise.all([
      transaction.get(stagingReference),
      transaction.get(canonicalReference),
    ]);

    if (existingCanonical.exists) {
      const existing = existingCanonical.data() as Record<string, unknown>;
      if (
        cleanText(existing.kyrubiaActionExecutionId, 160) !==
        cleanText(result.executionEnvelope?.executionId, 160)
      ) {
        throw new KyrubActionExecutionError(
          409,
          'PRODUCT_ID_CONFLICT',
          'Já existe outro produto com este identificador.'
        );
      }
      if (staged.exists) transaction.delete(stagingReference);
      return;
    }

    transaction.set(
      canonicalReference,
      canonicalProductData(
        actor.uid,
        canonicalStoreId,
        productId,
        product,
        cleanText(result.executionEnvelope?.executionId, 160)
      )
    );
    if (staged.exists) transaction.delete(stagingReference);
  });

  return result;
};

export const listAuthorizedKyrubCatalogDrafts = async (
  authorization: string
): Promise<KyrubCatalogDraftListResponse> => {
  const actor = await verifyActor(authorization);
  const { canonicalStoreId } = await privateStoreForActor(actor.uid);
  const snapshot = await adminDb
    .collection(`stores/${canonicalStoreId}/products`)
    .where('publicationStatus', '==', 'draft')
    .limit(100)
    .get();

  return {
    drafts: snapshot.docs.flatMap(document => {
      const item = canonicalProductFromSnapshot(
        document.id,
        document.data() as Record<string, unknown>
      );
      return item ? [item] : [];
    }),
  };
};

export const isKyrubCatalogProductPublicationRequest = (value: unknown): boolean =>
  Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).operation === 'set_catalog_product_publication'
  );

const legacyProductFromCanonical = (
  actorUid: string,
  productId: string,
  canonical: Record<string, unknown>,
  updatedAt: string
) => ({
  id: productId,
  storeId: actorUid,
  supplierId: actorUid,
  name: cleanText(canonical.name, 120),
  description: cleanText(canonical.description, 2_000),
  price: finiteNonNegative(canonical.price) ?? 0,
  image: cleanText(canonical.image, 2_000),
  stock: canonical.isService === true ? 0 : integerNonNegative(canonical.stock) ?? 0,
  category: cleanText(canonical.category, 120),
  isService: canonical.isService === true,
  updatedAt,
});

export const setAuthorizedKyrubCatalogProductPublication = async (
  authorization: string,
  rawRequest: unknown
): Promise<{ productId: string; publicationStatus: 'draft' | 'published' }> => {
  const actor = await verifyActor(authorization);
  const body = requestRecord(rawRequest);
  const productId = cleanText(body.productId, 160);
  const published = body.published === true;
  if (!productId || typeof body.published !== 'boolean') {
    throw new KyrubActionExecutionError(
      400,
      'INVALID_PUBLICATION_REQUEST',
      'A alteração de publicação do produto é inválida.'
    );
  }

  const { data: store, canonicalStoreId } = await privateStoreForActor(actor.uid);
  const canonicalReference = adminDb.doc(
    `stores/${canonicalStoreId}/products/${productId}`
  );
  const tenantReference = adminDb.doc(`tenants/${actor.uid}`);
  const nowIso = new Date().toISOString();

  await adminDb.runTransaction(async transaction => {
    const [canonicalSnapshot, tenantSnapshot] = await Promise.all([
      transaction.get(canonicalReference),
      transaction.get(tenantReference),
    ]);
    if (!canonicalSnapshot.exists) {
      throw new KyrubActionExecutionError(
        404,
        'PRODUCT_NOT_FOUND',
        'Este produto não foi encontrado no catálogo da loja.'
      );
    }

    const canonical = canonicalSnapshot.data() as Record<string, unknown>;
    if (
      cleanText(canonical.storeId, 160) !== canonicalStoreId ||
      cleanText(canonical.legacyStoreId, 160) !== actor.uid
    ) {
      throw new KyrubActionExecutionError(
        403,
        'PRODUCT_FORBIDDEN',
        'Este produto não pertence à loja autenticada.'
      );
    }

    const tenant = tenantSnapshot.data() as Record<string, unknown> | undefined;
    const currentProducts = Array.isArray(tenant?.publicProducts)
      ? tenant.publicProducts.filter(
          item => item && typeof item === 'object' && !Array.isArray(item)
        ) as Record<string, unknown>[]
      : [];
    const alreadyPublished = currentProducts.some(
      item => cleanText(item.id, 160) === productId
    );

    if (published) {
      const name = cleanText(canonical.name, 120);
      const category = cleanText(canonical.category, 120);
      const price = finiteNonNegative(canonical.price);
      const stock = integerNonNegative(canonical.stock);
      if (!name || !category || price === null || stock === null) {
        throw new KyrubActionExecutionError(
          409,
          'INCOMPLETE_PRODUCT',
          'Complete os dados obrigatórios do produto antes de publicá-lo.'
        );
      }

      if (
        cleanText(store.plan, 20) === 'free' &&
        !alreadyPublished &&
        currentProducts.length >= FREE_PRODUCT_LIMIT
      ) {
        throw new KyrubActionExecutionError(
          409,
          'PRODUCT_LIMIT_REACHED',
          'O plano gratuito permite publicar até 5 produtos ou serviços.'
        );
      }

      const publicProduct = legacyProductFromCanonical(
        actor.uid,
        productId,
        canonical,
        nowIso
      );
      const nextProducts = [
        publicProduct,
        ...currentProducts.filter(item => cleanText(item.id, 160) !== productId),
      ].slice(0, MAX_PRODUCTS);

      transaction.set(
        tenantReference,
        {
          publicProducts: nextProducts,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      transaction.update(canonicalReference, {
        publicationStatus: 'published',
        legacyUpdatedAt: nowIso,
        updatedByUserId: actor.uid,
        updatedByRole: 'owner',
        archivedAt: '',
        updatedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    transaction.set(
      tenantReference,
      {
        publicProducts: currentProducts.filter(
          item => cleanText(item.id, 160) !== productId
        ),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    transaction.update(canonicalReference, {
      publicationStatus: 'draft',
      updatedByUserId: actor.uid,
      updatedByRole: 'owner',
      archivedAt: '',
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    productId,
    publicationStatus: published ? 'published' : 'draft',
  };
};
