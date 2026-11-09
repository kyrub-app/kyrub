import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';

const ROOT = 'kyrub_admin/control_plane';
const validUid = (value: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(value);

/**
 * Idempotent initial Free eligibility for the authenticated "Criar minha loja"
 * action. Never writes a plan when a paid entitlement or paid plan already exists.
 * Store publication and canonical-store creation are separate operations.
 */
export async function ensureFreePlanForStoreCreation(authorization: string): Promise<{
  plan: 'free' | 'pro' | 'business';
  created: boolean;
}> {
  const token = /^Bearer\\s+(.+)$/i.exec(authorization)?.[1]?.trim();
  if (!token) throw Error('FREE_STORE_AUTH_REQUIRED');
  const actor = await verifyFirebaseIdToken(token);
  if (!validUid(actor.uid)) throw Error('FREE_STORE_INVALID_USER');
  const uid = actor.uid;
  const privateRef = adminDb.doc(`users/${uid}/stores/${uid}`);
  const entitlementRef = adminDb.doc(`${ROOT}/store_entitlements/${uid}`);
  const subscriptionRef = adminDb.doc(`${ROOT}/store_subscriptions/${uid}`);
  return adminDb.runTransaction(async tx => {
    const [privateDoc, entitlementDoc, subscriptionDoc] = await Promise.all([
      tx.get(privateRef), tx.get(entitlementRef), tx.get(subscriptionRef),
    ]);
    const entitlement = entitlementDoc.data();
    const current = privateDoc.data();
    const subscription = subscriptionDoc.data();
    const paidPlan = [entitlement?.plan, current?.plan, subscription?.plan]
      .find(plan => plan === 'pro' || plan === 'business') as 'pro' | 'business' | undefined;
    if (paidPlan) return { plan: paidPlan, created: false };
    if (entitlement?.status === 'active' && entitlement?.source !== 'free') {
      // Never overwrite an unknown active grant with Free.
      return { plan: 'free' as const, created: false };
    }
    if (privateDoc.exists) {
      if (current?.plan === 'free') return { plan: 'free' as const, created: false };
      tx.set(privateRef, { plan: 'free', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { plan: 'free' as const, created: false };
    }
    tx.create(privateRef, {
      id: uid, ownerId: uid, plan: 'free', status: 'closed',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { plan: 'free' as const, created: true };
  });
}
