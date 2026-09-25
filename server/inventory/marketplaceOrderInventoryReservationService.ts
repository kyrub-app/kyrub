import { createHash } from 'node:crypto';
import { FieldValue, type DocumentData, type Transaction } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  parseInventoryCatalogRecords,
  parseInventoryCompositionRecords,
  type InventoryCatalogRecord,
  type InventoryConsumptionLine,
} from '../../shared/inventoryConsumption.js';
import {
  buildOrderInventoryConsumptionWithOptions,
  parseConfiguredLineSelectedOptions,
  parseInventorySelectedOptions,
  parseOptionInventoryImpacts,
  type OptionAwareInventoryOrderItem,
} from '../../shared/optionInventoryImpact.js';
import {
  legacyTenantInventoryAuthority,
  resolveCanonicalInventoryAuthorityInTransaction,
  type CanonicalInventoryAuthority,
} from './canonicalInventoryAuthorityService.js';
import { transitionOrderStatusWithInventory } from './orderInventoryService.js';
import {
  normalizeCanonicalPaymentIntent,
  type CanonicalPaymentIntent,
} from '../../src/utils/canonicalPaymentIntent.js';

const RESERVATION_COLLECTION = 'inventoryOrderReservations';
const RESERVATION_STATE_COLLECTION = 'inventoryReservationStates';

type ReservationStatus =
  | 'reserved'
  | 'committed'
  | 'released'
  | 'released_retryable'
  | 'skipped';

export type MarketplaceInventoryReservationAction =
  | 'not_applicable'
  | 'reserved'
  | 'duplicate'
  | 'skipped';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const roundQuantity = (value: number): number =>
  Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;

const reservationId = (tenantId: string, orderId: string): string =>
  createHash('sha256').update(`${tenantId}:${orderId}`).digest('hex');

const reservationStateId = (inventoryDocumentPath: string): string =>
  createHash('sha256').update(inventoryDocumentPath).digest('hex');

const reservationReference = (tenantId: string, orderId: string) =>
  adminDb.doc(`${RESERVATION_COLLECTION}/${reservationId(tenantId, orderId)}`);

const reservationStateReference = (inventoryDocumentPath: string) =>
  adminDb.doc(`${RESERVATION_STATE_COLLECTION}/${reservationStateId(inventoryDocumentPath)}`);

const orderReference = (tenantId: string, orderId: string) =>
  adminDb.doc(`artifacts/${tenantId}/public/data/customerOrders/${orderId}`);

const finitePositiveInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null;

const sourceProductId = (configuredProductId: string, explicitSource: unknown): string =>
  clean(explicitSource) || configuredProductId.split('::', 1)[0]?.trim() || configuredProductId;

const parseOrderItems = (value: unknown): OptionAwareInventoryOrderItem[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const item = candidate as Record<string, unknown>;
    const configuredProductId = clean(item.productId);
    const productId = sourceProductId(configuredProductId, item.sourceProductId);
    const name = clean(item.name);
    const quantity = finitePositiveInteger(item.quantity);
    const transferredQuantity =
      typeof item.transferredQuantity === 'number' &&
      Number.isInteger(item.transferredQuantity) &&
      item.transferredQuantity >= 0
        ? item.transferredQuantity
        : 0;
    if (!configuredProductId || !productId || !name || quantity === null) return [];
    const explicitSelectedOptions = parseInventorySelectedOptions(item.selectedOptions);
    const selectedOptions = explicitSelectedOptions.length > 0
      ? explicitSelectedOptions
      : parseConfiguredLineSelectedOptions(configuredProductId);
    return [{
      productId,
      name,
      quantity,
      transferredQuantity,
      ...(selectedOptions.length > 0 ? { selectedOptions } : {}),
    } satisfies OptionAwareInventoryOrderItem];
  });
};

const productCategoriesFromTenant = (
  tenantData: DocumentData | undefined
): Record<string, string> => {
  if (!Array.isArray(tenantData?.publicProducts)) return {};
  const categories: Record<string, string> = {};
  for (const candidate of tenantData.publicProducts) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const product = candidate as Record<string, unknown>;
    const id = clean(product.id);
    const category = clean(product.category);
    if (id && category) categories[id] = category;
  }
  return categories;
};

const reservedQuantities = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [inventoryItemId, rawQuantity] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(inventoryItemId)) continue;
    if (typeof rawQuantity !== 'number' || !Number.isFinite(rawQuantity) || rawQuantity <= 0) {
      continue;
    }
    result[inventoryItemId] = roundQuantity(rawQuantity);
  }
  return result;
};

const availableCatalogAfterReservations = (
  catalog: InventoryCatalogRecord[],
  reserved: Record<string, number>
): InventoryCatalogRecord[] =>
  catalog.map(item => ({
    ...item,
    currentQuantity: roundQuantity(
      Math.max(0, item.currentQuantity - (reserved[item.id] ?? 0))
    ),
  }));

const addReservationLines = (
  current: Record<string, number>,
  lines: InventoryConsumptionLine[]
): Record<string, number> => {
  const next = { ...current };
  for (const line of lines) {
    next[line.inventoryItemId] = roundQuantity(
      (next[line.inventoryItemId] ?? 0) + line.quantity
    );
  }
  return next;
};

const subtractReservationLines = (
  current: Record<string, number>,
  lines: InventoryConsumptionLine[]
): Record<string, number> => {
  const next = { ...current };
  for (const line of lines) {
    const remaining = roundQuantity(
      Math.max(0, (next[line.inventoryItemId] ?? 0) - line.quantity)
    );
    if (remaining > 0) next[line.inventoryItemId] = remaining;
    else delete next[line.inventoryItemId];
  }
  return next;
};

const parseReservationLines = (value: unknown): InventoryConsumptionLine[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const line = candidate as Record<string, unknown>;
    const inventoryItemId = clean(line.inventoryItemId);
    const quantity = typeof line.quantity === 'number' && Number.isFinite(line.quantity)
      ? line.quantity
      : 0;
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(inventoryItemId) || quantity <= 0) return [];
    return [{
      inventoryItemId,
      inventoryItemName: clean(line.inventoryItemName),
      unit: clean(line.unit),
      quantity: roundQuantity(quantity),
      beforeQuantity: typeof line.beforeQuantity === 'number' ? line.beforeQuantity : 0,
      afterQuantity: typeof line.afterQuantity === 'number' ? line.afterQuantity : 0,
      productIds: Array.isArray(line.productIds)
        ? line.productIds.map(clean).filter(Boolean)
        : [],
    } satisfies InventoryConsumptionLine];
  });
};

const resolveInventoryAuthority = async (input: {
  transaction: Transaction;
  tenantId: string;
  canonicalStoreId: string;
}): Promise<CanonicalInventoryAuthority> => {
  if (!input.canonicalStoreId) {
    return legacyTenantInventoryAuthority(input.tenantId);
  }
  return resolveCanonicalInventoryAuthorityInTransaction(
    input.transaction,
    input.canonicalStoreId
  );
};

const reservationStatus = (value: unknown): ReservationStatus | '' => {
  const status = clean(value);
  return status === 'reserved' ||
    status === 'committed' ||
    status === 'released' ||
    status === 'released_retryable' ||
    status === 'skipped'
    ? status
    : '';
};

const validExpiry = (value: unknown): string => {
  const expiry = clean(value);
  if (!expiry || Number.isNaN(Date.parse(expiry))) {
    throw new Error('Prazo de pagamento inválido para reserva de estoque.');
  }
  return expiry;
};

export const reserveMarketplaceOrderInventoryOnAcceptance = async (
  tenantId: string,
  orderId: string
): Promise<MarketplaceInventoryReservationAction> => {
  const normalizedTenantId = tenantId.trim();
  const normalizedOrderId = orderId.trim();
  if (!normalizedTenantId || !normalizedOrderId) {
    throw new Error('Pedido não identificado para reserva de estoque.');
  }

  return adminDb.runTransaction(async transaction => {
    const orderRef = orderReference(normalizedTenantId, normalizedOrderId);
    const tenantRef = adminDb.doc(`tenants/${normalizedTenantId}`);
    const reservationRef = reservationReference(normalizedTenantId, normalizedOrderId);
    const [orderSnapshot, tenantSnapshot, reservationSnapshot] = await Promise.all([
      transaction.get(orderRef),
      transaction.get(tenantRef),
      transaction.get(reservationRef),
    ]);
    if (!orderSnapshot.exists) throw new Error('Pedido não encontrado.');
    const order = orderSnapshot.data() as Record<string, unknown>;
    if (clean(order.checkoutAuthority) !== 'merchant_approval_required') {
      return 'not_applicable';
    }
    if (clean(order.paymentStatus) === 'paid') return 'not_applicable';

    const currentReservation = reservationSnapshot.data() as Record<string, unknown> | undefined;
    const currentStatus = reservationStatus(currentReservation?.status);
    if (currentStatus === 'reserved' || currentStatus === 'committed') {
      return 'duplicate';
    }
    if (currentStatus === 'skipped') return 'skipped';
    if (currentStatus === 'released') {
      throw new Error('A reserva de estoque deste pedido já foi liberada. Refaça o pedido.');
    }

    const paymentIntentId = clean(order.paymentIntentId);
    if (!paymentIntentId) {
      throw new Error('Pedido sem referência de pagamento para reserva de estoque.');
    }
    const intentRef = adminDb.doc(
      `stores/${normalizedTenantId}/paymentIntents/${paymentIntentId}`
    );
    const intentSnapshot = await transaction.get(intentRef);
    if (!intentSnapshot.exists) {
      throw new Error('Pagamento do pedido não encontrado para reserva de estoque.');
    }
    const intent = normalizeCanonicalPaymentIntent(
      intentSnapshot.data() as CanonicalPaymentIntent
    );
    if (
      intent.context !== 'marketplace' ||
      intent.storeId !== normalizedTenantId ||
      intent.target.orderId !== normalizedOrderId ||
      intent.status !== 'pending'
    ) {
      throw new Error('Pagamento do pedido inconsistente para reserva de estoque.');
    }
    const activeExpiresAt = validExpiry(intent.expiresAt);

    const items = parseOrderItems(order.items);
    if (!items.length || items.length !== (Array.isArray(order.items) ? order.items.length : 0)) {
      throw new Error('Pedido inválido para reserva de estoque.');
    }

    const canonicalStoreId = clean(tenantSnapshot.data()?.canonicalStoreId);
    const authority = await resolveInventoryAuthority({
      transaction,
      tenantId: normalizedTenantId,
      canonicalStoreId,
    });
    const inventoryRef = adminDb.doc(authority.inventoryDocumentPath);
    const stateRef = reservationStateReference(authority.inventoryDocumentPath);
    const [inventorySnapshot, stateSnapshot] = await Promise.all([
      transaction.get(inventoryRef),
      transaction.get(stateRef),
    ]);
    const inventoryData = inventorySnapshot.data();
    const catalog = parseInventoryCatalogRecords(
      inventoryData?.catalog ?? inventoryData?.inventoryCatalog
    );
    const compositions = parseInventoryCompositionRecords(
      inventoryData?.compositions ?? inventoryData?.productCompositions
    );
    const reserved = reservedQuantities(stateSnapshot.data()?.reservedByItem);
    const availableCatalog = availableCatalogAfterReservations(catalog, reserved);
    const lines = buildOrderInventoryConsumptionWithOptions(
      items,
      availableCatalog,
      compositions,
      productCategoriesFromTenant(tenantSnapshot.data()),
      parseOptionInventoryImpacts(inventoryData?.optionInventoryImpacts)
    );
    const now = FieldValue.serverTimestamp();

    if (lines.length === 0) {
      transaction.set(
        reservationRef,
        {
          tenantId: normalizedTenantId,
          orderId: normalizedOrderId,
          canonicalStoreId: authority.canonicalStoreId,
          inventoryAuthorityOwnerUserId: authority.ownerUserId,
          inventoryAuthority: authority.authority,
          inventoryDocumentPath: authority.inventoryDocumentPath,
          status: 'skipped',
          skippedReason: catalog.length === 0
            ? 'inventory_not_configured'
            : 'order_without_composition',
          activeExpiresAt: FieldValue.delete(),
          createdAt: currentReservation?.createdAt ?? now,
          updatedAt: now,
        },
        { merge: true }
      );
      return 'skipped';
    }

    transaction.set(
      stateRef,
      {
        inventoryDocumentPath: authority.inventoryDocumentPath,
        ownerUserId: authority.ownerUserId,
        canonicalStoreId: authority.canonicalStoreId,
        reservedByItem: addReservationLines(reserved, lines),
        updatedAt: now,
      },
      { merge: true }
    );
    transaction.set(
      reservationRef,
      {
        tenantId: normalizedTenantId,
        orderId: normalizedOrderId,
        canonicalStoreId: authority.canonicalStoreId,
        inventoryAuthorityOwnerUserId: authority.ownerUserId,
        inventoryAuthority: authority.authority,
        inventoryDocumentPath: authority.inventoryDocumentPath,
        paymentIntentId,
        activeExpiresAt,
        status: 'reserved',
        lines,
        releaseReason: FieldValue.delete(),
        releasedAt: FieldValue.delete(),
        committedAt: FieldValue.delete(),
        paymentConfirmedAt: FieldValue.delete(),
        reservedAt: now,
        createdAt: currentReservation?.createdAt ?? now,
        updatedAt: now,
      },
      { merge: true }
    );
    return 'reserved';
  });
};

const finishReservation = async (input: {
  tenantId: string;
  orderId: string;
  status: 'committed' | 'released' | 'released_retryable';
  reason: string;
}): Promise<boolean> => {
  const tenantId = input.tenantId.trim();
  const orderId = input.orderId.trim();
  if (!tenantId || !orderId) return false;

  return adminDb.runTransaction(async transaction => {
    const reservationRef = reservationReference(tenantId, orderId);
    const reservationSnapshot = await transaction.get(reservationRef);
    if (!reservationSnapshot.exists) return false;
    const reservation = reservationSnapshot.data() as Record<string, unknown>;
    if (reservationStatus(reservation.status) !== 'reserved') return false;
    const inventoryDocumentPath = clean(reservation.inventoryDocumentPath);
    const lines = parseReservationLines(reservation.lines);
    if (!inventoryDocumentPath || !lines.length) {
      throw new Error('Reserva de estoque inconsistente.');
    }

    const stateRef = reservationStateReference(inventoryDocumentPath);
    const stateSnapshot = await transaction.get(stateRef);
    const reserved = reservedQuantities(stateSnapshot.data()?.reservedByItem);
    const now = FieldValue.serverTimestamp();
    transaction.set(
      stateRef,
      {
        reservedByItem: subtractReservationLines(reserved, lines),
        updatedAt: now,
      },
      { merge: true }
    );
    transaction.set(
      reservationRef,
      {
        status: input.status,
        activeExpiresAt: FieldValue.delete(),
        ...(input.status === 'committed'
          ? { committedAt: now }
          : { releasedAt: now, releaseReason: input.reason }),
        updatedAt: now,
      },
      { merge: true }
    );
    return true;
  });
};

export const syncMarketplaceOrderInventoryReservationExpiry = async (
  tenantId: string,
  orderId: string,
  expiresAt: string
): Promise<boolean> => {
  const normalizedTenantId = tenantId.trim();
  const normalizedOrderId = orderId.trim();
  const normalizedExpiry = validExpiry(expiresAt);
  if (!normalizedTenantId || !normalizedOrderId) return false;

  return adminDb.runTransaction(async transaction => {
    const reservationRef = reservationReference(normalizedTenantId, normalizedOrderId);
    const snapshot = await transaction.get(reservationRef);
    if (!snapshot.exists) return false;
    const reservation = snapshot.data() as Record<string, unknown>;
    if (reservationStatus(reservation.status) !== 'reserved') return false;
    transaction.update(reservationRef, {
      activeExpiresAt: normalizedExpiry,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
};

export const markMarketplaceOrderInventoryReservationPaymentConfirmed = async (
  tenantId: string,
  orderId: string
): Promise<boolean> => {
  const normalizedTenantId = tenantId.trim();
  const normalizedOrderId = orderId.trim();
  if (!normalizedTenantId || !normalizedOrderId) return false;

  return adminDb.runTransaction(async transaction => {
    const reservationRef = reservationReference(normalizedTenantId, normalizedOrderId);
    const snapshot = await transaction.get(reservationRef);
    if (!snapshot.exists) return false;
    const reservation = snapshot.data() as Record<string, unknown>;
    if (reservationStatus(reservation.status) !== 'reserved') return false;
    const now = FieldValue.serverTimestamp();
    transaction.update(reservationRef, {
      activeExpiresAt: FieldValue.delete(),
      paymentConfirmedAt: now,
      updatedAt: now,
    });
    return true;
  });
};

export const commitMarketplaceOrderInventoryReservation = async (
  tenantId: string,
  orderId: string
): Promise<boolean> =>
  finishReservation({
    tenantId,
    orderId,
    status: 'committed',
    reason: 'inventory_consumption_committed',
  });

export const releaseMarketplaceOrderInventoryReservation = async (input: {
  tenantId: string;
  orderId: string;
  reason: string;
  retryable?: boolean;
}): Promise<boolean> =>
  finishReservation({
    tenantId: input.tenantId,
    orderId: input.orderId,
    status: input.retryable ? 'released_retryable' : 'released',
    reason: input.reason,
  });

const terminalPaymentReason = (eventType: string): string => {
  if (eventType === 'payment.expired') return 'Pagamento Pix expirado antes da confirmação.';
  if (eventType === 'payment.cancelled') return 'Pagamento Pix cancelado antes da confirmação.';
  return 'Pagamento não confirmado pelo provedor.';
};

export const releaseMarketplaceReservationForTerminalPayment = async (input: {
  storeId: string;
  paymentIntentId: string;
  eventType: 'payment.failed' | 'payment.expired' | 'payment.cancelled';
}): Promise<void> => {
  const storeId = input.storeId.trim();
  const paymentIntentId = input.paymentIntentId.trim();
  if (!storeId || !paymentIntentId) return;

  const intentSnapshot = await adminDb
    .doc(`stores/${storeId}/paymentIntents/${paymentIntentId}`)
    .get();
  if (!intentSnapshot.exists) return;
  const intent = normalizeCanonicalPaymentIntent(
    intentSnapshot.data() as CanonicalPaymentIntent
  );
  if (intent.context !== 'marketplace') return;
  const orderId = intent.target.orderId;
  const orderSnapshot = await orderReference(storeId, orderId).get();
  if (!orderSnapshot.exists) return;
  const order = orderSnapshot.data() as Record<string, unknown>;
  if (
    clean(order.checkoutAuthority) !== 'merchant_approval_required' ||
    clean(order.paymentStatus) === 'paid'
  ) {
    return;
  }

  const currentStatus = clean(order.status);
  if (currentStatus === 'pending' || currentStatus === 'accepted') {
    await transitionOrderStatusWithInventory(
      storeId,
      orderId,
      'cancelled',
      { reason: terminalPaymentReason(input.eventType) }
    );
  }

  await releaseMarketplaceOrderInventoryReservation({
    tenantId: storeId,
    orderId,
    reason: input.eventType,
  });
};