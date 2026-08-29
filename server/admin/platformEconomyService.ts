import { AggregateField } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  ADMIN_PLATFORM_ECONOMY_RECENT_LIMIT,
  ADMIN_PLATFORM_ECONOMY_SCHEMA_VERSION,
  buildRecentStoreEconomyActivity,
  deriveRefundShareBps,
  type AdminPlatformEconomyRecentEntry,
  type AdminPlatformEconomySnapshot,
} from '../../shared/adminPlatformEconomy.js';
import type { StoreEconomicLedgerEntry } from '../../shared/storeEconomicLedger.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const safeAggregateInteger = (value: unknown, label: string): number => {
  const numeric = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isSafeInteger(numeric)) {
    throw new Error(`ADMIN_PLATFORM_ECONOMY_${label}_INVALID`);
  }
  return numeric;
};

const parseRecentEntry = (value: unknown): AdminPlatformEconomyRecentEntry => {
  const entry = value as Partial<StoreEconomicLedgerEntry>;
  if (
    entry.schemaVersion !== 1 ||
    !clean(entry.id) ||
    !clean(entry.storeId) ||
    (entry.kind !== 'payment_capture' && entry.kind !== 'payment_refund') ||
    !Number.isSafeInteger(entry.amountMinor) ||
    entry.amountMinor === 0 ||
    !clean(entry.paymentId) ||
    (entry.paymentContext !== 'marketplace' &&
      entry.paymentContext !== 'table' &&
      entry.paymentContext !== 'pos') ||
    !clean(entry.provider) ||
    (entry.sourceAuthority !== 'provider_webhook' &&
      entry.sourceAuthority !== 'canonical_payment_snapshot') ||
    !clean(entry.occurredAt) ||
    !Number.isFinite(Date.parse(entry.occurredAt))
  ) {
    throw new Error('ADMIN_PLATFORM_ECONOMY_ENTRY_INVALID');
  }
  return {
    id: entry.id,
    storeId: entry.storeId,
    kind: entry.kind,
    amountMinor: entry.amountMinor,
    paymentId: entry.paymentId,
    paymentContext: entry.paymentContext,
    provider: entry.provider,
    sourceAuthority: entry.sourceAuthority,
    occurredAt: entry.occurredAt,
  };
};

export const loadAdminPlatformEconomySnapshot = async (): Promise<AdminPlatformEconomySnapshot> => {
  const ledger = adminDb.collectionGroup('economicLedger');
  const captures = ledger.where('kind', '==', 'payment_capture');
  const refunds = ledger.where('kind', '==', 'payment_refund');
  const recovered = ledger.where(
    'sourceAuthority',
    '==',
    'canonical_payment_snapshot'
  );

  const [
    captureAmountSnapshot,
    refundAmountSnapshot,
    captureCountSnapshot,
    refundCountSnapshot,
    recoveredCountSnapshot,
    recentSnapshot,
  ] = await Promise.all([
    captures.aggregate({ amountMinor: AggregateField.sum('amountMinor') }).get(),
    refunds.aggregate({ amountMinor: AggregateField.sum('amountMinor') }).get(),
    captures.count().get(),
    refunds.count().get(),
    recovered.count().get(),
    ledger
      .orderBy('occurredAt', 'desc')
      .limit(ADMIN_PLATFORM_ECONOMY_RECENT_LIMIT)
      .get(),
  ]);

  const capturedMinor = safeAggregateInteger(
    captureAmountSnapshot.data().amountMinor ?? 0,
    'CAPTURED'
  );
  const refundSignedMinor = safeAggregateInteger(
    refundAmountSnapshot.data().amountMinor ?? 0,
    'REFUNDED'
  );
  if (capturedMinor < 0 || refundSignedMinor > 0) {
    throw new Error('ADMIN_PLATFORM_ECONOMY_SIGN_INVARIANT_INVALID');
  }
  const refundedMinor = Math.abs(refundSignedMinor);
  const grossAfterRefundsMinor = capturedMinor - refundedMinor;
  if (!Number.isSafeInteger(grossAfterRefundsMinor)) {
    throw new Error('ADMIN_PLATFORM_ECONOMY_GROSS_INVALID');
  }

  const captureCount = safeAggregateInteger(
    captureCountSnapshot.data().count,
    'CAPTURE_COUNT'
  );
  const refundCount = safeAggregateInteger(
    refundCountSnapshot.data().count,
    'REFUND_COUNT'
  );
  const recoveredCaptureCount = safeAggregateInteger(
    recoveredCountSnapshot.data().count,
    'RECOVERED_COUNT'
  );
  const entries = recentSnapshot.docs.map(document =>
    parseRecentEntry(document.data())
  );
  const stores = buildRecentStoreEconomyActivity(entries);

  return {
    schemaVersion: ADMIN_PLATFORM_ECONOMY_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    totals: {
      currency: 'BRL',
      capturedMinor,
      refundedMinor,
      grossAfterRefundsMinor,
      captureCount,
      refundCount,
      recoveredCaptureCount,
      refundShareBps: deriveRefundShareBps(capturedMinor, refundedMinor),
    },
    recentWindow: {
      limit: ADMIN_PLATFORM_ECONOMY_RECENT_LIMIT,
      entryCount: entries.length,
      representedStoreCount: stores.length,
      entries,
      stores,
    },
  };
};
