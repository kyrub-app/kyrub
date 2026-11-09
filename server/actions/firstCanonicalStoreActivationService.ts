import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';

/**
 * Records an explicit first activation, never inferred from store creation,
 * marketplace publication, or a canonical-link repair.
 *
 * This service is intentionally not exposed through a route until the
 * authenticated "Ativar loja" transition is connected and emulator-tested.
 */
export async function recordFirstCanonicalStoreActivation(input: {
  authorization: string;
  canonicalStoreId: string;
}): Promise<{ activatedAt: string; newlyActivated: boolean }> {
  const token = /^Bearer\s+(.+)$/i.exec(input.authorization)?.[1]?.trim();
  if (!token) throw Error('STORE_ACTIVATION_AUTH_REQUIRED');
  const actor = await verifyFirebaseIdToken(token);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.canonicalStoreId)) {
    throw Error('STORE_ACTIVATION_INVALID_STORE');
  }
  const canonical = adminDb.doc(`stores/${input.canonicalStoreId}`);
  const privateStore = adminDb.doc(`users/${actor.uid}/stores/${actor.uid}`);
  return adminDb.runTransaction(async tx => {
    const [store, personal] = await Promise.all([tx.get(canonical), tx.get(privateStore)]);
    if (!store.exists || !personal.exists ||
        store.get('ownerId') !== actor.uid ||
        personal.get('canonicalStoreId') !== input.canonicalStoreId ||
        (store.get('legacyTenantId') && store.get('legacyTenantId') !== actor.uid)) {
      throw Error('STORE_ACTIVATION_IDENTITY_CONFLICT');
    }
    const existing = store.get('activatedAt');
    if (existing !== undefined && existing !== null) {
      const date = typeof existing === 'string' ? new Date(existing) : existing?.toDate?.();
      if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
        throw Error('STORE_ACTIVATION_INVALID_EXISTING_MARKER');
      }
      return { activatedAt: date.toISOString(), newlyActivated: false };
    }
    // A server-side timestamp is committed atomically with the transition.
    // Resolve the exact timestamp after commit before processing subscriptions.
    tx.update(canonical, { activatedAt: FieldValue.serverTimestamp() });
    return { activatedAt: '', newlyActivated: true };
  }).then(async result => {
    if (!result.newlyActivated) return result;
    const committed = await canonical.get();
    const timestamp = committed.get('activatedAt')?.toDate?.();
    if (!(timestamp instanceof Date) || !Number.isFinite(timestamp.getTime())) {
      throw Error('STORE_ACTIVATION_TIMESTAMP_UNAVAILABLE');
    }
    return { activatedAt: timestamp.toISOString(), newlyActivated: true };
  });
}
