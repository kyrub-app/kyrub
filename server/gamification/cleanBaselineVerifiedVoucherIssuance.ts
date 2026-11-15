import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import type { KyrubRedemptionPlan } from '../../shared/gamificationRedemption.js';
import { verifyCleanBaselineSpendingEligibilityInTransaction } from './cleanBaselineSpendingEligibility.js';
import { issuePitangaVoucherInTransaction } from './pitangaVoucherIssuanceTransaction.js';

/** Isolated trusted-server voucher gate for a verified new-user balance. No public route. */
export const issueCleanBaselineVerifiedPitangaVoucherInTransaction = async (
  tx: Transaction,
  input: {
    plan: KyrubRedemptionPlan;
    firebaseCreatedAt: string;
    balanceRef: DocumentReference;
    firstLoginReceiptRef: DocumentReference;
    welcomeAwardRef: DocumentReference;
    redemptionRef: DocumentReference;
    voucherRef: DocumentReference;
    debitRef: DocumentReference;
    auditRef: DocumentReference;
  },
): Promise<{ redemptionId: string; remainingPitangas: number; replay: boolean }> => {
  await verifyCleanBaselineSpendingEligibilityInTransaction(tx, {
    userId: input.plan.userId,
    firebaseCreatedAt: input.firebaseCreatedAt,
    receiptRef: input.firstLoginReceiptRef,
    balanceRef: input.balanceRef,
    welcomeAwardRef: input.welcomeAwardRef,
  });
  return issuePitangaVoucherInTransaction(tx, input);
};
