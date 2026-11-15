import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { verifyCleanBaselineSpendingEligibilityInTransaction } from './cleanBaselineSpendingEligibility.js';
import { applyPitangaXpConversionInTransaction } from './pitangaXpConversionTransaction.js';

/** Trusted server-only isolated conversion. Not an HTTP endpoint or production caller. */
export const applyCleanBaselineVerifiedXpConversionInTransaction = async (
  tx: Transaction,
  input: {
    userId: string;
    firebaseCreatedAt: string;
    requestId: string;
    requestedXp: number;
    occurredAt: string;
    balanceRef: DocumentReference;
    receiptRef: DocumentReference;
    debitRef: DocumentReference;
    xpRef: DocumentReference;
    firstLoginReceiptRef: DocumentReference;
    welcomeAwardRef: DocumentReference;
  },
) => {
  await verifyCleanBaselineSpendingEligibilityInTransaction(tx, {
    userId: input.userId,
    firebaseCreatedAt: input.firebaseCreatedAt,
    receiptRef: input.firstLoginReceiptRef,
    balanceRef: input.balanceRef,
    welcomeAwardRef: input.welcomeAwardRef,
  });
  return applyPitangaXpConversionInTransaction(tx, { ...input, verifiedCleanBaseline: true });
};
