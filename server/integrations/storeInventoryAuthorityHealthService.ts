import { adminDb } from '../firebaseAdmin.js';
import {
  diagnoseCanonicalInventoryAuthority,
  type CanonicalInventoryAuthorityDiagnosticState,
} from '../inventory/canonicalInventoryAuthorityDiagnosticService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export type StoreInventoryAuthorityHealthState =
  | 'canonical_store_unresolved'
  | CanonicalInventoryAuthorityDiagnosticState;

export interface StoreInventoryAuthorityHealth {
  state: StoreInventoryAuthorityHealthState;
  activeOwnerCount: number;
  inventoryDocumentExists: boolean;
  checkedAt: string;
}

export const loadStoreInventoryAuthorityHealth = async (input: {
  tenantId: string;
  requestedByUserId: string;
}): Promise<StoreInventoryAuthorityHealth> => {
  const tenantId = clean(input.tenantId);
  const requestedByUserId = clean(input.requestedByUserId);
  if (!tenantId || requestedByUserId !== tenantId) {
    throw new Error('STORE_INVENTORY_AUTHORITY_FORBIDDEN');
  }

  const tenant = await adminDb.doc(`tenants/${tenantId}`).get();
  const canonicalStoreId = clean(tenant.data()?.canonicalStoreId);
  if (!canonicalStoreId) {
    return {
      state: 'canonical_store_unresolved',
      activeOwnerCount: 0,
      inventoryDocumentExists: false,
      checkedAt: new Date().toISOString(),
    };
  }

  const diagnostic = await diagnoseCanonicalInventoryAuthority(canonicalStoreId);
  return {
    state: diagnostic.state,
    activeOwnerCount: diagnostic.activeOwnerCount,
    inventoryDocumentExists: diagnostic.inventoryDocumentExists,
    checkedAt: diagnostic.checkedAt,
  };
};
