import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';

/**
 * Server-only first commercial activation marker.
 *
 * Must be called only after a verified successful store publication, never on
 * draft creation, profile edits, preview publication or account registration.
 * Repeated activation calls preserve the original timestamp atomically.
 */
export const recordFirstMarketplaceStoreActivation = async (
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
    if (data.publicationStatus !== 'published') {
      throw new Error('Store has not been published.');
    }
    const previous = data.firstMarketplaceActivatedAt;
    if (previous instanceof Timestamp) {
      return { firstActivatedAt: previous.toDate().toISOString(), newlyActivated: false };
    }
    if (previous !== undefined && previous !== null) {
      throw new Error('Invalid existing activation marker; manual reconciliation required.');
    }
    const now = Timestamp.now();
    transaction.update(reference, {
      firstMarketplaceActivatedAt: now,
      firstMarketplaceActivationRecordedAt: FieldValue.serverTimestamp(),
    });
    return { firstActivatedAt: now.toDate().toISOString(), newlyActivated: true };
  });
};

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
    const previous = data.firstMarketplaceActivatedAt;
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
