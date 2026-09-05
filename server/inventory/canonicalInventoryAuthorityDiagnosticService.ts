import { adminDb } from '../firebaseAdmin.js';
import { inventoryDocumentPathForOwner } from './canonicalInventoryAuthorityService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export type CanonicalInventoryAuthorityDiagnosticState =
  | 'resolved'
  | 'no_active_owner'
  | 'canonical_owner_not_active'
  | 'multiple_active_owners'
  | 'inventory_document_missing';

export interface CanonicalInventoryAuthorityDiagnostic {
  canonicalStoreId: string;
  state: CanonicalInventoryAuthorityDiagnosticState;
  activeOwnerCount: number;
  inventoryDocumentExists: boolean;
  checkedAt: string;
}

export const diagnoseCanonicalInventoryAuthority = async (
  canonicalStoreId: string
): Promise<CanonicalInventoryAuthorityDiagnostic> => {
  const storeId = clean(canonicalStoreId);
  if (!storeId) throw new Error('INVENTORY_AUTHORITY_CANONICAL_STORE_REQUIRED');

  const canonicalStore = await adminDb.doc(`stores/${storeId}`).get();
  const canonicalOwnerId = clean(canonicalStore.data()?.ownerId);
  if (!canonicalStore.exists || !canonicalOwnerId) {
    throw new Error('INVENTORY_AUTHORITY_CANONICAL_OWNER_REQUIRED');
  }

  const ownerMembers = await adminDb
    .collection(`stores/${storeId}/members`)
    .where('role', '==', 'owner')
    .get();
  const activeOwners = ownerMembers.docs.filter(document => {
    const data = document.data();
    return data.status === 'active' && clean(data.userId) === document.id;
  });
  const checkedAt = new Date().toISOString();

  if (activeOwners.length === 0) {
    return {
      canonicalStoreId: storeId,
      state: 'no_active_owner',
      activeOwnerCount: 0,
      inventoryDocumentExists: false,
      checkedAt,
    };
  }

  if (!activeOwners.some(document => document.id === canonicalOwnerId)) {
    return {
      canonicalStoreId: storeId,
      state: 'canonical_owner_not_active',
      activeOwnerCount: activeOwners.length,
      inventoryDocumentExists: false,
      checkedAt,
    };
  }

  if (activeOwners.length > 1) {
    return {
      canonicalStoreId: storeId,
      state: 'multiple_active_owners',
      activeOwnerCount: activeOwners.length,
      inventoryDocumentExists: false,
      checkedAt,
    };
  }

  const inventoryDocumentExists = (
    await adminDb.doc(inventoryDocumentPathForOwner(canonicalOwnerId)).get()
  ).exists;

  return {
    canonicalStoreId: storeId,
    state: inventoryDocumentExists ? 'resolved' : 'inventory_document_missing',
    activeOwnerCount: 1,
    inventoryDocumentExists,
    checkedAt,
  };
};
