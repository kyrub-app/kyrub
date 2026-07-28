import { createHash } from 'node:crypto';
import {
  FieldValue,
  type DocumentData,
  type Transaction,
} from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin';
import {
  applyInventoryConsumptionLines,
  buildOrderInventoryConsumption,
  calculateCompositionAvailableStock,
  isInventoryTerminalCancellation,
  parseInventoryCatalogRecords,
  parseInventoryCompositionRecords,
  parseInventoryConsumptionTrigger,
  shouldConsumeInventory,
  type InventoryCatalogRecord,
  type InventoryConsumptionLine,
  type InventoryOrderItemRecord,
  type InventoryOrderStatus,
} from '../../shared/inventoryConsumption';

const INVENTORY_LEDGER_COLLECTION = 'inventoryOrderConsumptions';

const STATUS_TRANSITIONS: Record<InventoryOrderStatus, InventoryOrderStatus[]> = {
  pending: ['accepted', 'rejected', 'cancelled'],
  accepted: ['preparing', 'cancelled', 'completed'],
  preparing: ['ready', 'cancelled', 'completed'],
  ready: ['out_for_delivery', 'completed'],
  out_for_delivery: ['completed'],
  completed: [],
  rejected: [],
  cancelled: [],
};

const STATUS_RANK: Record<InventoryOrderStatus, number> = {
  pending: 0,
  accepted: 1,
  preparing: 2,
  ready: 3,
  out_for_delivery: 4,
  completed: 5,
  rejected: 6,
  cancelled: 6,
};

export interface OrderStatusDecisionInput {
  reason?: string;
  alternative?: string;
}

export interface OrderInventoryTransitionResult {
  orderId: string;
  status: InventoryOrderStatus;
  inventoryAction: 'waiting' | 'consumed' | 'restored' | 'duplicate' | 'skipped';
  provider: string;
  externalOrderId: string;
}

interface ParsedOrder {
  id: string;
  status: InventoryOrderStatus;
  customerNote: string;
  items: InventoryOrderItemRecord[];
  integration: Record<string, unknown>;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finiteInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;

const isOrderStatus = (value: unknown): value is InventoryOrderStatus =>
  typeof value === 'string' && value in STATUS_TRANSITIONS;

const privateInventoryPath = (tenantId: string): string =>
  `users/${tenantId}/private_store/inventory`;

const orderPath = (tenantId: string, orderId: string): string =>
  `artifacts/${tenantId}/public/data/customerOrders/${orderId}`;

const ledgerId = (tenantId: string, orderId: string): string =>
  createHash('sha256').update(`${tenantId}:${orderId}`).digest('hex');

const ledgerPath = (tenantId: string, orderId: string): string =>
  `${INVENTORY_LEDGER_COLLECTION}/${ledgerId(tenantId, orderId)}`;

const parseOrder = (value: unknown): ParsedOrder | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = clean(record.id);
  if (!id || !isOrderStatus(record.status) || !Array.isArray(record.items)) {
    return null;
  }

  const items = record.items.flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return [];
    }
    const item = candidate as Record<string, unknown>;
    const productId = clean(item.productId);
    const name = clean(item.name);
    const quantity = finiteInteger(item.quantity);
    const transferredQuantity = finiteInteger(item.transferredQuantity) ?? 0;
    if (!productId || !name || quantity === null || quantity <= 0) return [];
    return [{
      productId,
      name,
      quantity,
      transferredQuantity,
    } satisfies InventoryOrderItemRecord];
  });

  if (items.length !== record.items.length) return null;
  return {
    id,
    status: record.status,
    customerNote: clean(record.customerNote),
    items,
    integration:
      record.integration && typeof record.integration === 'object'
        ? record.integration as Record<string, unknown>
        : {},
  };
};

const decisionText = (decision: OrderStatusDecisionInput): string =>
  [
    clean(decision.reason) ? `Motivo da recusa: ${clean(decision.reason)}` : '',
    clean(decision.alternative)
      ? `Alternativa sugerida: ${clean(decision.alternative)}`
      : '',
  ].filter(Boolean).join(' · ');

const mergeCustomerNote = (current: string, extra: string): string =>
  [clean(current), clean(extra)].filter(Boolean).join('\n');

const publicProductsWithCalculatedStock = (
  tenantData: DocumentData | undefined,
  catalog: InventoryCatalogRecord[],
  compositions: ReturnType<typeof parseInventoryCompositionRecords>
): unknown[] | null => {
  if (!Array.isArray(tenantData?.publicProducts)) return null;
  return tenantData.publicProducts.map((candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return candidate;
    }
    const product = candidate as Record<string, unknown>;
    const productId = clean(product.id);
    if (!productId || product.isService === true) {
      return product.isService === true ? { ...product, stock: 0 } : product;
    }
    const available = calculateCompositionAvailableStock(
      catalog,
      compositions[productId]
    );
    return available === null ? product : { ...product, stock: available };
  });
};

const readLedgerLines = (value: unknown): InventoryConsumptionLine[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return [];
    }
    const line = candidate as Record<string, unknown>;
    const inventoryItemId = clean(line.inventoryItemId);
    const quantity = typeof line.quantity === 'number' && Number.isFinite(line.quantity)
      ? line.quantity
      : null;
    if (!inventoryItemId || quantity === null || quantity <= 0) return [];
    return [{
      inventoryItemId,
      inventoryItemName: clean(line.inventoryItemName),
      unit: clean(line.unit),
      quantity,
      beforeQuantity:
        typeof line.beforeQuantity === 'number' ? line.beforeQuantity : 0,
      afterQuantity:
        typeof line.afterQuantity === 'number' ? line.afterQuantity : 0,
      productIds: Array.isArray(line.productIds)
        ? line.productIds.map(clean).filter(Boolean)
        : [],
    } satisfies InventoryConsumptionLine];
  });
};

const applyInventoryForStatus = (input: {
  transaction: Transaction;
  tenantId: string;
  order: ParsedOrder;
  effectiveStatus: InventoryOrderStatus;
  tenantData: DocumentData | undefined;
  inventoryData: DocumentData | undefined;
  ledgerData: DocumentData | undefined;
}): OrderInventoryTransitionResult['inventoryAction'] => {
  const {
    transaction,
    tenantId,
    order,
    effectiveStatus,
    tenantData,
    inventoryData,
    ledgerData,
  } = input;
  const inventoryReference = adminDb.doc(privateInventoryPath(tenantId));
  const ledgerReference = adminDb.doc(ledgerPath(tenantId, order.id));
  const tenantReference = adminDb.doc(`tenants/${tenantId}`);
  const ledgerStatus = clean(ledgerData?.status);
  const trigger = parseInventoryConsumptionTrigger(inventoryData?.consumptionTrigger);
  const catalog = parseInventoryCatalogRecords(inventoryData?.catalog);
  const compositions = parseInventoryCompositionRecords(inventoryData?.compositions);

  if (isInventoryTerminalCancellation(effectiveStatus)) {
    if (ledgerStatus !== 'consumed') {
      return ledgerStatus ? 'duplicate' : 'waiting';
    }
    const lines = readLedgerLines(ledgerData?.lines);
    const restoredCatalog = applyInventoryConsumptionLines(catalog, lines, 'restore');
    const publicProducts = publicProductsWithCalculatedStock(
      tenantData,
      restoredCatalog,
      compositions
    );
    transaction.set(
      inventoryReference,
      {
        catalog: restoredCatalog,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    if (publicProducts) {
      transaction.set(
        tenantReference,
        { publicProducts, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
    }
    transaction.set(
      ledgerReference,
      {
        status: 'reversed',
        reversedForStatus: effectiveStatus,
        reversedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return 'restored';
  }

  if (!shouldConsumeInventory(trigger, effectiveStatus)) return 'waiting';
  if (ledgerStatus === 'consumed' || ledgerStatus === 'reversed' || ledgerStatus === 'skipped') {
    return 'duplicate';
  }

  const lines = buildOrderInventoryConsumption(order.items, catalog, compositions);
  if (lines.length === 0) {
    transaction.set(
      ledgerReference,
      {
        tenantId,
        orderId: order.id,
        trigger,
        status: 'skipped',
        skippedReason: catalog.length === 0
          ? 'inventory_not_configured'
          : 'order_without_composition',
        orderStatusAtDecision: effectiveStatus,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return 'skipped';
  }

  const consumedCatalog = applyInventoryConsumptionLines(catalog, lines, 'consume');
  const publicProducts = publicProductsWithCalculatedStock(
    tenantData,
    consumedCatalog,
    compositions
  );
  transaction.set(
    inventoryReference,
    {
      catalog: consumedCatalog,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  if (publicProducts) {
    transaction.set(
      tenantReference,
      { publicProducts, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  }
  transaction.create(ledgerReference, {
    tenantId,
    orderId: order.id,
    trigger,
    status: 'consumed',
    orderStatusAtConsumption: effectiveStatus,
    lines,
    createdAt: FieldValue.serverTimestamp(),
    consumedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return 'consumed';
};

const integrationIdentity = (order: ParsedOrder): {
  provider: string;
  externalOrderId: string;
} => ({
  provider: clean(order.integration.provider),
  externalOrderId: clean(order.integration.externalOrderId),
});

export const transitionOrderStatusWithInventory = async (
  tenantId: string,
  orderId: string,
  nextStatus: InventoryOrderStatus,
  decision: OrderStatusDecisionInput = {}
): Promise<OrderInventoryTransitionResult> => {
  const normalizedTenantId = clean(tenantId);
  const normalizedOrderId = clean(orderId);
  if (!normalizedTenantId || !normalizedOrderId) {
    throw new Error('Pedido não identificado.');
  }
  if (!isOrderStatus(nextStatus)) throw new Error('Status do pedido inválido.');

  return adminDb.runTransaction(async transaction => {
    const orderReference = adminDb.doc(orderPath(normalizedTenantId, normalizedOrderId));
    const tenantReference = adminDb.doc(`tenants/${normalizedTenantId}`);
    const inventoryReference = adminDb.doc(privateInventoryPath(normalizedTenantId));
    const ledgerReference = adminDb.doc(ledgerPath(normalizedTenantId, normalizedOrderId));
    const [orderSnapshot, tenantSnapshot, inventorySnapshot, ledgerSnapshot] =
      await Promise.all([
        transaction.get(orderReference),
        transaction.get(tenantReference),
        transaction.get(inventoryReference),
        transaction.get(ledgerReference),
      ]);
    const order = parseOrder(orderSnapshot.data());
    if (!order) throw new Error('Pedido não encontrado.');

    if (
      order.status !== nextStatus &&
      !STATUS_TRANSITIONS[order.status].includes(nextStatus)
    ) {
      throw new Error('Esta mudança de status não é permitida.');
    }
    if (
      (nextStatus === 'rejected' || nextStatus === 'cancelled') &&
      !clean(decision.reason)
    ) {
      throw new Error('Explique o motivo da recusa ou cancelamento.');
    }

    const extra = decisionText(decision);
    const nextNote = extra
      ? mergeCustomerNote(order.customerNote, extra)
      : order.customerNote;
    const effectiveOrder: ParsedOrder = {
      ...order,
      status: nextStatus,
      customerNote: nextNote,
    };
    const inventoryAction = applyInventoryForStatus({
      transaction,
      tenantId: normalizedTenantId,
      order: effectiveOrder,
      effectiveStatus: nextStatus,
      tenantData: tenantSnapshot.data(),
      inventoryData: inventorySnapshot.data(),
      ledgerData: ledgerSnapshot.data(),
    });
    const updatedAt = new Date().toISOString();
    transaction.set(
      orderReference,
      {
        status: nextStatus,
        customerNote: nextNote,
        updatedAt,
        inventory: {
          lastAction: inventoryAction,
          reconciledAt: updatedAt,
        },
      },
      { merge: true }
    );

    const canonicalStoreId = clean(tenantSnapshot.data()?.canonicalStoreId);
    if (canonicalStoreId) {
      transaction.set(
        adminDb.doc(`stores/${canonicalStoreId}/orders/${normalizedOrderId}`),
        {
          status: nextStatus,
          customerNote: nextNote,
          updatedAt,
          inventory: {
            lastAction: inventoryAction,
            reconciledAt: updatedAt,
          },
        },
        { merge: true }
      );
    }

    return {
      orderId: normalizedOrderId,
      status: nextStatus,
      inventoryAction,
      ...integrationIdentity(effectiveOrder),
    };
  });
};

const resolveExternalEffectiveStatus = (
  current: InventoryOrderStatus,
  requested: InventoryOrderStatus
): InventoryOrderStatus => {
  if (current === 'completed' || current === 'rejected' || current === 'cancelled') {
    return current;
  }
  if (requested === 'rejected' || requested === 'cancelled') return requested;
  return STATUS_RANK[requested] >= STATUS_RANK[current] ? requested : current;
};

export const updateIntegratedOrderStatusWithInventory = async (
  tenantId: string,
  orderId: string,
  requestedStatus: InventoryOrderStatus,
  lastEvent: string
): Promise<OrderInventoryTransitionResult> =>
  adminDb.runTransaction(async transaction => {
    const orderReference = adminDb.doc(orderPath(tenantId, orderId));
    const tenantReference = adminDb.doc(`tenants/${tenantId}`);
    const inventoryReference = adminDb.doc(privateInventoryPath(tenantId));
    const ledgerReference = adminDb.doc(ledgerPath(tenantId, orderId));
    const [orderSnapshot, tenantSnapshot, inventorySnapshot, ledgerSnapshot] =
      await Promise.all([
        transaction.get(orderReference),
        transaction.get(tenantReference),
        transaction.get(inventoryReference),
        transaction.get(ledgerReference),
      ]);
    const order = parseOrder(orderSnapshot.data());
    if (!order) throw new Error('Pedido integrado não encontrado.');
    const effectiveStatus = resolveExternalEffectiveStatus(
      order.status,
      requestedStatus
    );
    const effectiveOrder = { ...order, status: effectiveStatus };
    const inventoryAction = applyInventoryForStatus({
      transaction,
      tenantId,
      order: effectiveOrder,
      effectiveStatus,
      tenantData: tenantSnapshot.data(),
      inventoryData: inventorySnapshot.data(),
      ledgerData: ledgerSnapshot.data(),
    });
    const updatedAt = new Date().toISOString();
    transaction.set(
      orderReference,
      {
        status: effectiveStatus,
        updatedAt,
        integration: {
          ...order.integration,
          lastEvent,
        },
        inventory: {
          lastAction: inventoryAction,
          reconciledAt: updatedAt,
        },
      },
      { merge: true }
    );
    const canonicalStoreId = clean(tenantSnapshot.data()?.canonicalStoreId);
    if (canonicalStoreId) {
      transaction.set(
        adminDb.doc(`stores/${canonicalStoreId}/orders/${orderId}`),
        {
          status: effectiveStatus,
          updatedAt,
          integration: {
            ...order.integration,
            lastEvent,
          },
          inventory: {
            lastAction: inventoryAction,
            reconciledAt: updatedAt,
          },
        },
        { merge: true }
      );
    }
    return {
      orderId,
      status: effectiveStatus,
      inventoryAction,
      ...integrationIdentity(effectiveOrder),
    };
  });

export const reconcilePersistedOrderInventory = async (
  tenantId: string,
  orderId: string
): Promise<OrderInventoryTransitionResult> =>
  adminDb.runTransaction(async transaction => {
    const orderReference = adminDb.doc(orderPath(tenantId, orderId));
    const tenantReference = adminDb.doc(`tenants/${tenantId}`);
    const inventoryReference = adminDb.doc(privateInventoryPath(tenantId));
    const ledgerReference = adminDb.doc(ledgerPath(tenantId, orderId));
    const [orderSnapshot, tenantSnapshot, inventorySnapshot, ledgerSnapshot] =
      await Promise.all([
        transaction.get(orderReference),
        transaction.get(tenantReference),
        transaction.get(inventoryReference),
        transaction.get(ledgerReference),
      ]);
    const order = parseOrder(orderSnapshot.data());
    if (!order) throw new Error('Pedido não encontrado para conciliação de estoque.');
    const inventoryAction = applyInventoryForStatus({
      transaction,
      tenantId,
      order,
      effectiveStatus: order.status,
      tenantData: tenantSnapshot.data(),
      inventoryData: inventorySnapshot.data(),
      ledgerData: ledgerSnapshot.data(),
    });
    transaction.set(
      orderReference,
      {
        inventory: {
          lastAction: inventoryAction,
          reconciledAt: new Date().toISOString(),
        },
      },
      { merge: true }
    );
    return {
      orderId,
      status: order.status,
      inventoryAction,
      ...integrationIdentity(order),
    };
  });
