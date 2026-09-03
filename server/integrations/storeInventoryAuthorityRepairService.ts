import { createHash } from 'node:crypto';
import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { inventoryDocumentPathForOwner } from '../inventory/canonicalInventoryAuthorityService.js';
import { getPrimaryUserStoreDocumentPath } from '../../src/utils/storePaths.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export type StoreInventoryAuthorityRepairAction =
  | 'link_existing_canonical_store'
  | 'activate_canonical_owner'
  | 'initialize_empty_inventory';

export type StoreInventoryAuthorityRepairReason =
  | 'canonical_link_missing'
  | 'authority_scope_mismatch'
  | 'multiple_active_owners'
  | 'canonical_owner_mismatch'
  | 'already_resolved';

export type StoreInventoryAuthorityRepairState =
  | 'canonical_store_unresolved'
  | 'no_active_owner'
  | 'multiple_active_owners'
  | 'inventory_document_missing'
  | 'resolved';

export interface StoreInventoryAuthorityRepairPreview {
  state: StoreInventoryAuthorityRepairState;
  actionable: boolean;
  action: StoreInventoryAuthorityRepairAction | null;
  reason: StoreInventoryAuthorityRepairReason | null;
  repairId: string;
  activeOwnerCount: number;
  requiresConfirmation: boolean;
  checkedAt: string;
}

type RepairContext = {
  preview: StoreInventoryAuthorityRepairPreview;
  tenantId: string;
  canonicalStoreId: string;
  canonicalOwnerId: string;
  inventoryDocumentPath: string;
};

const repairIdFor = (input: {
  tenantId: string;
  canonicalStoreId: string;
  canonicalOwnerId: string;
  state: StoreInventoryAuthorityRepairState;
  action: StoreInventoryAuthorityRepairAction;
  activeOwnerIds: string[];
  inventoryDocumentExists: boolean;
}): string => `inventory-authority-repair-${createHash('sha256')
  .update(JSON.stringify({
    tenantId: input.tenantId,
    canonicalStoreId: input.canonicalStoreId,
    canonicalOwnerId: input.canonicalOwnerId,
    state: input.state,
    action: input.action,
    activeOwnerIds: [...input.activeOwnerIds].sort(),
    inventoryDocumentExists: input.inventoryDocumentExists,
  }))
  .digest('hex')
  .slice(0, 40)}`;

const blockedPreview = (input: {
  state: StoreInventoryAuthorityRepairState;
  reason: StoreInventoryAuthorityRepairReason;
  activeOwnerCount?: number;
}): StoreInventoryAuthorityRepairPreview => ({
  state: input.state,
  actionable: false,
  action: null,
  reason: input.reason,
  repairId: '',
  activeOwnerCount: input.activeOwnerCount ?? 0,
  requiresConfirmation: false,
  checkedAt: new Date().toISOString(),
});

const actionablePreview = (input: {
  tenantId: string;
  canonicalStoreId: string;
  canonicalOwnerId: string;
  state: StoreInventoryAuthorityRepairState;
  action: StoreInventoryAuthorityRepairAction;
  activeOwnerIds: string[];
  inventoryDocumentExists: boolean;
}): StoreInventoryAuthorityRepairPreview => ({
  state: input.state,
  actionable: true,
  action: input.action,
  reason: null,
  repairId: repairIdFor(input),
  activeOwnerCount: input.activeOwnerIds.length,
  requiresConfirmation: true,
  checkedAt: new Date().toISOString(),
});

type Reader = {
  get: Transaction['get'];
};

const inspectRepairContext = async (
  reader: Reader,
  tenantIdInput: string
): Promise<RepairContext> => {
  const tenantId = clean(tenantIdInput);
  if (!tenantId) throw new Error('STORE_INVENTORY_AUTHORITY_REPAIR_FORBIDDEN');

  const privateStoreRef = adminDb.doc(getPrimaryUserStoreDocumentPath(tenantId));
  const tenantRef = adminDb.doc(`tenants/${tenantId}`);
  const [privateStoreSnapshot, tenantSnapshot] = await Promise.all([
    reader.get(privateStoreRef),
    reader.get(tenantRef),
  ]);

  const privateStore = privateStoreSnapshot.data() as Record<string, unknown> | undefined;
  const tenant = tenantSnapshot.data() as Record<string, unknown> | undefined;
  if (
    !privateStoreSnapshot.exists ||
    clean(privateStore?.id) !== tenantId ||
    clean(privateStore?.ownerId) !== tenantId ||
    !tenantSnapshot.exists ||
    clean(tenant?.ownerId) !== tenantId
  ) {
    return {
      preview: blockedPreview({
        state: clean(tenant?.canonicalStoreId) ? 'no_active_owner' : 'canonical_store_unresolved',
        reason: 'authority_scope_mismatch',
      }),
      tenantId,
      canonicalStoreId: '',
      canonicalOwnerId: '',
      inventoryDocumentPath: '',
    };
  }

  const tenantCanonicalStoreId = clean(tenant?.canonicalStoreId);
  const privateCanonicalStoreId = clean(privateStore?.canonicalStoreId);
  const canonicalStoreId = tenantCanonicalStoreId || privateCanonicalStoreId;
  if (!canonicalStoreId || canonicalStoreId === tenantId) {
    return {
      preview: blockedPreview({
        state: 'canonical_store_unresolved',
        reason: 'canonical_link_missing',
      }),
      tenantId,
      canonicalStoreId: '',
      canonicalOwnerId: '',
      inventoryDocumentPath: '',
    };
  }

  const canonicalStoreRef = adminDb.doc(`stores/${canonicalStoreId}`);
  const canonicalStoreSnapshot = await reader.get(canonicalStoreRef);
  const canonicalStore = canonicalStoreSnapshot.data() as Record<string, unknown> | undefined;
  const canonicalOwnerId = clean(canonicalStore?.ownerId);
  const legacyTenantId = clean(canonicalStore?.legacyTenantId);
  if (
    !canonicalStoreSnapshot.exists ||
    canonicalOwnerId !== tenantId ||
    (legacyTenantId && legacyTenantId !== tenantId) ||
    (tenantCanonicalStoreId && privateCanonicalStoreId && tenantCanonicalStoreId !== privateCanonicalStoreId)
  ) {
    return {
      preview: blockedPreview({
        state: tenantCanonicalStoreId ? 'no_active_owner' : 'canonical_store_unresolved',
        reason: 'authority_scope_mismatch',
      }),
      tenantId,
      canonicalStoreId,
      canonicalOwnerId,
      inventoryDocumentPath: '',
    };
  }

  if (!tenantCanonicalStoreId) {
    const preview = actionablePreview({
      tenantId,
      canonicalStoreId,
      canonicalOwnerId,
      state: 'canonical_store_unresolved',
      action: 'link_existing_canonical_store',
      activeOwnerIds: [],
      inventoryDocumentExists: false,
    });
    return {
      preview,
      tenantId,
      canonicalStoreId,
      canonicalOwnerId,
      inventoryDocumentPath: inventoryDocumentPathForOwner(canonicalOwnerId),
    };
  }

  const ownerQuery = adminDb
    .collection(`stores/${canonicalStoreId}/members`)
    .where('role', '==', 'owner');
  const ownerMembers = await reader.get(ownerQuery);
  const activeOwnerIds = ownerMembers.docs.flatMap(document => {
    const data = document.data();
    return data.status === 'active' && clean(data.userId) === document.id
      ? [document.id]
      : [];
  }).sort();

  if (activeOwnerIds.length === 0) {
    const preview = actionablePreview({
      tenantId,
      canonicalStoreId,
      canonicalOwnerId,
      state: 'no_active_owner',
      action: 'activate_canonical_owner',
      activeOwnerIds,
      inventoryDocumentExists: false,
    });
    return {
      preview,
      tenantId,
      canonicalStoreId,
      canonicalOwnerId,
      inventoryDocumentPath: inventoryDocumentPathForOwner(canonicalOwnerId),
    };
  }

  if (activeOwnerIds.length > 1) {
    return {
      preview: blockedPreview({
        state: 'multiple_active_owners',
        reason: 'multiple_active_owners',
        activeOwnerCount: activeOwnerIds.length,
      }),
      tenantId,
      canonicalStoreId,
      canonicalOwnerId,
      inventoryDocumentPath: '',
    };
  }

  if (activeOwnerIds[0] !== canonicalOwnerId) {
    return {
      preview: blockedPreview({
        state: 'inventory_document_missing',
        reason: 'canonical_owner_mismatch',
        activeOwnerCount: 1,
      }),
      tenantId,
      canonicalStoreId,
      canonicalOwnerId,
      inventoryDocumentPath: '',
    };
  }

  const inventoryDocumentPath = inventoryDocumentPathForOwner(canonicalOwnerId);
  const inventorySnapshot = await reader.get(adminDb.doc(inventoryDocumentPath));
  if (!inventorySnapshot.exists) {
    const preview = actionablePreview({
      tenantId,
      canonicalStoreId,
      canonicalOwnerId,
      state: 'inventory_document_missing',
      action: 'initialize_empty_inventory',
      activeOwnerIds,
      inventoryDocumentExists: false,
    });
    return {
      preview,
      tenantId,
      canonicalStoreId,
      canonicalOwnerId,
      inventoryDocumentPath,
    };
  }

  return {
    preview: blockedPreview({
      state: 'resolved',
      reason: 'already_resolved',
      activeOwnerCount: 1,
    }),
    tenantId,
    canonicalStoreId,
    canonicalOwnerId,
    inventoryDocumentPath,
  };
};

const databaseReader: Reader = {
  get: adminDb.getAll
    ? (referenceOrQuery: Parameters<Transaction['get']>[0]) => {
        if ('path' in referenceOrQuery) return referenceOrQuery.get();
        return referenceOrQuery.get();
      }
    : (() => { throw new Error('STORE_INVENTORY_AUTHORITY_REPAIR_READ_UNAVAILABLE'); }) as Transaction['get'],
};

export const loadStoreInventoryAuthorityRepairPreview = async (input: {
  tenantId: string;
  requestedByUserId: string;
}): Promise<StoreInventoryAuthorityRepairPreview> => {
  const tenantId = clean(input.tenantId);
  const requestedByUserId = clean(input.requestedByUserId);
  if (!tenantId || requestedByUserId !== tenantId) {
    throw new Error('STORE_INVENTORY_AUTHORITY_REPAIR_FORBIDDEN');
  }
  const context = await inspectRepairContext(databaseReader, tenantId);
  return context.preview;
};

export const applyStoreInventoryAuthorityRepair = async (input: {
  tenantId: string;
  requestedByUserId: string;
  repairId: string;
  confirmed: boolean;
}): Promise<{ action: StoreInventoryAuthorityRepairAction; repairId: string; applied: true }> => {
  const tenantId = clean(input.tenantId);
  const requestedByUserId = clean(input.requestedByUserId);
  const expectedRepairId = clean(input.repairId);
  if (!tenantId || requestedByUserId !== tenantId) {
    throw new Error('STORE_INVENTORY_AUTHORITY_REPAIR_FORBIDDEN');
  }
  if (!input.confirmed) throw new Error('STORE_INVENTORY_AUTHORITY_REPAIR_CONFIRMATION_REQUIRED');
  if (!expectedRepairId) throw new Error('STORE_INVENTORY_AUTHORITY_REPAIR_ID_REQUIRED');

  return adminDb.runTransaction(async transaction => {
    const context = await inspectRepairContext(transaction, tenantId);
    const { preview } = context;
    if (!preview.actionable || !preview.action || !preview.repairId) {
      throw new Error('STORE_INVENTORY_AUTHORITY_REPAIR_NOT_ACTIONABLE');
    }
    if (preview.repairId !== expectedRepairId) {
      throw new Error('STORE_INVENTORY_AUTHORITY_REPAIR_STALE');
    }

    const repairRef = adminDb.doc(
      `stores/${context.canonicalStoreId}/inventoryAuthorityRepairs/${preview.repairId}`
    );
    const repairSnapshot = await transaction.get(repairRef);
    if (repairSnapshot.exists) {
      throw new Error('STORE_INVENTORY_AUTHORITY_REPAIR_STALE');
    }

    if (preview.action === 'link_existing_canonical_store') {
      transaction.set(
        adminDb.doc(`tenants/${tenantId}`),
        {
          canonicalStoreId: context.canonicalStoreId,
          canonicalStoreLinkedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } else if (preview.action === 'activate_canonical_owner') {
      const ownerMemberRef = adminDb.doc(
        `stores/${context.canonicalStoreId}/members/${context.canonicalOwnerId}`
      );
      const ownerMemberSnapshot = await transaction.get(ownerMemberRef);
      transaction.set(
        ownerMemberRef,
        {
          userId: context.canonicalOwnerId,
          role: 'owner',
          status: 'active',
          ...(ownerMemberSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
          inventoryAuthorityRepairedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } else {
      const inventoryRef = adminDb.doc(context.inventoryDocumentPath);
      const inventorySnapshot = await transaction.get(inventoryRef);
      if (inventorySnapshot.exists) {
        throw new Error('STORE_INVENTORY_AUTHORITY_REPAIR_STALE');
      }
      transaction.set(inventoryRef, {
        ownerId: context.canonicalOwnerId,
        inventoryCatalog: [],
        catalog: [],
        recentInventoryMovements: [],
        recentInventoryMovementCount: 0,
        authorityInitializedBy: 'store_owner_inventory_authority_repair',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    transaction.set(repairRef, {
      schemaVersion: 1,
      id: preview.repairId,
      action: preview.action,
      stateBefore: preview.state,
      requestedByUserId,
      authority: 'explicit_store_owner_confirmation',
      confirmed: true,
      appliedAt: FieldValue.serverTimestamp(),
    });

    return {
      action: preview.action,
      repairId: preview.repairId,
      applied: true as const,
    };
  });
};
