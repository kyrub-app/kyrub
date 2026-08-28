import {
  doc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { CustomerOrder } from './customerOrders';
import { db } from './firebase';
import {
  getLoyaltyLedgerEventPath,
  type LoyaltyLedgerEvent,
} from './loyaltyLedger';
import {
  isLoyaltyChallengeAvailable,
  type LoyaltyChallenge,
} from './loyaltyChallenges';

export interface LoyaltyChallengeProgress {
  challengeId: string;
  buyerId: string;
  buyerEmail: string;
  value: number;
  target: number;
  completed: boolean;
}

const normalizeEmail = (value: string): string =>
  value.trim().toLocaleLowerCase('pt-BR');

const customerKey = (buyerId: string, buyerEmail: string): string =>
  buyerId.trim() || normalizeEmail(buyerEmail);

const inChallengeWindow = (value: string, challenge: LoyaltyChallenge): boolean => {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return false;
  const start = challenge.startsAt ? new Date(challenge.startsAt).getTime() : 0;
  const end = challenge.endsAt ? new Date(`${challenge.endsAt}T23:59:59.999`).getTime() : 0;
  if (start && Number.isFinite(start) && timestamp < start) return false;
  if (end && Number.isFinite(end) && timestamp > end) return false;
  return true;
};

export const getLoyaltyChallengeCompletionsCollectionPath = (storeId: string): string =>
  `artifacts/${storeId.trim()}/public/data/loyaltyChallengeCompletions`;

export const getLoyaltyChallengeCompletionId = (
  challengeId: string,
  buyerId: string,
  buyerEmail: string
): string => {
  const identity = customerKey(buyerId, buyerEmail)
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .slice(0, 120);
  return `${challengeId.trim()}__${identity}`;
};

export const calculateLoyaltyChallengeProgress = (
  challenge: LoyaltyChallenge,
  buyerId: string,
  buyerEmail: string,
  orders: CustomerOrder[],
  ledger: LoyaltyLedgerEvent[]
): LoyaltyChallengeProgress => {
  const id = buyerId.trim();
  const email = normalizeEmail(buyerEmail);
  let value = 0;

  if (challenge.metric === 'paid_orders') {
    value = orders.filter(order => {
      const matches = order.buyerId === id || (!!email && normalizeEmail(order.buyerEmail) === email);
      return matches &&
        order.paymentStatus === 'paid' &&
        order.status !== 'cancelled' &&
        order.status !== 'rejected' &&
        inChallengeWindow(order.updatedAt || order.createdAt, challenge);
    }).length;
  } else {
    value = ledger.reduce((total, event) => {
      const matches = event.buyerId === id || (!!email && normalizeEmail(event.buyerEmail) === email);
      if (!matches || event.type !== 'earn' || event.points <= 0) return total;
      if (!inChallengeWindow(event.createdAt, challenge)) return total;
      return total + event.points;
    }, 0);
  }

  return {
    challengeId: challenge.id,
    buyerId: id,
    buyerEmail: email,
    value,
    target: challenge.target,
    completed: value >= challenge.target,
  };
};

export const reconcileLoyaltyChallengeCompletion = async (
  user: Pick<User, 'uid'>,
  challenge: LoyaltyChallenge,
  progress: LoyaltyChallengeProgress
): Promise<{ created: boolean; rewardPoints: number }> => {
  if (challenge.storeId !== user.uid) {
    throw new Error('Desafio pertence a outra loja.');
  }
  if (!progress.completed || !isLoyaltyChallengeAvailable(challenge)) {
    return { created: false, rewardPoints: 0 };
  }

  const completionId = getLoyaltyChallengeCompletionId(
    challenge.id,
    progress.buyerId,
    progress.buyerEmail
  );
  const completionReference = doc(
    db,
    getLoyaltyChallengeCompletionsCollectionPath(user.uid),
    completionId
  );
  const adjustmentId = `challenge-${completionId}-reward`;
  const adjustmentReference = doc(
    db,
    getLoyaltyLedgerEventPath(user.uid, adjustmentId)
  );

  return runTransaction(db, async transaction => {
    const [completionSnapshot, adjustmentSnapshot] = await Promise.all([
      transaction.get(completionReference),
      transaction.get(adjustmentReference),
    ]);

    if (completionSnapshot.exists()) {
      return {
        created: false,
        rewardPoints: Number(completionSnapshot.data()?.rewardPoints) || 0,
      };
    }

    const completedAt = new Date().toISOString();
    transaction.set(completionReference, {
      id: completionId,
      storeId: user.uid,
      challengeId: challenge.id,
      challengeTitle: challenge.title,
      buyerId: progress.buyerId,
      buyerEmail: progress.buyerEmail,
      metric: challenge.metric,
      achievedValue: progress.value,
      target: progress.target,
      rewardPoints: challenge.rewardPoints,
      completedAt,
      recordedAt: serverTimestamp(),
      schemaVersion: 1,
    });

    if (challenge.rewardPoints > 0 && !adjustmentSnapshot.exists()) {
      transaction.set(adjustmentReference, {
        id: adjustmentId,
        storeId: user.uid,
        buyerId: progress.buyerId,
        buyerEmail: progress.buyerEmail,
        orderId: `challenge-${challenge.id}`,
        type: 'adjustment',
        points: challenge.rewardPoints,
        reason: `Bônus do desafio: ${challenge.title}`,
        lines: [],
        sourceEventId: completionId,
        createdAt: completedAt,
        recordedAt: serverTimestamp(),
        schemaVersion: 1,
      });
    }

    return { created: true, rewardPoints: challenge.rewardPoints };
  });
};

export const reconcileActiveLoyaltyChallenges = async (
  user: Pick<User, 'uid'>,
  challenges: LoyaltyChallenge[],
  orders: CustomerOrder[],
  ledger: LoyaltyLedgerEvent[]
): Promise<number> => {
  const identities = new Map<string, { buyerId: string; buyerEmail: string }>();
  orders.forEach(order => {
    const key = customerKey(order.buyerId, order.buyerEmail);
    if (key) identities.set(key, { buyerId: order.buyerId, buyerEmail: order.buyerEmail });
  });
  ledger.forEach(event => {
    const key = customerKey(event.buyerId, event.buyerEmail);
    if (key && !identities.has(key)) {
      identities.set(key, { buyerId: event.buyerId, buyerEmail: event.buyerEmail });
    }
  });

  let completed = 0;
  for (const challenge of challenges.filter(item => isLoyaltyChallengeAvailable(item))) {
    for (const identity of identities.values()) {
      const progress = calculateLoyaltyChallengeProgress(
        challenge,
        identity.buyerId,
        identity.buyerEmail,
        orders,
        ledger
      );
      if (!progress.completed) continue;
      const result = await reconcileLoyaltyChallengeCompletion(user, challenge, progress);
      if (result.created) completed += 1;
    }
  }
  return completed;
};
