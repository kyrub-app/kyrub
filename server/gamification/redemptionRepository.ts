import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type { KyrubRedemptionPlan } from '../../shared/gamificationRedemption.js';

const redemptionPath = (userId: string, redemptionId: string) =>
  `users/${userId}/rewardRedemptions/${redemptionId}`;
const voucherPath = (userId: string, redemptionId: string) =>
  `users/${userId}/rewardVouchers/${redemptionId}`;
const ledgerPath = (userId: string, ledgerEntryId: string) =>
  `users/${userId}/rewardLedger/${ledgerEntryId}`;
const auditPath = (userId: string, redemptionId: string) =>
  `users/${userId}/rewardAudit/${redemptionId}`;

export interface PersistedKyrubRedemption {
  redemptionId: string;
  userId: string;
  rewardId: string;
  voucherCode: string;
  validUntil: string;
  status: 'issued';
  correlationId: string;
  idempotencyKey: string;
}

export const persistKyrubRedemptionAtomically = async (
  plan: KyrubRedemptionPlan
): Promise<PersistedKyrubRedemption> => {
  const redemptionRef = adminDb.doc(redemptionPath(plan.userId, plan.redemptionId));
  const voucherRef = adminDb.doc(voucherPath(plan.userId, plan.redemptionId));
  const ledgerRef = adminDb.doc(ledgerPath(plan.userId, plan.debitEntry.id));
  const auditRef = adminDb.doc(auditPath(plan.userId, plan.redemptionId));

  return adminDb.runTransaction(async transaction => {
    const [existingRedemption, existingVoucher, existingLedger, existingAudit] = await Promise.all([
      transaction.get(redemptionRef),
      transaction.get(voucherRef),
      transaction.get(ledgerRef),
      transaction.get(auditRef),
    ]);

    const existing = [existingRedemption, existingVoucher, existingLedger, existingAudit];
    if (existing.some(snapshot => snapshot.exists)) {
      if (!existingRedemption.exists) throw new Error('REDEMPTION_ATOMIC_STATE_CONFLICT');
      const current = existingRedemption.data() as PersistedKyrubRedemption;
      if (
        current.idempotencyKey !== plan.auditEvent.idempotencyKey ||
        current.correlationId !== plan.auditEvent.correlationId ||
        current.rewardId !== plan.rewardId
      ) {
        throw new Error('REDEMPTION_IDEMPOTENCY_CONFLICT');
      }
      if (!existing.every(snapshot => snapshot.exists)) {
        throw new Error('REDEMPTION_ATOMIC_STATE_CONFLICT');
      }
      return current;
    }

    const persisted: PersistedKyrubRedemption = {
      redemptionId: plan.redemptionId,
      userId: plan.userId,
      rewardId: plan.rewardId,
      voucherCode: plan.voucherCode,
      validUntil: plan.validUntil,
      status: 'issued',
      correlationId: plan.auditEvent.correlationId,
      idempotencyKey: plan.auditEvent.idempotencyKey,
    };

    transaction.create(ledgerRef, {
      ...plan.debitEntry,
      economy: 'k_coin',
      persistedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(voucherRef, {
      redemptionId: plan.redemptionId,
      userId: plan.userId,
      rewardId: plan.rewardId,
      code: plan.voucherCode,
      validUntil: plan.validUntil,
      status: 'active',
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.create(auditRef, {
      ...plan.auditEvent,
      type: 'reward_redemption_issued',
      redemptionId: plan.redemptionId,
      userId: plan.userId,
      recordedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(redemptionRef, {
      ...persisted,
      createdAt: FieldValue.serverTimestamp(),
    });

    return persisted;
  });
};
