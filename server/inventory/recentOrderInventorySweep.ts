import { adminDb } from '../firebaseAdmin';
import { reconcilePersistedOrderInventory } from './orderInventoryService';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export interface InventorySweepResult {
  checked: number;
  reconciled: number;
  failed: number;
}

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
  const connections = await adminDb
    .collection('integrationConnections')
    .where('provider', '==', '99food')
    .get();
  const total: InventorySweepResult = {
    checked: 0,
    reconciled: 0,
    failed: 0,
  };

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
