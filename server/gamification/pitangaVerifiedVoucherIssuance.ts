import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import type { KyrubRedemptionPlan } from '../../shared/gamificationRedemption.js';
import { issuePitangaVoucherInTransaction } from './pitangaVoucherIssuanceTransaction.js';

/**
 * Fail-closed voucher issuance gate. This wrapper is intentionally not wired
 * to an API until the production writer fence and historical cutover are approved.
 * It verifies that the user's canonical balance was created by the migration,
 * rather than accepting an arbitrary balance document as spending authority.
 */
export const issueVerifiedPitangaVoucherInTransaction = async (
  tx: Transaction,
  input: {
    plan: KyrubRedemptionPlan;
    balanceRef: DocumentReference;
    receiptRef: DocumentReference;
    fenceRef: DocumentReference;
    redemptionRef: DocumentReference;
    voucherRef: DocumentReference;
    debitRef: DocumentReference;
    auditRef: DocumentReference;
  },
): Promise<{ redemptionId: string; remainingPitangas: number; replay: boolean }> => {
  const uid = input.plan.userId;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid) ||
      input.balanceRef.path !== `users/${uid}/pitangaBalance/balance` ||
      input.receiptRef.path !== `users/${uid}/pitangaMigration/receipt` ||
      input.fenceRef.path !== 'systemControl/pitangaLegacyWriterFence') {
    throw new Error('PITANGA_VOUCHER_MIGRATION_REFERENCE_INVALID');
  }
  const [balance, receipt, fence] = await Promise.all([
    tx.get(input.balanceRef), tx.get(input.receiptRef), tx.get(input.fenceRef),
  ]);
  const b = balance.data();
  const r = receipt.data();
  const f = fence.data();
  if (!balance.exists || !receipt.exists || !fence.exists ||
      b?.userId !== uid || r?.userId !== uid ||
      typeof b?.migrationEpoch !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(b.migrationEpoch) ||
      r?.fenceEpoch !== b.migrationEpoch ||
      !Number.isSafeInteger(b?.availableKCoins) || b.availableKCoins < 0 ||
      f?.epoch !== b.migrationEpoch || f?.status !== 'fenced' ||
      f?.writersVerified !== true ||
      !Number.isSafeInteger(r?.balance) || r.balance < 0 ||
      !Number.isSafeInteger(r?.entryCount) || r.entryCount < 0 ||
      typeof r?.ledgerSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(r.ledgerSha256)) {
    throw new Error('PITANGA_VOUCHER_MIGRATION_UNVERIFIED');
  }
  return issuePitangaVoucherInTransaction(tx, input);
};
