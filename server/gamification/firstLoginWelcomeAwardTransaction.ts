import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { applyPitangaEarnInTransaction } from './pitangaEarnTransaction.js';
import { planFirstLoginWelcome } from './firstLoginWelcome.js';

/**
 * Trusted-server only. The caller must verify Firebase Auth identity and obtain
 * creation/first-sign-in metadata from Firebase Admin, never from the client.
 * Existing canonical Pitanga balance must have passed the verified migration.
 * A missing balance fails closed: no zero bootstrap and no welcome grant.
 */
export const awardFirstLoginWelcomeInTransaction = async (
  tx: Transaction,
  input: {
    userId: string;
    authUserCreatedAt: string;
    verifiedFirstSignInAt: string;
    balanceRef: DocumentReference;
    ledgerRef: DocumentReference;
  },
): Promise<{ balance: number; replay: boolean }> => {
  const plan = planFirstLoginWelcome(input);
  return applyPitangaEarnInTransaction(tx, {
    userId: plan.userId,
    awardId: plan.awardId,
    sourceType: 'campaign',
    sourceId: 'first_login_welcome_v1',
    amount: plan.amount,
    occurredAt: plan.occurredAt,
    balanceRef: input.balanceRef,
    ledgerRef: input.ledgerRef,
  });
};
