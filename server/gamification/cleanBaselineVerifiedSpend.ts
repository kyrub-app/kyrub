import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { verifyCleanBaselineSpendingEligibilityInTransaction } from './cleanBaselineSpendingEligibility.js';
import { applyPitangaSpendInTransaction } from './pitangaSpendTransaction.js';

/** Isolated trusted-server primitive. No public endpoint or production caller. */
export const applyCleanBaselineVerifiedSpendInTransaction = async (
  tx: Transaction,
  input: {
    userId: string;
    firebaseCreatedAt: string;
    spendId: string;
    amount: number;
    sourceId: string;
    occurredAt: string;
    balanceRef: DocumentReference;
    debitRef: DocumentReference;
    firstLoginReceiptRef: DocumentReference;
    welcomeAwardRef: DocumentReference;
  },
): Promise<{ remainingPitangas: number; replay: boolean }> => {
  await verifyCleanBaselineSpendingEligibilityInTransaction(tx, {
    userId: input.userId,
    firebaseCreatedAt: input.firebaseCreatedAt,
    receiptRef: input.firstLoginReceiptRef,
    balanceRef: input.balanceRef,
    welcomeAwardRef: input.welcomeAwardRef,
  });
  return applyPitangaSpendInTransaction(tx, input);
};
