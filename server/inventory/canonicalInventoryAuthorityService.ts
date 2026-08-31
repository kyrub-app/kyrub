import type { Transaction } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export type InventoryAuthorityKind =
  | 'active_store_owner_member'
  | 'legacy_tenant_inventory_authority';

export interface CanonicalInventoryAuthority {
  canonicalStoreId: string;
  ownerUserId: string;
  inventoryDocumentPath: string;
  authority: InventoryAuthorityKind;
}

export const inventoryDocumentPathForOwner = (ownerUserId: string): string =>
  `users/${ownerUserId.trim()}/private_store/inventory`;

export const legacyTenantInventoryAuthority = (
  tenantId: string,
  canonicalStoreId = ''
): CanonicalInventoryAuthority => ({
  canonicalStoreId: canonicalStoreId.trim(),
  ownerUserId: tenantId.trim(),
  inventoryDocumentPath: inventoryDocumentPathForOwner(tenantId),
  authority: 'legacy_tenant_inventory_authority',
});

export const resolveCanonicalInventoryAuthorityInTransaction = async (
  transaction: Transaction,
  canonicalStoreId: string
): Promise<CanonicalInventoryAuthority> => {
  const storeId = canonicalStoreId.trim();
  if (!storeId) throw new Error('INVENTORY_AUTHORITY_CANONICAL_STORE_REQUIRED');

  const ownerQuery = adminDb
    .collection(`stores/${storeId}/members`)
    .where('role', '==', 'owner');
  const ownerMembers = await transaction.get(ownerQuery);
  const activeOwners = ownerMembers.docs.filter(document => {
    const data = document.data();
    return data.status === 'active' && clean(data.userId) === document.id;
  });

  if (activeOwners.length !== 1) {
    throw new Error(
      `INVENTORY_AUTHORITY_OWNER_UNRESOLVED: expected exactly one active owner for store ${storeId}`
    );
  }

  const ownerUserId = activeOwners[0].id;
  return {
    canonicalStoreId: storeId,
    ownerUserId,
    inventoryDocumentPath: inventoryDocumentPathForOwner(ownerUserId),
    authority: 'active_store_owner_member',
  };
};

export const inventoryAuthorityFromLedger = (input: {
  tenantId: string;
  canonicalStoreId: string;
  ledgerData: Record<string, unknown> | undefined;
}): CanonicalInventoryAuthority | null => {
  const ownerUserId = clean(input.ledgerData?.inventoryAuthorityOwnerUserId);
  const inventoryDocumentPath = clean(input.ledgerData?.inventoryDocumentPath);
  const authority = clean(input.ledgerData?.inventoryAuthority);
  if (
    ownerUserId &&
    inventoryDocumentPath === inventoryDocumentPathForOwner(ownerUserId) &&
    (authority === 'active_store_owner_member' || authority === 'legacy_tenant_inventory_authority')
  ) {
    return {
      canonicalStoreId: clean(input.ledgerData?.canonicalStoreId) || input.canonicalStoreId,
      ownerUserId,
      inventoryDocumentPath,
      authority,
    } as CanonicalInventoryAuthority;
  }

  const ledgerStatus = clean(input.ledgerData?.status);
  if (ledgerStatus === 'consumed' || ledgerStatus === 'reversed' || ledgerStatus === 'skipped') {
    return legacyTenantInventoryAuthority(input.tenantId, input.canonicalStoreId);
  }
  return null;
};
