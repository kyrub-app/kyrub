import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { verifyCleanBaselineSpendingEligibilityInTransaction } from './cleanBaselineSpendingEligibility.js';

/**
 * Shared guard for legacy global Pitanga writers during migration.
 * Every production writer must call this inside its Firestore transaction,
 * BEFORE any mutation. Installing this helper alone does not fence writers.
 *
 * Missing control document means normal legacy operation, preserving behavior
 * until an explicitly approved migration fence is activated.
 */
export const assertLegacyPitangaWriterAllowedInTransaction = async (
  tx: Transaction,
  input: {
    fenceRef: DocumentReference;
    expectedEpoch?: string;
  },
): Promise<void> => {
  if (input.fenceRef.path !== 'systemControl/pitangaLegacyWriterFence') {
    throw new Error('PITANGA_LEGACY_FENCE_REFERENCE_INVALID');
  }
  const snapshot = await tx.get(input.fenceRef);
  // A missing fence is not evidence of a safe migration. This guard is only
  // backward-compatible before cutover; the migration verifier requires
  // an explicit fenced record and independent writer inventory.
  if (!snapshot.exists) return;
  const fence = snapshot.data();
  if (fence?.status === 'fenced' || fence?.status === 'fencing') {
    throw new Error('PITANGA_LEGACY_WRITER_FENCED');
  }
  if (fence?.status !== 'open' ||
      (input.expectedEpoch !== undefined && fence?.epoch !== input.expectedEpoch)) {
    throw new Error('PITANGA_LEGACY_FENCE_INVALID');
  }
};

/**
 * A fenced legacy writer remains blocked. A clean-baseline writer may proceed
 * only after independently rechecking its signed first-login provenance inside
 * the SAME transaction. Never use this for legacy earning or migration.
 */
export const assertPitangaCleanBaselineWriterAllowedInTransaction = async (
  tx: Transaction,
  input: {
    userId: string;
    firebaseCreatedAt: string;
    balanceRef: DocumentReference;
    firstLoginReceiptRef: DocumentReference;
    welcomeAwardRef: DocumentReference;
    fenceRef: DocumentReference;
  },
): Promise<void> => {
  if (input.fenceRef.path !== 'systemControl/pitangaLegacyWriterFence') {
    throw new Error('PITANGA_LEGACY_FENCE_REFERENCE_INVALID');
  }
  const fence = await tx.get(input.fenceRef);
  const status = fence.exists ? fence.data()?.status : undefined;
  if (status !== undefined && status !== 'open' && status !== 'fenced') {
    throw new Error('PITANGA_CLEAN_BASELINE_FENCE_INVALID');
  }
  if (status === 'fenced' && fence.data()?.writersVerified !== true) {
    throw new Error('PITANGA_CLEAN_BASELINE_FENCE_UNVERIFIED');
  }
  await verifyCleanBaselineSpendingEligibilityInTransaction(tx, {
    userId: input.userId,
    firebaseCreatedAt: input.firebaseCreatedAt,
    balanceRef: input.balanceRef,
    receiptRef: input.firstLoginReceiptRef,
    welcomeAwardRef: input.welcomeAwardRef,
  });
};
