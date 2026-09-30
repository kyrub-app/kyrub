import { createHash } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import {
  buildStoreOrderProfitabilitySnapshot,
  storeOrderProfitabilityPath,
  type StoreOrderInventoryCostEvidence,
  type StoreOrderProfitabilitySnapshot,
} from '../../shared/storeOrderProfitability.js';
import type { StoreEconomicLedgerEntry } from '../../shared/storeEconomicLedger.js';
import { listStoreEconomicLedgerEntries } from './storeEconomicLedgerService.js';

const MAX_ECONOMIC_ENTRIES = 100;
const MAX_ORDERS = 40;

// Canonical server-only persistence remains under stores/{storeId}/orderProfitability/{orderId}.
// The shared path helper owns escaping so raw order ids are never interpolated into Firestore paths here.

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finiteNonNegativeInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;

const inventoryEvidenceForOrder = async (
  storeId: string,
  orderId: string
): Promise<StoreOrderInventoryCostEvidence | null> => {
  const snapshot = await adminDb
    .collection('inventoryOrderConsumptions')
    .where('canonicalStoreId', '==', storeId)
    .where('orderId', '==', orderId)
    .limit(2)
    .get();

  if (snapshot.empty) return null;
  if (snapshot.size !== 1) {
    throw new Error('STORE_ORDER_PROFITABILITY_INVENTORY_CONFLICT');
  }

  const document = snapshot.docs[0];
  if (!document) return null;
  const data = document.data();
  const status = data.status === 'consumed' || data.status === 'reversed' || data.status === 'skipped'
    ? data.status
    : 'missing';
  const lines = Array.isArray(data.lines)
    ? data.lines.flatMap((candidate: unknown) => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
        const line = candidate as Record<string, unknown>;
        const inventoryItemId = clean(line.inventoryItemId);
        if (!inventoryItemId) return [];
        const totalCostMinor = finiteNonNegativeInteger(line.totalCostMinor);
        const costBasisStatus = line.costBasisStatus === 'complete' && totalCostMinor !== null
          ? 'complete' as const
          : 'incomplete' as const;
        return [{ inventoryItemId, totalCostMinor, costBasisStatus }];
      })
    : [];

  return {
    ledgerId: document.id,
    status,
    lines,
  };
};

type PersistedOrderProfitability = StoreOrderProfitabilitySnapshot & {
  sourceFingerprint: string;
};

const sourceFingerprint = (input: {
  economicEntries: readonly StoreEconomicLedgerEntry[];
  inventoryEvidence: StoreOrderInventoryCostEvidence | null;
}): string => {
  const economicEntries = input.economicEntries
    .map(entry => ({
      id: entry.id,
      kind: entry.kind,
      amountMinor: entry.amountMinor,
      paymentId: entry.paymentId,
      orderId: entry.orderId,
      occurredAt: entry.occurredAt,
      reversalOfEntryId: entry.reversalOfEntryId,
      economicAllocation: entry.economicAllocation ?? null,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return createHash('sha256')
    .update(JSON.stringify({ economicEntries, inventoryEvidence: input.inventoryEvidence }))
    .digest('hex');
};

const existingCalculatedAt = (
  value: unknown,
  expectedFingerprint: string
): string => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const record = value as Record<string, unknown>;
  if (clean(record.sourceFingerprint) !== expectedFingerprint) return '';
  const calculatedAt = clean(record.calculatedAt);
  return calculatedAt && Number.isFinite(Date.parse(calculatedAt)) ? calculatedAt : '';
};

const reconcileOrder = async (input: {
  storeId: string;
  orderId: string;
  economicEntries: readonly StoreEconomicLedgerEntry[];
}): Promise<PersistedOrderProfitability> => {
  const inventoryEvidence = await inventoryEvidenceForOrder(input.storeId, input.orderId);
  const fingerprint = sourceFingerprint({
    economicEntries: input.economicEntries,
    inventoryEvidence,
  });
  const ref = adminDb.doc(storeOrderProfitabilityPath(input.storeId, input.orderId));
  const existing = await ref.get();
  const stableCalculatedAt = existingCalculatedAt(existing.data(), fingerprint);
  const calculatedAt = stableCalculatedAt || new Date().toISOString();
  const snapshot = buildStoreOrderProfitabilitySnapshot({
    storeId: input.storeId,
    orderId: input.orderId,
    economicEntries: input.economicEntries,
    inventoryEvidence,
    calculatedAt,
  });
  const persisted: PersistedOrderProfitability = {
    ...snapshot,
    sourceFingerprint: fingerprint,
  };

  if (!stableCalculatedAt) {
    await ref.set(persisted, { merge: false });
  }
  return persisted;
};

export type StoreOrderProfitabilityOverview = {
  storeId: string;
  currency: 'BRL';
  sourceEntryLimit: number;
  sourceEntriesTruncated: boolean;
  items: PersistedOrderProfitability[];
  reconciliationErrors: Array<{ orderId: string; code: string }>;
  summary: {
    orderCount: number;
    completeCount: number;
    partialCount: number;
    effectiveMarginCount: number;
    knownMerchandiseRevenueMinor: number;
    knownSaleCmvMinor: number;
    effectiveRevenueMinor: number;
    effectiveContributionMinor: number;
    effectiveContributionMarginPercent: number | null;
  };
};

export const reconcileStoreOrderProfitability = async (
  storeIdValue: string
): Promise<StoreOrderProfitabilityOverview> => {
  const storeId = clean(storeIdValue);
  if (!storeId) throw new Error('STORE_ORDER_PROFITABILITY_STORE_REQUIRED');

  const entries = await listStoreEconomicLedgerEntries({
    storeId,
    limit: MAX_ECONOMIC_ENTRIES,
  });
  const byOrder = new Map<string, StoreEconomicLedgerEntry[]>();
  for (const entry of entries) {
    const orderId = clean(entry.orderId);
    if (!orderId) continue;
    const current = byOrder.get(orderId) ?? [];
    current.push(entry);
    byOrder.set(orderId, current);
  }

  const orderIds = [...byOrder.keys()].slice(0, MAX_ORDERS);
  const reconciled = await Promise.all(orderIds.map(async orderId => {
    try {
      const item = await reconcileOrder({
        storeId,
        orderId,
        economicEntries: byOrder.get(orderId) ?? [],
      });
      return { orderId, item, error: '' };
    } catch (error) {
      const code = error instanceof Error ? error.message : 'STORE_ORDER_PROFITABILITY_RECONCILIATION_FAILED';
      console.warn('[Store order profitability] Reconciliation skipped.', {
        storeId,
        orderId,
        code,
      });
      return { orderId, item: null, error: code };
    }
  }));

  const items = reconciled
    .flatMap(result => result.item ? [result.item] : [])
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
  const reconciliationErrors = reconciled.flatMap(result =>
    result.error ? [{ orderId: result.orderId, code: result.error }] : []
  );

  let knownMerchandiseRevenueMinor = 0;
  let knownSaleCmvMinor = 0;
  let effectiveRevenueMinor = 0;
  let effectiveContributionMinor = 0;
  let effectiveMarginCount = 0;
  for (const item of items) {
    if (item.merchandiseRevenueMinor !== null) {
      knownMerchandiseRevenueMinor += item.merchandiseRevenueMinor;
    }
    if (item.saleCmvMinor !== null) knownSaleCmvMinor += item.saleCmvMinor;
    if (
      item.effectiveMarginAvailable
      && item.merchandiseRevenueMinor !== null
      && item.contributionMinor !== null
    ) {
      effectiveMarginCount += 1;
      effectiveRevenueMinor += item.merchandiseRevenueMinor;
      effectiveContributionMinor += item.contributionMinor;
    }
  }
  const safeTotals = [
    knownMerchandiseRevenueMinor,
    knownSaleCmvMinor,
    effectiveRevenueMinor,
    effectiveContributionMinor,
  ].every(Number.isSafeInteger);
  if (!safeTotals) throw new Error('STORE_ORDER_PROFITABILITY_SUMMARY_OVERFLOW');

  return {
    storeId,
    currency: 'BRL',
    sourceEntryLimit: MAX_ECONOMIC_ENTRIES,
    sourceEntriesTruncated: entries.length >= MAX_ECONOMIC_ENTRIES,
    items,
    reconciliationErrors,
    summary: {
      orderCount: items.length,
      completeCount: items.filter(item => item.dataStatus === 'complete').length,
      partialCount: items.filter(item => item.dataStatus === 'partial').length,
      effectiveMarginCount,
      knownMerchandiseRevenueMinor,
      knownSaleCmvMinor,
      effectiveRevenueMinor,
      effectiveContributionMinor,
      effectiveContributionMarginPercent: effectiveRevenueMinor > 0
        ? (effectiveContributionMinor / effectiveRevenueMinor) * 100
        : null,
    },
  };
};
