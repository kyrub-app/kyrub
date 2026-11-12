import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import type { KyrubRedemptionPlan } from '../../shared/gamificationRedemption.js';

/**
 * Isolated atomic voucher issuance primitive. Not wired to an endpoint.
 * Call only after the historical reward ledger has been reconciled and ALL
 * earning/spending writers share the canonical balance document.
 */
export const issuePitangaVoucherInTransaction = async (
  tx: Transaction,
  input: {
    plan: KyrubRedemptionPlan;
    balanceRef: DocumentReference;
    redemptionRef: DocumentReference;
    voucherRef: DocumentReference;
    debitRef: DocumentReference;
    auditRef: DocumentReference;
  },
): Promise<{ redemptionId: string; remainingPitangas: number; replay: boolean }> => {
  const { plan } = input;
  const uid = plan.userId;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid) ||
      !/^[A-Za-z0-9_-]{1,256}$/.test(plan.redemptionId) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(plan.rewardId) ||
      !Number.isSafeInteger(plan.debitEntry.deltaKCoins) ||
      plan.debitEntry.deltaKCoins >= 0 ||
      plan.debitEntry.userId !== uid ||
      plan.debitEntry.id !== `${plan.redemptionId}_debit` ||
      plan.debitEntry.type !== 'redeem' ||
      plan.debitEntry.sourceType !== 'reward_redemption' ||
      plan.debitEntry.sourceId !== plan.rewardId ||
      plan.auditEvent.type !== 'reward_redemption_planned' ||
      plan.debitEntry.idempotencyKey !== `redeem:${plan.auditEvent.idempotencyKey}` ||
      plan.debitEntry.correlationId !== plan.auditEvent.correlationId ||
      !Number.isFinite(Date.parse(plan.debitEntry.occurredAt)) ||
      !Number.isFinite(Date.parse(plan.validUntil)) ||
      Date.parse(plan.validUntil) <= Date.parse(plan.debitEntry.occurredAt)) {
    throw new Error('PITANGA_VOUCHER_PLAN_INVALID');
  }
  const root = `users/${uid}`;
  if (input.balanceRef.path !== `${root}/pitangaBalance/balance` ||
      input.redemptionRef.path !== `${root}/rewardRedemptions/${plan.redemptionId}` ||
      input.voucherRef.path !== `${root}/rewardVouchers/${plan.redemptionId}` ||
      input.debitRef.path !== `${root}/rewardLedger/${plan.debitEntry.id}` ||
      input.auditRef.path !== `${root}/rewardAudit/${plan.redemptionId}`) {
    throw new Error('PITANGA_VOUCHER_REFERENCE_INVALID');
  }
  const [balance, redemption, voucher, debit, audit] = await Promise.all([
    tx.get(input.balanceRef), tx.get(input.redemptionRef),
    tx.get(input.voucherRef), tx.get(input.debitRef), tx.get(input.auditRef),
  ]);
  const available = balance.data()?.availableKCoins;
  if (!balance.exists || balance.data()?.userId !== uid ||
      !Number.isSafeInteger(available) || available < 0) {
    throw new Error('PITANGA_VOUCHER_BALANCE_UNAVAILABLE');
  }
  const existing = [redemption, voucher, debit, audit];
  if (existing.some(s => s.exists)) {
    if (!existing.every(s => s.exists)) throw new Error('PITANGA_VOUCHER_PARTIAL_STATE');
    const r = redemption.data();
    const v = voucher.data();
    const d = debit.data();
    const a = audit.data();
    if (r?.userId !== uid || r?.redemptionId !== plan.redemptionId ||
        r?.rewardId !== plan.rewardId || r?.voucherCode !== plan.voucherCode ||
        r?.validUntil !== plan.validUntil || r?.status !== 'issued' ||
        r?.correlationId !== plan.auditEvent.correlationId ||
        r?.idempotencyKey !== plan.auditEvent.idempotencyKey ||
        v?.userId !== uid || v?.redemptionId !== plan.redemptionId ||
        v?.rewardId !== plan.rewardId || v?.code !== plan.voucherCode ||
        v?.validUntil !== plan.validUntil || v?.status !== 'active' ||
        d?.id !== plan.debitEntry.id || d?.userId !== uid ||
        d?.economy !== 'k_coin' || d?.type !== 'redeem' ||
        d?.sourceType !== 'reward_redemption' ||
        d?.sourceId !== plan.rewardId ||
        d?.deltaKCoins !== plan.debitEntry.deltaKCoins ||
        d?.idempotencyKey !== plan.debitEntry.idempotencyKey ||
        d?.correlationId !== plan.debitEntry.correlationId ||
        d?.occurredAt !== plan.debitEntry.occurredAt ||
        a?.userId !== uid || a?.redemptionId !== plan.redemptionId ||
        a?.type !== 'reward_redemption_issued' ||
        a?.correlationId !== plan.auditEvent.correlationId ||
        a?.idempotencyKey !== plan.auditEvent.idempotencyKey) {
      throw new Error('PITANGA_VOUCHER_IDEMPOTENCY_CONFLICT');
    }
    return { redemptionId: plan.redemptionId, remainingPitangas: available, replay: true };
  }
  const cost = -plan.debitEntry.deltaKCoins;
  if (available < cost) throw new Error('PITANGA_VOUCHER_INSUFFICIENT_BALANCE');
  const remainingPitangas = available - cost;
  tx.update(input.balanceRef, { availableKCoins: remainingPitangas });
  tx.create(input.redemptionRef, {
    redemptionId: plan.redemptionId, userId: uid, rewardId: plan.rewardId,
    voucherCode: plan.voucherCode, validUntil: plan.validUntil, status: 'issued',
    correlationId: plan.auditEvent.correlationId, idempotencyKey: plan.auditEvent.idempotencyKey,
  });
  tx.create(input.voucherRef, {
    redemptionId: plan.redemptionId, userId: uid, rewardId: plan.rewardId,
    code: plan.voucherCode, validUntil: plan.validUntil, status: 'active',
  });
  tx.create(input.debitRef, { ...plan.debitEntry, economy: 'k_coin' });
  tx.create(input.auditRef, {
    redemptionId: plan.redemptionId, userId: uid, type: 'reward_redemption_issued',
    correlationId: plan.auditEvent.correlationId, idempotencyKey: plan.auditEvent.idempotencyKey,
  });
  return { redemptionId: plan.redemptionId, remainingPitangas, replay: false };
};
