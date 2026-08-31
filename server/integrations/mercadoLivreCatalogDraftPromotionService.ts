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
}

export interface MercadoLivreImportDraftPreparationItem {
  draft: MercadoLivreImportDraftRecord;
  preparation: {
    status: 'not_prepared' | 'prepared' | 'stale';
    kyrubDraftId?: string;
  };
}

const clean = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const finiteNonNegative = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
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

const preparationStatus = (draft: MercadoLivreImportDraftRecord): MercadoLivreImportDraftPreparationItem['preparation'] => {
  const kyrubDraftId = clean(draft.kyrubPreparationDraftId, 160);
  const preparedFrom = clean(draft.preparedFromUpdatedAt, 80);
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
