import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin';
import { reconcilePersistedOrderInventory } from './orderInventoryService';

const INVENTORY_RECONCILIATION_QUEUE = 'inventoryReconciliationQueue';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const queueId = (tenantId: string, orderId: string): string =>
  createHash('sha256').update(`${tenantId}:${orderId}`).digest('hex');

const queueReconciliation = async (
  tenantId: string,
  orderId: string,
  error: unknown
): Promise<void> => {
  await adminDb.doc(`${INVENTORY_RECONCILIATION_QUEUE}/${queueId(tenantId, orderId)}`).set(
    {
      tenantId,
      orderId,
      status: 'pending',
      attempts: FieldValue.increment(1),
      lastError: (error instanceof Error ? error.message : String(error)).slice(0, 1_000),
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
};

export interface InventorySweepResult {
  checked: number;
  reconciled: number;
  failed: number;
}

export const drainInventoryReconciliationQueue = async (
  limit = 250
): Promise<InventorySweepResult> => {
  const snapshot = await adminDb
    .collection(INVENTORY_RECONCILIATION_QUEUE)
    .limit(Math.max(1, Math.min(250, limit)))
    .get();
  const result: InventorySweepResult = {
    checked: 0,
    reconciled: 0,
    failed: 0,
  };

  for (const document of snapshot.docs) {
    result.checked += 1;
    const data = document.data() as Record<string, unknown>;
    const tenantId = clean(data.tenantId);
    const orderId = clean(data.orderId);
    if (!tenantId || !orderId) {
      result.failed += 1;
      await document.ref.delete();
      continue;
    }
    try {
      await reconcilePersistedOrderInventory(tenantId, orderId);
      await document.ref.delete();
      result.reconciled += 1;
    } catch (error) {
      result.failed += 1;
      await document.ref.set(
        {
          status: 'pending',
          attempts: FieldValue.increment(1),
          lastError: (error instanceof Error ? error.message : String(error)).slice(0, 1_000),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  }

  return result;
};

export const reconcileTenantOrdersUpdatedSince = async (
  tenantId: string,
  sinceMs: number
): Promise<InventorySweepResult> => {
  const snapshot = await adminDb
    .collection(`artifacts/${tenantId}/public/data/customerOrders`)
    .limit(500)
    .get();
  let checked = 0;
  let reconciled = 0;
  let failed = 0;

  for (const document of snapshot.docs) {
    const data = document.data() as Record<string, unknown>;
    const updatedAt = Date.parse(clean(data.updatedAt));
    if (!Number.isFinite(updatedAt) || updatedAt < sinceMs) continue;
    checked += 1;
    try {
      await reconcilePersistedOrderInventory(tenantId, document.id);
      reconciled += 1;
    } catch (error) {
      failed += 1;
      await queueReconciliation(tenantId, document.id, error);
      console.error(
        `[Inventory Sweep] ${tenantId}/${document.id}`,
        error
      );
    }
  }

  return { checked, reconciled, failed };
};

export const reconcileConnectedNinetyNineFoodOrdersUpdatedSince = async (
  sinceMs: number
): Promise<InventorySweepResult> => {
  const queued = await drainInventoryReconciliationQueue();
  const connections = await adminDb
    .collection('integrationConnections')
    .where('provider', '==', '99food')
    .get();
  const total: InventorySweepResult = { ...queued };

  for (const connection of connections.docs) {
    const tenantId = clean(connection.data().tenantId);
    if (!tenantId) continue;
    const result = await reconcileTenantOrdersUpdatedSince(tenantId, sinceMs);
    total.checked += result.checked;
    total.reconciled += result.reconciled;
    total.failed += result.failed;
  }

  return total;
};
