import type { Firestore } from 'firebase-admin/firestore';
import { applyVerifiedPitangaXpConversionInTransaction } from './pitangaVerifiedXpConversion.js';

/**
 * Trusted server-only adapter. This module deliberately exposes no HTTP route.
 * Cutover and writer-fence verification remain release gates.
 */
export const convertVerifiedPitangasToXp = async (
  db: Firestore,
  input: { userId: string; requestId: string; requestedXp: number; occurredAt: string },
) => {
  const { userId, requestId } = input;
  if (typeof userId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(userId) ||
      typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(requestId)) {
    throw new Error('CONVERSION_SERVICE_INPUT_INVALID');
  }
  const root = db.collection('users').doc(userId);
  return db.runTransaction(tx => applyVerifiedPitangaXpConversionInTransaction(tx, {
    ...input,
    balanceRef: root.collection('pitangaBalance').doc('balance'),
    receiptRef: root.collection('pitangaXpConversions').doc(requestId),
    debitRef: root.collection('rewardLedger').doc(`conversion_${requestId}`),
    xpRef: root.collection('xpLedger').doc(`conversion_${requestId}`),
    migrationReceiptRef: root.collection('pitangaMigration').doc('receipt'),
    fenceRef: db.doc('systemControl/pitangaLegacyWriterFence'),
  }));
};
