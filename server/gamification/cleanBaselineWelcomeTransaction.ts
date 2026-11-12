import type { CollectionReference, DocumentReference, Transaction } from 'firebase-admin/firestore';
import { FIRST_LOGIN_WELCOME_AWARD_ID, FIRST_LOGIN_WELCOME_PITANGAS, isWelcomeCampaignEligible, planFirstLoginWelcome } from './firstLoginWelcome.js';
import { verifyFirstLoginReceiptInTransaction } from './firstLoginReceiptVerification.js';

/**
 * Isolated clean-baseline onboarding primitive. Never call on an existing
 * production economy: the caller must establish an independently isolated
 * environment and a trusted first-login receipt before invoking this.
 * No public route calls this function.
 */
export const grantCleanBaselineWelcomeInTransaction = async (
  tx: Transaction,
  input: {
    userId: string;
    firebaseCreatedAt: string;
    campaignEffectiveAt: string;
    isolatedCleanBaseline: boolean;
    receiptRef: DocumentReference;
    balanceRef: DocumentReference;
    ledgerCollection: CollectionReference;
    awardRef: DocumentReference;
  },
): Promise<{ balance: number; replay: boolean }> => {
  const uid = input.userId;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid) ||
      input.isolatedCleanBaseline !== true ||
      !isWelcomeCampaignEligible(input.firebaseCreatedAt, input.campaignEffectiveAt) ||
      input.receiptRef.path !== `users/${uid}/authEvents/first_login_v1` ||
      input.balanceRef.path !== `users/${uid}/pitangaBalance/balance` ||
      input.ledgerCollection.path !== `users/${uid}/rewardLedger` ||
      input.awardRef.path !== `users/${uid}/rewardLedger/earn_${FIRST_LOGIN_WELCOME_AWARD_ID}`) {
    throw Error('WELCOME_CLEAN_BASELINE_UNVERIFIED');
  }

  // All reads must precede writes; never overwrite existing balances.
  const [receipt, balance, ledger, award] = await Promise.all([
    verifyFirstLoginReceiptInTransaction(tx, {
      userId: uid, firebaseCreatedAt: input.firebaseCreatedAt,
      receiptRef: input.receiptRef,
    }),
    tx.get(input.balanceRef),
    tx.get(input.ledgerCollection.limit(1)),
    tx.get(input.awardRef),
  ]);
  const plan = planFirstLoginWelcome({
    userId: uid, authUserCreatedAt: input.firebaseCreatedAt,
    verifiedFirstSignInAt: receipt.occurredAt,
  });
  if (award.exists) {
    const data = award.data();
    if (!balance.exists || balance.data()?.userId !== uid ||
        !Number.isSafeInteger(balance.data()?.availableKCoins) ||
        balance.data()!.availableKCoins < 0 ||
        data?.userId !== uid || data?.type !== 'earn' ||
        data?.economy !== 'k_coin' || data?.sourceType !== 'campaign' ||
        data?.sourceId !== FIRST_LOGIN_WELCOME_AWARD_ID ||
        data?.correlationId !== FIRST_LOGIN_WELCOME_AWARD_ID ||
        data?.deltaKCoins !== FIRST_LOGIN_WELCOME_PITANGAS ||
        data?.occurredAt !== plan.occurredAt ||
        data?.idempotencyKey !== `pitanga_earn_${FIRST_LOGIN_WELCOME_AWARD_ID}`) {
      throw Error('WELCOME_CLEAN_BASELINE_REPLAY_CONFLICT');
    }
    return { balance: balance.data()!.availableKCoins, replay: true };
  }
  if (balance.exists || !ledger.empty) throw Error('WELCOME_CLEAN_BASELINE_NOT_EMPTY');
  tx.create(input.balanceRef, {
    userId: uid, availableKCoins: FIRST_LOGIN_WELCOME_PITANGAS,
    initializedBy: 'verified_clean_baseline_welcome',
  });
  tx.create(input.awardRef, {
    id: input.awardRef.id, userId: uid, type: 'earn', economy: 'k_coin',
    deltaKCoins: FIRST_LOGIN_WELCOME_PITANGAS,
    sourceType: 'campaign', sourceId: FIRST_LOGIN_WELCOME_AWARD_ID,
    correlationId: FIRST_LOGIN_WELCOME_AWARD_ID,
    idempotencyKey: `pitanga_earn_${FIRST_LOGIN_WELCOME_AWARD_ID}`,
    occurredAt: plan.occurredAt,
  });
  return { balance: FIRST_LOGIN_WELCOME_PITANGAS, replay: false };
};
