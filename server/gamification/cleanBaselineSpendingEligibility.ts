import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { verifyFirstLoginReceiptInTransaction } from './firstLoginReceiptVerification.js';
import { FIRST_LOGIN_WELCOME_AWARD_ID, FIRST_LOGIN_WELCOME_PITANGAS } from './firstLoginWelcome.js';

/** Eligibility check only. Does not spend Pitangas or bypass migration-only gates. */
export const verifyCleanBaselineSpendingEligibilityInTransaction = async (
  tx: Transaction,
  input: {
    userId: string;
    firebaseCreatedAt: string;
    receiptRef: DocumentReference;
    balanceRef: DocumentReference;
    welcomeAwardRef: DocumentReference;
  },
): Promise<{ availablePitangas: number }> => {
  const uid = input.userId;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid) ||
      input.balanceRef.path !== `users/${uid}/pitangaBalance/balance` ||
      input.receiptRef.path !== `users/${uid}/authEvents/first_login_v1` ||
      input.welcomeAwardRef.path !== `users/${uid}/rewardLedger/earn_${FIRST_LOGIN_WELCOME_AWARD_ID}`) {
    throw Error('WELCOME_SPENDING_REFERENCE_INVALID');
  }
  const [verifiedReceipt, balance, award] = await Promise.all([
    verifyFirstLoginReceiptInTransaction(tx, {
      userId: uid, firebaseCreatedAt: input.firebaseCreatedAt, receiptRef: input.receiptRef,
    }),
    tx.get(input.balanceRef), tx.get(input.welcomeAwardRef),
  ]);
  const b = balance.data();
  const a = award.data();
  if (!balance.exists || !award.exists || b?.userId !== uid ||
      b?.initializedBy !== 'verified_clean_baseline_welcome' ||
      b?.migrationEpoch !== undefined ||
      !Number.isSafeInteger(b?.availableKCoins) || b.availableKCoins < 0 ||
      a?.id !== input.welcomeAwardRef.id || a?.userId !== uid ||
      a?.type !== 'earn' || a?.economy !== 'k_coin' ||
      a?.sourceType !== 'campaign' || a?.sourceId !== FIRST_LOGIN_WELCOME_AWARD_ID ||
      a?.correlationId !== FIRST_LOGIN_WELCOME_AWARD_ID ||
      a?.idempotencyKey !== `pitanga_earn_${FIRST_LOGIN_WELCOME_AWARD_ID}` ||
      a?.deltaKCoins !== FIRST_LOGIN_WELCOME_PITANGAS ||
      a?.occurredAt !== verifiedReceipt.occurredAt) {
    throw Error('WELCOME_SPENDING_BASELINE_UNVERIFIED');
  }
  return { availablePitangas: b.availableKCoins };
};
