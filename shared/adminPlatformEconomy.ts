import type {
  StoreEconomicLedgerKind,
  StoreEconomicLedgerSourceAuthority,
} from './storeEconomicLedger.js';

export const ADMIN_PLATFORM_ECONOMY_SCHEMA_VERSION = 1 as const;
export const ADMIN_PLATFORM_ECONOMY_RECENT_LIMIT = 100 as const;

export interface AdminPlatformEconomyTotals {
  currency: 'BRL';
  capturedMinor: number;
  refundedMinor: number;
  grossAfterRefundsMinor: number;
  captureCount: number;
  refundCount: number;
  recoveredCaptureCount: number;
  refundShareBps: number;
  platformFeesAssessedMinor: number;
  platformFeesReversedMinor: number;
  platformFeesNetMinor: number;
  platformSubsidiesGrantedMinor: number;
  platformSubsidiesReversedMinor: number;
  platformSubsidiesNetMinor: number;
  storePositionAfterPolicyMinor: number;
}

export interface AdminPlatformEconomyRecentEntry {
  id: string;
  storeId: string;
  kind: StoreEconomicLedgerKind;
  amountMinor: number;
  paymentId: string;
  paymentContext: 'marketplace' | 'table' | 'pos';
  provider: string;
  sourceAuthority: StoreEconomicLedgerSourceAuthority;
  occurredAt: string;
}

export interface AdminPlatformEconomyStoreActivity {
  storeId: string;
  capturedMinor: number;
  refundedMinor: number;
  grossAfterRefundsMinor: number;
  platformFeesNetMinor: number;
  platformSubsidiesNetMinor: number;
  storePositionAfterPolicyMinor: number;
  eventCount: number;
  lastOccurredAt: string;
}

export interface AdminPlatformEconomySnapshot {
  schemaVersion: typeof ADMIN_PLATFORM_ECONOMY_SCHEMA_VERSION;
  generatedAt: string;
  totals: AdminPlatformEconomyTotals;
  recentWindow: {
    limit: number;
    entryCount: number;
    representedStoreCount: number;
    entries: AdminPlatformEconomyRecentEntry[];
    stores: AdminPlatformEconomyStoreActivity[];
  };
}

const safeNonNegative = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`ADMIN_PLATFORM_ECONOMY_${label}_INVALID`);
  }
  return value;
};

export const deriveRefundShareBps = (
  capturedMinorInput: number,
  refundedMinorInput: number
): number => {
  const capturedMinor = safeNonNegative(capturedMinorInput, 'CAPTURED');
  const refundedMinor = safeNonNegative(refundedMinorInput, 'REFUNDED');
  if (capturedMinor === 0) return 0;
  return Math.min(10000, Math.round((refundedMinor * 10000) / capturedMinor));
};

export const buildRecentStoreEconomyActivity = (
  entries: readonly AdminPlatformEconomyRecentEntry[]
): AdminPlatformEconomyStoreActivity[] => {
  const byStore = new Map<string, AdminPlatformEconomyStoreActivity>();
  for (const entry of entries) {
    const current = byStore.get(entry.storeId) ?? {
      storeId: entry.storeId,
      capturedMinor: 0,
      refundedMinor: 0,
      grossAfterRefundsMinor: 0,
      platformFeesNetMinor: 0,
      platformSubsidiesNetMinor: 0,
      storePositionAfterPolicyMinor: 0,
      eventCount: 0,
      lastOccurredAt: '',
    };
    if (entry.kind === 'payment_capture') {
      current.capturedMinor += entry.amountMinor;
    } else if (entry.kind === 'payment_refund') {
      current.refundedMinor += Math.abs(entry.amountMinor);
    } else if (entry.kind === 'platform_fee_assessed') {
      current.platformFeesNetMinor += Math.abs(entry.amountMinor);
    } else if (entry.kind === 'platform_fee_reversed') {
      current.platformFeesNetMinor -= entry.amountMinor;
    } else if (entry.kind === 'platform_subsidy_granted') {
      current.platformSubsidiesNetMinor += entry.amountMinor;
    } else if (entry.kind === 'platform_subsidy_reversed') {
      current.platformSubsidiesNetMinor -= Math.abs(entry.amountMinor);
    }
    current.grossAfterRefundsMinor =
      current.capturedMinor - current.refundedMinor;
    current.storePositionAfterPolicyMinor =
      current.grossAfterRefundsMinor -
      current.platformFeesNetMinor +
      current.platformSubsidiesNetMinor;
    current.eventCount += 1;
    if (!current.lastOccurredAt || entry.occurredAt > current.lastOccurredAt) {
      current.lastOccurredAt = entry.occurredAt;
    }
    byStore.set(entry.storeId, current);
  }
  return [...byStore.values()].sort((left, right) =>
    right.lastOccurredAt.localeCompare(left.lastOccurredAt) ||
    left.storeId.localeCompare(right.storeId)
  );
};
