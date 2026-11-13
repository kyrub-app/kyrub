import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';

import { createHash } from 'node:crypto';

const ROOT = 'kyrub_admin/control_plane';
const validUid = (value: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(value);

/**
 * Idempotent initial Free eligibility for the authenticated "Criar minha loja"
 * action. Never writes a plan when a paid entitlement or paid plan already exists.
 * Canonical creation and activation happen here; marketplace publication is separate.
 */
export async function ensureFreePlanForStoreCreation(authorization: string): Promise<{
  plan: 'free' | 'pro' | 'business';
  created: boolean;
  canonicalStoreId: string;
}> {
  const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim();
  if (!token) throw Error('FREE_STORE_AUTH_REQUIRED');
  const actor = await verifyFirebaseIdToken(token);
  if (!validUid(actor.uid)) throw Error('FREE_STORE_INVALID_USER');
  const uid = actor.uid;
  const privateRef = adminDb.doc(`users/${uid}/stores/${uid}`);
  const entitlementRef = adminDb.doc(`${ROOT}/store_entitlements/${uid}`);
  const subscriptionRef = adminDb.doc(`${ROOT}/store_subscriptions/${uid}`);
  const provisioned = await adminDb.runTransaction(async tx => {
    const [privateDoc, entitlementDoc, subscriptionDoc] = await Promise.all([
      tx.get(privateRef), tx.get(entitlementRef), tx.get(subscriptionRef),
    ]);
    const entitlement = entitlementDoc.data();
    const current = privateDoc.data();
    const subscription = subscriptionDoc.data();
    const paid = (plan: unknown): plan is 'pro' | 'business' =>
      plan === 'pro' || plan === 'business';
    const expiry = entitlement?.benefitEndsAt;
    const expiryMillis = expiry?.toDate?.() instanceof Date
      ? expiry.toDate().getTime()
      : typeof expiry === 'string' ? Date.parse(expiry) : NaN;
    const paidEntitlement = entitlement?.status === 'active' && paid(entitlement.plan) &&
      (!expiry || (Number.isFinite(expiryMillis) && expiryMillis > Date.now()));
    if (paidEntitlement) {
      if (!privateDoc.exists) {
        tx.create(privateRef, {
          id: uid, ownerId: uid, plan: entitlement.plan, status: 'closed',
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else if (current?.plan !== entitlement.plan) {
        tx.set(privateRef, { plan: entitlement.plan, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
      return { plan: entitlement.plan as 'pro' | 'business', created: !privateDoc.exists };
    }
    // A stale paid mirror, an expired benefit, or an unknown active grant
    // requires authoritative reconciliation. Never silently downgrade it.
    if (paid(current?.plan) || paid(subscription?.plan) || paid(entitlement?.plan) ||
        (entitlement?.status === 'active' && entitlement?.source !== 'free')) {
      throw Error('FREE_STORE_ENTITLEMENT_RECONCILIATION_REQUIRED');
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
  const canonicalStoreId = await activateStoreAfterProvisioning(uid, provisioned.plan);
  // The activation marker is persisted before attempting paid pre-store
  // reconciliation. Retries reuse that marker and cannot issue another charge.
  const activated = await adminDb.doc(`stores/${canonicalStoreId}`).get();
  const marker = activated.get('activatedAt');
  const activatedAt = typeof marker === 'string' ? marker : marker?.toDate?.()?.toISOString();
  if (!activatedAt || !Number.isFinite(Date.parse(activatedAt))) {
    throw Error('STORE_ACTIVATION_TIMESTAMP_UNAVAILABLE');
  }
  const { activatePendingOfficialPlanForStore } = await import('../payments/officialPlanPixCheckout.js');
  await activatePendingOfficialPlanForStore({ buyerUid: uid, canonicalStoreId, activatedAt });
  // Pending pre-store Pix may have upgraded Free to Pro/Business during
  // reconciliation. Return the committed plan, not the earlier snapshot.
  const finalStore = await adminDb.doc(`stores/${canonicalStoreId}`).get();
  const finalPlan = finalStore.get('plan');
  if (finalPlan !== 'free' && finalPlan !== 'pro' && finalPlan !== 'business') {
    throw Error('STORE_ACTIVATION_INVALID_PLAN');
  }
  // Reward processing is best-effort and idempotent. An unpublished or absent
  // challenge must never prevent store activation. A later authenticated retry
  // of this command can process the persisted first-store event.
  try {
    const { awardFirstStoreChallengeForCanonicalStore } =
      await import('../gamification/firstStoreChallengeAwardService.js');
    await awardFirstStoreChallengeForCanonicalStore(adminDb, { userId: uid, canonicalStoreId });
  } catch (error) {
    console.error('FIRST_STORE_CHALLENGE_AWARD_DEFERRED', {
      userId: uid, canonicalStoreId,
      code: error instanceof Error ? error.message : 'UNKNOWN',
    });
  }
  return { ...provisioned, plan: finalPlan, canonicalStoreId };
}

/**
 * The user's authenticated Create my store click is the activation command.
 * Reuse a unique existing canonical store, or create one deterministically.
 * Never infer activation from navigation, publication, or catalog repair.
 */
async function activateStoreAfterProvisioning(uid: string, plan: 'free' | 'pro' | 'business'): Promise<string> {
  const privateRef = adminDb.doc(`users/${uid}/stores/${uid}`);
  const ownerStores = await adminDb.collection('stores').where('ownerId', '==', uid).get();
  const privateSnapshot = await privateRef.get();
  const linked = privateSnapshot.get('canonicalStoreId');
  if (linked != null && (typeof linked !== 'string' || !validUid(linked))) {
    throw Error('STORE_ACTIVATION_IDENTITY_CONFLICT');
  }
  if (ownerStores.docs.length > 1) throw Error('STORE_ACTIVATION_IDENTITY_CONFLICT');
  const existing = ownerStores.docs[0];
  if (existing && linked && linked !== existing.id) throw Error('STORE_ACTIVATION_IDENTITY_CONFLICT');
  if (existing && existing.get('legacyTenantId') && existing.get('legacyTenantId') !== uid) {
    throw Error('STORE_ACTIVATION_IDENTITY_CONFLICT');
  }
  if (linked && !existing) throw Error('STORE_ACTIVATION_IDENTITY_CONFLICT');
  const canonicalId = existing?.id ??
    `store-${createHash('sha256').update(uid).digest('hex').slice(0, 24)}`;
  const canonicalRef = adminDb.doc(`stores/${canonicalId}`);
  const firstStoreEventRef = adminDb.doc(`users/${uid}/verifiedStoreEvents/first_store_created`);
  await adminDb.runTransaction(async tx => {
    const [personal, canonical, firstStoreEvent] = await Promise.all([
      tx.get(privateRef), tx.get(canonicalRef), tx.get(firstStoreEventRef),
    ]);
    if (!personal.exists || personal.get('ownerId') !== uid ||
        (personal.get('canonicalStoreId') && personal.get('canonicalStoreId') !== canonicalId) ||
        (canonical.exists && (canonical.get('ownerId') !== uid ||
          (canonical.get('legacyTenantId') && canonical.get('legacyTenantId') !== uid)))) {
      throw Error('STORE_ACTIVATION_IDENTITY_CONFLICT');
    }
    // Never relabel an existing paid canonical store as Free or return a
    // mismatched plan when its private entitlement mirror is stale.
    const canonicalPlan = canonical.get('plan');
    if (canonical.exists && canonicalPlan !== plan) {
      throw Error('STORE_ACTIVATION_PLAN_RECONCILIATION_REQUIRED');
    }
    const previous = canonical.get('activatedAt');
    if (previous != null) {
      const date = typeof previous === 'string' ? new Date(previous) : previous?.toDate?.();
      if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
        throw Error('STORE_ACTIVATION_INVALID_EXISTING_MARKER');
      }
    }
    if (!canonical.exists && ownerStores.empty && firstStoreEvent.exists) {
      throw Error('STORE_ACTIVATION_FIRST_STORE_EVENT_CONFLICT');
    }
    if (!canonical.exists) {
      tx.create(canonicalRef, {
        id: canonicalId, ownerId: uid, legacyTenantId: uid,
        name: 'Minha loja', plan, publicationStatus: 'paused',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        activatedAt: FieldValue.serverTimestamp(),
        // Only a newly created canonical store with no prior owned store qualifies.
        firstStoreCreationVerified: ownerStores.empty,
      });
    } else if (previous == null) {
      tx.update(canonicalRef, { activatedAt: FieldValue.serverTimestamp() });
    }
    // Persist an immutable server-only event with canonical creation. This is
    // not a reward write and cannot block store creation on ledger migration.
    if (!canonical.exists && ownerStores.empty) {
      tx.create(firstStoreEventRef, {
        id: 'first_store_created', userId: uid, storeId: canonicalId,
        challengeId: 'first_store_created',
        createdAt: FieldValue.serverTimestamp(), status: 'pending',
      });
    }
    tx.set(privateRef, {
      canonicalStoreId: canonicalId,
      canonicalStoreLinkedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  return canonicalId;
}
