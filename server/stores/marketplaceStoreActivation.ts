import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';

/**
 * Atomic publication and first activation for a future authenticated owner
 * endpoint. Call only after the commercial activation form is validated.
 * Existing first-activation markers are never reset on republishing.
 */
export const publishMarketplaceStoreAndRecordFirstActivation = async (
  storeId: string,
  ownerId: string
): Promise<{ firstActivatedAt: string; newlyActivated: boolean }> => {
  const normalizedStoreId = storeId.trim();
  const normalizedOwnerId = ownerId.trim();
  if (!normalizedStoreId || !normalizedOwnerId || normalizedStoreId.includes('/')) {
    throw new Error('Invalid store activation identity.');
  }
  const reference = adminDb.doc(`stores/${normalizedStoreId}`);
  return adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new Error('Store not found.');
    const data = snapshot.data() ?? {};
    if (data.ownerId !== normalizedOwnerId) {
      throw new Error('Store owner does not match activation request.');
    }
    if (data.id !== normalizedStoreId || typeof data.name !== 'string' || !data.name.trim()) {
      throw new Error('Store canonical identity is incomplete.');
    }
    if (data.publicationStatus !== 'paused' && data.publicationStatus !== 'published') {
      throw new Error('Store publication status is invalid.');
    }
    // A registry-only record has not completed canonical commercial migration.
    // Publishing it now could expose a legacy storefront without verified setup.
    if (data.migrationStatus !== 'canonical') {
      throw new Error('Store commercial migration is not complete.');
    }
    const previous = data.firstMarketplaceActivatedAt;
    // A previously published store without a marker may be historical. Do not
    // silently grant it a fresh three-month promotion on the next publication.
    if (data.publicationStatus === 'published' && previous == null) {
      throw new Error('Published store has no first activation record; manual reconciliation required.');
    }
    if (previous != null && !(previous instanceof Timestamp)) {
      throw new Error('Invalid existing activation marker; manual reconciliation required.');
    }
    const now = Timestamp.now();
    const firstActivation = previous instanceof Timestamp ? previous : now;
    transaction.update(reference, {
      publicationStatus: 'published',
      updatedAt: FieldValue.serverTimestamp(),
      ...(previous instanceof Timestamp ? {} : {
        firstMarketplaceActivatedAt: firstActivation,
        firstMarketplaceActivationRecordedAt: FieldValue.serverTimestamp(),
      }),
    });
    return {
      firstActivatedAt: firstActivation.toDate().toISOString(),
      newlyActivated: !(previous instanceof Timestamp),
    };
  });
};
