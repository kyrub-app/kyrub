import { adminDb } from '../firebaseAdmin.js';
import {
  diagnoseCanonicalInventoryAuthority,
  type CanonicalInventoryAuthorityDiagnosticState,
} from '../inventory/canonicalInventoryAuthorityDiagnosticService.js';

const clean = (value: unknown, maximum = 500): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const canonicalStoreIdForTenant = async (tenantId: string): Promise<string> => {
  const tenant = await adminDb.doc(`tenants/${tenantId}`).get();
  const canonicalStoreId = clean(tenant.data()?.canonicalStoreId, 160);
  if (!canonicalStoreId) throw new Error('NINETY_NINE_FOOD_BLOCK_CANONICAL_STORE_REQUIRED');
  return canonicalStoreId;
};

const inventoryReservationState = (order: Record<string, unknown>): string => {
  const value = order.inventoryReservation;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return clean((value as Record<string, unknown>).state, 120);
};

const integrationProvider = (order: Record<string, unknown>): string => {
  const integration = order.integration;
  if (!integration || typeof integration !== 'object' || Array.isArray(integration)) return '';
  return clean((integration as Record<string, unknown>).provider, 120);
};

export interface NinetyNineFoodInventoryAuthorityDiagnostic {
  orderId: string;
  state: CanonicalInventoryAuthorityDiagnosticState;
  activeOwnerCount: number;
  inventoryDocumentExists: boolean;
  checkedAt: string;
}

export const diagnoseNinetyNineFoodBlockedOrderInventoryAuthority = async (input: {
  tenantId: string;
  orderId: string;
  requestedByUserId: string;
}): Promise<NinetyNineFoodInventoryAuthorityDiagnostic> => {
  const tenantId = clean(input.tenantId, 160);
  const orderId = clean(input.orderId, 240);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  if (!tenantId || !orderId || requestedByUserId !== tenantId) {
    throw new Error('NINETY_NINE_FOOD_BLOCK_INPUT_INVALID');
  }

  const canonicalStoreId = await canonicalStoreIdForTenant(tenantId);
  const orderSnapshot = await adminDb
    .doc(`stores/${canonicalStoreId}/orders/${orderId}`)
    .get();
  if (!orderSnapshot.exists) throw new Error('NINETY_NINE_FOOD_BLOCK_ORDER_NOT_FOUND');

  const order = orderSnapshot.data() as Record<string, unknown>;
  if (integrationProvider(order) !== '99food') {
    throw new Error('NINETY_NINE_FOOD_BLOCK_SOURCE_MISMATCH');
  }
  if (inventoryReservationState(order) !== 'blocked_authority_unresolved') {
    throw new Error('NINETY_NINE_FOOD_BLOCK_AUTHORITY_DIAGNOSTIC_NOT_APPLICABLE');
  }

  const diagnostic = await diagnoseCanonicalInventoryAuthority(canonicalStoreId);
  return {
    orderId,
    state: diagnostic.state,
    activeOwnerCount: diagnostic.activeOwnerCount,
    inventoryDocumentExists: diagnostic.inventoryDocumentExists,
    checkedAt: diagnostic.checkedAt,
  };
};
