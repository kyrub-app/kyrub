import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';

interface MercadoLivreImportDraftRecord {
  id: string;
  storeId: string;
  source: 'mercado_livre';
  status: 'draft';
  title: string;
  price: number | null;
  categoryId: string;
  thumbnail?: string;
  sellerSku?: string;
  sourceAvailableQuantity?: number;
  provenance: {
    source: 'mercado_livre';
    externalId: string;
    connectionId: string;
    importedAt: string;
    lastSyncedAt: string;
  };
  createdAt: string;
  updatedAt: string;
  kyrubPreparationDraftId?: string;
  preparedFromUpdatedAt?: string;
  preparationStatus?: 'prepared';
  promotionStatus?: 'promoted';
  externalCatalogBindingId?: string;
  canonicalProductId?: string;
}

interface MercadoLivrePreparationDraftRecord {
  id: string;
  ownerUid: string;
  storeId: string;
  canonicalStoreId?: string;
  status: 'draft';
  product: {
    name: string;
    price?: number;
    image?: string;
  };
  externalSource: {
    provider: 'mercado_livre';
    connectionId: string;
    externalItemId: string;
    importDraftId: string;
    importDraftUpdatedAt: string;
    importedAt: string;
    lastSyncedAt: string;
    sourceCategoryId: string;
    sellerSku?: string;
    sourceAvailableQuantity?: number;
  };
}

export interface MercadoLivreImportDraftPreparationItem {
  draft: MercadoLivreImportDraftRecord;
  preparation: {
    status: 'not_prepared' | 'prepared' | 'stale' | 'bound';
    kyrubDraftId?: string;
    canonicalProductId?: string;
  };
}

const clean = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const finiteNonNegative = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const integerNonNegative = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const assertImportDraft = (storeId: string, value: unknown): MercadoLivreImportDraftRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_IMPORT_DRAFT_INVALID');
  }
  const record = value as Record<string, unknown>;
  const provenance = record.provenance && typeof record.provenance === 'object' && !Array.isArray(record.provenance)
    ? record.provenance as Record<string, unknown>
    : null;
  if (
    clean(record.storeId, 160) !== storeId ||
    record.source !== 'mercado_livre' ||
    record.status !== 'draft' ||
    !clean(record.id, 160) ||
    !clean(record.title, 120) ||
    !clean(record.updatedAt, 80) ||
    !provenance ||
    provenance.source !== 'mercado_livre' ||
    !clean(provenance.externalId, 160) ||
    !clean(provenance.connectionId, 200) ||
    !clean(provenance.importedAt, 80) ||
    !clean(provenance.lastSyncedAt, 80)
  ) {
    throw new Error('MERCADO_LIVRE_IMPORT_DRAFT_INVALID');
  }
  return record as unknown as MercadoLivreImportDraftRecord;
};

const assertPreparationDraft = (
  storeId: string,
  importDraft: MercadoLivreImportDraftRecord,
  value: unknown
): MercadoLivrePreparationDraftRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_IMPORT_PREPARATION_INVALID');
  }
  const record = value as Record<string, unknown>;
  const externalSource = record.externalSource && typeof record.externalSource === 'object' && !Array.isArray(record.externalSource)
    ? record.externalSource as Record<string, unknown>
    : null;
  const product = record.product && typeof record.product === 'object' && !Array.isArray(record.product)
    ? record.product as Record<string, unknown>
    : null;
  if (
    clean(record.ownerUid, 160) !== storeId ||
    clean(record.storeId, 160) !== storeId ||
    record.status !== 'draft' ||
    !clean(record.id, 160) ||
    !product ||
    !clean(product.name, 120) ||
    !externalSource ||
    externalSource.provider !== 'mercado_livre' ||
    clean(externalSource.connectionId, 200) !== importDraft.provenance.connectionId ||
    clean(externalSource.externalItemId, 160) !== importDraft.provenance.externalId ||
    clean(externalSource.importDraftId, 160) !== importDraft.id ||
    clean(externalSource.importDraftUpdatedAt, 80) !== importDraft.updatedAt
  ) {
    throw new Error('MERCADO_LIVRE_IMPORT_PREPARATION_STALE');
  }
  return record as unknown as MercadoLivrePreparationDraftRecord;
};

const preparationStatus = (draft: MercadoLivreImportDraftRecord): MercadoLivreImportDraftPreparationItem['preparation'] => {
  const kyrubDraftId = clean(draft.kyrubPreparationDraftId, 160);
  const canonicalProductId = clean(draft.canonicalProductId, 160);
  const preparedFrom = clean(draft.preparedFromUpdatedAt, 80);
  if (
    draft.promotionStatus === 'promoted' &&
    canonicalProductId &&
    clean(draft.externalCatalogBindingId, 160)
  ) {
    return { status: 'bound', ...(kyrubDraftId ? { kyrubDraftId } : {}), canonicalProductId };
  }
  if (!kyrubDraftId || draft.preparationStatus !== 'prepared') return { status: 'not_prepared' };
  if (preparedFrom !== clean(draft.updatedAt, 80)) return { status: 'stale', kyrubDraftId };
  return { status: 'prepared', kyrubDraftId };
};

const deterministicPreparationDraftId = (draft: MercadoLivreImportDraftRecord): string =>
  `mlprep_${createHash('sha256')
    .update([
      draft.storeId,
      draft.provenance.connectionId,
      draft.provenance.externalId,
      draft.updatedAt,
    ].join(':'))
    .digest('hex')
    .slice(0, 32)}`;

const externalIdentityHash = (draft: MercadoLivreImportDraftRecord): string =>
  createHash('sha256')
    .update([
      draft.storeId,
      'mercado_livre',
      draft.provenance.connectionId,
      draft.provenance.externalId,
    ].join(':'))
    .digest('hex');

const deterministicBindingId = (draft: MercadoLivreImportDraftRecord): string =>
  `mlbind_${externalIdentityHash(draft).slice(0, 32)}`;

const deterministicCanonicalProductId = (draft: MercadoLivreImportDraftRecord): string =>
  `mlprod_${externalIdentityHash(draft).slice(0, 32)}`;

const canonicalBaselineHash = (input: {
  name: string;
  price: number;
  stock: number;
  category: string;
  image: string;
}): string => createHash('sha256')
  .update(JSON.stringify({
    name: input.name,
    price: input.price,
    stock: input.stock,
    category: input.category,
    image: input.image,
    isService: false,
  }))
  .digest('hex');

export const listMercadoLivreImportDraftsForPreparation = async (input: {
  storeId: string;
  limit?: number;
}): Promise<{ items: MercadoLivreImportDraftPreparationItem[] }> => {
  const storeId = input.storeId.trim();
  if (!storeId) throw new Error('STORE_CONNECTION_STORE_REQUIRED');
  const requestedLimit = Number(input.limit ?? 50);
  const limit = Number.isSafeInteger(requestedLimit)
    ? Math.max(1, Math.min(100, requestedLimit))
    : 50;
  const snapshot = await adminDb
    .collection(`stores/${storeId}/catalogImportDrafts`)
    .limit(limit)
    .get();

  const items: MercadoLivreImportDraftPreparationItem[] = [];
  for (const document of snapshot.docs) {
    try {
      const draft = assertImportDraft(storeId, document.data());
      items.push({ draft, preparation: preparationStatus(draft) });
    } catch {
      // Other providers or malformed historical drafts are not part of this queue.
    }
  }
  items.sort((a, b) => b.draft.updatedAt.localeCompare(a.draft.updatedAt));
  return { items };
};

export const prepareMercadoLivreImportAsKyrubCatalogDraft = async (input: {
  storeId: string;
  importDraftId: string;
  preparedByUserId: string;
}): Promise<{
  importDraftId: string;
  kyrubDraftId: string;
  status: 'prepared';
  missingFields: Array<'price' | 'category' | 'stock'>;
  alreadyPrepared: boolean;
}> => {
  const storeId = input.storeId.trim();
  const importDraftId = input.importDraftId.trim();
  const preparedByUserId = input.preparedByUserId.trim();
  if (!storeId || !importDraftId || !preparedByUserId) {
    throw new Error('MERCADO_LIVRE_IMPORT_PREPARATION_TARGET_INVALID');
  }
  if (preparedByUserId !== storeId) throw new Error('STORE_CONNECTION_FORBIDDEN');

  const importReference = adminDb.doc(`stores/${storeId}/catalogImportDrafts/${importDraftId}`);
  const privateStoreReference = adminDb.doc(`users/${storeId}/stores/${storeId}`);
  let result: {
    importDraftId: string;
    kyrubDraftId: string;
    status: 'prepared';
    missingFields: Array<'price' | 'category' | 'stock'>;
    alreadyPrepared: boolean;
  } | null = null;

  await adminDb.runTransaction(async transaction => {
    const [importDocument, privateStoreDocument] = await Promise.all([
      transaction.get(importReference),
      transaction.get(privateStoreReference),
    ]);
    if (!importDocument.exists) throw new Error('MERCADO_LIVRE_IMPORT_DRAFT_NOT_FOUND');
    if (!privateStoreDocument.exists) throw new Error('STORE_REQUIRED');

    const draft = assertImportDraft(storeId, importDocument.data());
    if (draft.id !== importDraftId) throw new Error('MERCADO_LIVRE_IMPORT_DRAFT_INVALID');
    const existingStatus = preparationStatus(draft);
    if (existingStatus.status === 'bound') {
      throw new Error('MERCADO_LIVRE_IMPORT_ALREADY_BOUND');
    }
    const kyrubDraftId = deterministicPreparationDraftId(draft);
    const kyrubReference = adminDb.doc(`kyrub_catalog_drafts/${storeId}/drafts/${kyrubDraftId}`);
    const existingKyrub = await transaction.get(kyrubReference);
    const currentPreparation = preparationStatus(draft);

    const missingFields: Array<'price' | 'category' | 'stock'> = ['category', 'stock'];
    const providerPrice = finiteNonNegative(draft.price);
    if (providerPrice === null) missingFields.unshift('price');

    if (
      currentPreparation.status === 'prepared' &&
      currentPreparation.kyrubDraftId === kyrubDraftId &&
      existingKyrub.exists
    ) {
      result = {
        importDraftId,
        kyrubDraftId,
        status: 'prepared',
        missingFields,
        alreadyPrepared: true,
      };
      return;
    }

    if (existingKyrub.exists) {
      const existing = existingKyrub.data() as Record<string, unknown>;
      const externalSource = existing.externalSource && typeof existing.externalSource === 'object'
        ? existing.externalSource as Record<string, unknown>
        : null;
      if (
        clean(existing.ownerUid, 160) !== storeId ||
        clean(externalSource?.importDraftId, 160) !== importDraftId ||
        clean(externalSource?.importDraftUpdatedAt, 80) !== draft.updatedAt
      ) {
        throw new Error('MERCADO_LIVRE_IMPORT_PREPARATION_CONFLICT');
      }
    } else {
      const privateStore = privateStoreDocument.data() as Record<string, unknown>;
      const canonicalStoreId = clean(privateStore.canonicalStoreId, 160);
      const now = new Date().toISOString();
      const product: Record<string, unknown> = {
        name: clean(draft.title, 120),
      };
      if (providerPrice !== null) product.price = providerPrice;
      if (clean(draft.thumbnail, 2_000)) product.image = clean(draft.thumbnail, 2_000);

      const fieldProvenance: Record<string, 'tool_output'> = { name: 'tool_output' };
      if (providerPrice !== null) fieldProvenance.price = 'tool_output';
      if (clean(draft.thumbnail, 2_000)) fieldProvenance.image = 'tool_output';

      const issues: Array<Record<string, string>> = [
        {
          code: 'missing_required_field',
          field: 'category',
          message: 'Confirme a categoria Kyrub. A categoria do Mercado Livre não é aplicada automaticamente.',
        },
        {
          code: 'missing_required_field',
          field: 'stock',
          message: 'Informe o estoque inicial Kyrub. A quantidade disponível no Mercado Livre é apenas evidência externa.',
        },
      ];
      if (providerPrice === null) {
        issues.unshift({
          code: 'missing_required_field',
          field: 'price',
          message: 'Informe o preço antes de transformar este rascunho em produto Kyrub.',
        });
      }

      transaction.set(kyrubReference, {
        schemaVersion: 1,
        id: kyrubDraftId,
        ownerUid: storeId,
        storeId,
        ...(canonicalStoreId ? { canonicalStoreId } : {}),
        status: 'draft',
        source: {
          kind: 'mercado_livre',
          sourceRefs: [
            `catalogImportDraft:${importDraftId}`,
            `connection:${draft.provenance.connectionId}`,
            `externalItem:${draft.provenance.externalId}`,
          ],
        },
        product,
        fieldProvenance,
        issues,
        createdAtIso: now,
        updatedAtIso: now,
        serverUpdatedAt: FieldValue.serverTimestamp(),
        preparationAuthority: 'store_owner_import_review',
        preparedByUserId,
        externalSource: {
          provider: 'mercado_livre',
          connectionId: draft.provenance.connectionId,
          externalItemId: draft.provenance.externalId,
          importDraftId,
          importDraftUpdatedAt: draft.updatedAt,
          importedAt: draft.provenance.importedAt,
          lastSyncedAt: draft.provenance.lastSyncedAt,
          sourceCategoryId: draft.categoryId,
          ...(draft.sellerSku ? { sellerSku: draft.sellerSku } : {}),
          ...(draft.sourceAvailableQuantity !== undefined
            ? { sourceAvailableQuantity: draft.sourceAvailableQuantity }
            : {}),
        },
      });
    }

    transaction.update(importReference, {
      preparationStatus: 'prepared',
      preparationAuthority: 'store_owner_import_review',
      preparedByUserId,
      kyrubPreparationDraftId: kyrubDraftId,
      preparedFromUpdatedAt: draft.updatedAt,
      preparedAt: new Date().toISOString(),
      serverPreparedAt: FieldValue.serverTimestamp(),
    });

    result = {
      importDraftId,
      kyrubDraftId,
      status: 'prepared',
      missingFields,
      alreadyPrepared: false,
    };
  });

  if (!result) throw new Error('MERCADO_LIVRE_IMPORT_PREPARATION_FAILED');
  return result;
};

export const finalizeMercadoLivreImportAsCanonicalKyrubProduct = async (input: {
  storeId: string;
  importDraftId: string;
  kyrubCategory: unknown;
  kyrubStock: unknown;
  kyrubPrice?: unknown;
  finalizedByUserId: string;
}): Promise<{
  importDraftId: string;
  bindingId: string;
  canonicalProductId: string;
  publicationStatus: 'draft';
  alreadyBound: boolean;
}> => {
  const storeId = input.storeId.trim();
  const importDraftId = input.importDraftId.trim();
  const finalizedByUserId = input.finalizedByUserId.trim();
  const category = clean(input.kyrubCategory, 120);
  const stock = integerNonNegative(input.kyrubStock);
  if (!storeId || !importDraftId || !finalizedByUserId || !category || stock === null) {
    throw new Error('MERCADO_LIVRE_CANONICAL_PRODUCT_INPUT_INVALID');
  }
  if (finalizedByUserId !== storeId) throw new Error('STORE_CONNECTION_FORBIDDEN');

  const importReference = adminDb.doc(`stores/${storeId}/catalogImportDrafts/${importDraftId}`);
  const privateStoreReference = adminDb.doc(`users/${storeId}/stores/${storeId}`);
  let result: {
    importDraftId: string;
    bindingId: string;
    canonicalProductId: string;
    publicationStatus: 'draft';
    alreadyBound: boolean;
  } | null = null;

  await adminDb.runTransaction(async transaction => {
    const [importDocument, privateStoreDocument] = await Promise.all([
      transaction.get(importReference),
      transaction.get(privateStoreReference),
    ]);
    if (!importDocument.exists) throw new Error('MERCADO_LIVRE_IMPORT_DRAFT_NOT_FOUND');
    if (!privateStoreDocument.exists) throw new Error('STORE_REQUIRED');

    const draft = assertImportDraft(storeId, importDocument.data());
    if (draft.id !== importDraftId) throw new Error('MERCADO_LIVRE_IMPORT_DRAFT_INVALID');
    const privateStore = privateStoreDocument.data() as Record<string, unknown>;
    const canonicalStoreId = clean(privateStore.canonicalStoreId, 160);
    if (!canonicalStoreId) throw new Error('CANONICAL_STORE_REQUIRED');

    const preparation = preparationStatus(draft);
    const bindingId = deterministicBindingId(draft);
    const canonicalProductId = deterministicCanonicalProductId(draft);
    const bindingReference = adminDb.doc(`stores/${storeId}/externalCatalogBindings/${bindingId}`);
    const canonicalReference = adminDb.doc(`stores/${canonicalStoreId}/products/${canonicalProductId}`);
    const [bindingDocument, canonicalDocument] = await Promise.all([
      transaction.get(bindingReference),
      transaction.get(canonicalReference),
    ]);

    if (preparation.status === 'bound') {
      if (
        preparation.canonicalProductId !== canonicalProductId ||
        !bindingDocument.exists ||
        !canonicalDocument.exists
      ) {
        throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_CONFLICT');
      }
      result = {
        importDraftId,
        bindingId,
        canonicalProductId,
        publicationStatus: 'draft',
        alreadyBound: true,
      };
      return;
    }
    if (preparation.status !== 'prepared' || !preparation.kyrubDraftId) {
      throw new Error('MERCADO_LIVRE_IMPORT_PREPARATION_REQUIRED');
    }

    const preparationReference = adminDb.doc(
      `kyrub_catalog_drafts/${storeId}/drafts/${preparation.kyrubDraftId}`
    );
    const preparationDocument = await transaction.get(preparationReference);
    if (!preparationDocument.exists) throw new Error('MERCADO_LIVRE_IMPORT_PREPARATION_NOT_FOUND');
    const prepared = assertPreparationDraft(storeId, draft, preparationDocument.data());

    const preparedPrice = finiteNonNegative(prepared.product.price);
    const requestedPrice = input.kyrubPrice === undefined
      ? null
      : finiteNonNegative(input.kyrubPrice);
    if (input.kyrubPrice !== undefined && requestedPrice === null) {
      throw new Error('MERCADO_LIVRE_CANONICAL_PRODUCT_INPUT_INVALID');
    }
    const price = requestedPrice ?? preparedPrice;
    if (price === null) throw new Error('MERCADO_LIVRE_CANONICAL_PRODUCT_PRICE_REQUIRED');

    if (bindingDocument.exists) {
      const existing = bindingDocument.data() as Record<string, unknown>;
      if (
        clean(existing.storeId, 160) !== storeId ||
        existing.provider !== 'mercado_livre' ||
        clean(existing.connectionId, 200) !== draft.provenance.connectionId ||
        clean(existing.externalItemId, 160) !== draft.provenance.externalId ||
        clean(existing.canonicalStoreId, 160) !== canonicalStoreId ||
        clean(existing.canonicalProductId, 160) !== canonicalProductId
      ) {
        throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_CONFLICT');
      }
      if (!canonicalDocument.exists) throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_CONFLICT');
      result = {
        importDraftId,
        bindingId,
        canonicalProductId,
        publicationStatus: 'draft',
        alreadyBound: true,
      };
      return;
    }

    if (canonicalDocument.exists) {
      const existing = canonicalDocument.data() as Record<string, unknown>;
      const externalSource = existing.externalSource && typeof existing.externalSource === 'object'
        ? existing.externalSource as Record<string, unknown>
        : null;
      if (
        clean(existing.storeId, 160) !== canonicalStoreId ||
        clean(existing.legacyStoreId, 160) !== storeId ||
        clean(externalSource?.provider, 40) !== 'mercado_livre' ||
        clean(externalSource?.connectionId, 200) !== draft.provenance.connectionId ||
        clean(externalSource?.externalItemId, 160) !== draft.provenance.externalId
      ) {
        throw new Error('MERCADO_LIVRE_CANONICAL_PRODUCT_ID_CONFLICT');
      }
      throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_CONFLICT');
    }

    const name = clean(prepared.product.name, 120);
    const image = clean(prepared.product.image, 2_000);
    const baselineHash = canonicalBaselineHash({ name, price, stock, category, image });
    const now = new Date().toISOString();

    transaction.set(canonicalReference, {
      id: canonicalProductId,
      storeId: canonicalStoreId,
      supplierId: canonicalStoreId,
      name,
      description: '',
      price,
      image,
      stock,
      category,
      isService: false,
      publicationStatus: 'draft',
      createdByUserId: finalizedByUserId,
      createdByRole: 'owner',
      updatedByUserId: finalizedByUserId,
      updatedByRole: 'owner',
      legacyStoreId: storeId,
      legacyProductId: canonicalProductId,
      legacySupplierId: storeId,
      legacyUpdatedAt: '',
      migratedFromPath: `tenants/${storeId}#publicProducts/${canonicalProductId}`,
      archivedAt: '',
      migration: {
        mode: 'dual_write',
        migratedByUserId: finalizedByUserId,
        migratedByRole: 'owner',
      },
      catalogAuthority: 'store_owner_import_confirmation',
      externalSource: {
        provider: 'mercado_livre',
        connectionId: draft.provenance.connectionId,
        externalItemId: draft.provenance.externalId,
        bindingId,
        importDraftId,
        preparationDraftId: prepared.id,
        sourceLastSyncedAt: draft.provenance.lastSyncedAt,
      },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    transaction.set(bindingReference, {
      schemaVersion: 1,
      id: bindingId,
      storeId,
      provider: 'mercado_livre',
      connectionId: draft.provenance.connectionId,
      externalItemId: draft.provenance.externalId,
      canonicalStoreId,
      canonicalProductId,
      status: 'active',
      authority: 'store_owner_import_confirmation',
      boundByUserId: finalizedByUserId,
      sourceImportDraftId: importDraftId,
      sourcePreparationDraftId: prepared.id,
      sourceLastSyncedAt: draft.provenance.lastSyncedAt,
      sourceImportDraftUpdatedAt: draft.updatedAt,
      canonicalBaselineHash: baselineHash,
      createdAt: now,
      updatedAt: now,
      serverCreatedAt: FieldValue.serverTimestamp(),
      serverUpdatedAt: FieldValue.serverTimestamp(),
    });

    transaction.update(preparationReference, {
      promotionStatus: 'promoted',
      promotionAuthority: 'store_owner_import_confirmation',
      promotedByUserId: finalizedByUserId,
      canonicalProductId,
      externalCatalogBindingId: bindingId,
      promotedAt: now,
      serverUpdatedAt: FieldValue.serverTimestamp(),
    });

    transaction.update(importReference, {
      promotionStatus: 'promoted',
      promotionAuthority: 'store_owner_import_confirmation',
      promotedByUserId: finalizedByUserId,
      canonicalProductId,
      externalCatalogBindingId: bindingId,
      promotedAt: now,
      serverPromotedAt: FieldValue.serverTimestamp(),
    });

    result = {
      importDraftId,
      bindingId,
      canonicalProductId,
      publicationStatus: 'draft',
      alreadyBound: false,
    };
  });

  if (!result) throw new Error('MERCADO_LIVRE_CANONICAL_PRODUCT_CREATION_FAILED');
  return result;
};
