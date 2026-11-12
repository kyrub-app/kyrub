import type { Firestore } from 'firebase-admin/firestore';
import type { KyrubRedemptionPlan } from '../../shared/gamificationRedemption.js';
import { issueVerifiedPitangaVoucherInTransaction } from './pitangaVerifiedVoucherIssuance.js';

/**
 * Trusted server-only adapter. No public route until the legacy-writer fence,
 * historical migration, and cutover are independently approved.
 */
export const issueVerifiedPitangaVoucher = async (
  db: Firestore,
  plan: KyrubRedemptionPlan,
) => {
  const uid = plan?.userId;
  const redemptionId = plan?.redemptionId;
  if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid) ||
      typeof redemptionId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(redemptionId)) {
    throw new Error('PITANGA_VOUCHER_SERVICE_INPUT_INVALID');
  }
  const root = db.collection('users').doc(uid);
  return db.runTransaction(tx => issueVerifiedPitangaVoucherInTransaction(tx, {
    plan,
    balanceRef: root.collection('pitangaBalance').doc('balance'),
    receiptRef: root.collection('pitangaMigration').doc('receipt'),
    fenceRef: db.doc('systemControl/pitangaLegacyWriterFence'),
    redemptionRef: root.collection('rewardRedemptions').doc(redemptionId),
    voucherRef: root.collection('rewardVouchers').doc(redemptionId),
    debitRef: root.collection('rewardLedger').doc(`${redemptionId}_debit`),
    auditRef: root.collection('rewardAudit').doc(redemptionId),
  }));
};
