import {
  listStoreEconomicLedgerEntriesForOrder,
  listStoreEconomicLedgerPage,
} from './storeEconomicLedgerService.js';
import { reconcileStoreOrderProfitabilityForOrder } from './storeOrderProfitabilityService.js';
import { reconcileStoreProductProfitabilityForOrder } from './storeProductProfitabilityService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export type StoreProfitabilityBackfillResult = {
  storeId: string;
  pageLimit: number;
  processedLedgerEntries: number;
  discoveredOrders: number;
  reconciledOrders: number;
  reconciliationErrors: Array<{ orderId: string; code: string }>;
  hasMore: boolean;
  nextCursor: string;
};

export const backfillStoreProfitabilityPage = async (input: {
  storeId: string;
  limit?: number;
  cursor?: string;
}): Promise<StoreProfitabilityBackfillResult> => {
  const storeId = clean(input.storeId);
  if (!storeId) throw new Error('STORE_ORDER_PROFITABILITY_STORE_REQUIRED');
  const page = await listStoreEconomicLedgerPage({
    storeId,
    limit: input.limit,
    cursor: clean(input.cursor) || undefined,
  });
  const orderIds = [...new Set(page.entries.map(entry => clean(entry.orderId)).filter(Boolean))];
  const reconciliationErrors: Array<{ orderId: string; code: string }> = [];
  let reconciledOrders = 0;

  for (const orderId of orderIds) {
    try {
      const completeEconomicEntries = await listStoreEconomicLedgerEntriesForOrder({
        storeId,
        orderId,
      });
      const orderProfitability = await reconcileStoreOrderProfitabilityForOrder({
        storeId,
        orderId,
        economicEntries: completeEconomicEntries,
      });
      await reconcileStoreProductProfitabilityForOrder({
        storeId,
        orderProfitability,
      });
      reconciledOrders += 1;
    } catch (error) {
      const code = error instanceof Error
        ? error.message
        : 'STORE_PROFITABILITY_BACKFILL_RECONCILIATION_FAILED';
      console.warn('[Store profitability backfill] Order reconciliation skipped.', {
        storeId,
        orderId,
        code,
      });
      reconciliationErrors.push({ orderId, code });
    }
  }

  return {
    storeId,
    pageLimit: input.limit ?? 25,
    processedLedgerEntries: page.entries.length,
    discoveredOrders: orderIds.length,
    reconciledOrders,
    reconciliationErrors,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
  };
};