import { randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { KyrubCommercialPlanId } from '../../shared/kyrubCommercialPlans.js';
import { authenticateConsultantRequest } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';
import { authorizeOperationsHealth } from './operationsHealthRouter.js';
import { PlanManagementError } from './planManagementService.js';
import {
  grantComplimentaryPlanByAdmin,
  redeemCouponForOwnStore,
  type CouponRedemptionResult,
  type DirectComplimentaryGrantResult,
} from './storeEntitlementService.js';

const ROOT = 'kyrub_admin/control_plane';
const ENTITLEMENT_COLLECTION = `${ROOT}/store_entitlements`;
const BASELINE_COLLECTION = `${ROOT}/store_entitlement_baselines`;
const AUDIT_COLLECTION = `${ROOT}/audit_logs`;

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const safeUid = (value: unknown): string => {
  const uid = clean(value);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(uid)) {
    throw new PlanManagementError(
      400,
      'INVALID_TARGET_USER',
      'Informe um UID de loja válido.'
    );
  }
  return uid;
};

const plan = (value: unknown): KyrubCommercialPlanId =>
  value === 'business' || value === 'pro' ? value : 'free';

const timestampMillis = (value: unknown): number | null => {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === 'string') {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === 'object' && 'toDate' in value) {
    try {
      return (value as { toDate(): Date }).toDate().getTime();
    } catch {
      return null;
    }
  }
  return null;
};

const findCanonicalStore = async (ownerId: string): Promise<string | null> => {
  const snapshot = await adminDb
    .collection('stores')
    .where('ownerId', '==', ownerId)
    .get();
  if (snapshot.size > 1) {
    throw new PlanManagementError(
      409,
      'STORE_IDENTITY_CONFLICT',
      'Mais de uma loja canônica foi encontrada para este proprietário.'
    );
  }
  return snapshot.empty ? null : snapshot.docs[0].id;
};

const writePlanMirrors = (
  transaction: FirebaseFirestore.Transaction,
  ownerId: string,
  canonicalStoreId: string | null,
  nextPlan: KyrubCommercialPlanId,
  now: FirebaseFirestore.FieldValue
): void => {
  transaction.set(
    adminDb.doc(`users/${ownerId}/stores/${ownerId}`),
    { plan: nextPlan, updatedAt: now },
    { merge: true }
  );
  transaction.set(
    adminDb.doc(`tenants/${ownerId}`),
    { id: ownerId, ownerId, plan: nextPlan, updatedAt: now },
    { merge: true }
  );
  if (canonicalStoreId) {
    transaction.set(
      adminDb.doc(`stores/${canonicalStoreId}`),
      { plan: nextPlan, legacyTenantId: ownerId, updatedAt: now },
      { merge: true }
    );
  }
};

export type StoreEntitlementReconciliation = {
  status: 'none' | 'active' | 'expired';
  changed: boolean;
  plan: KyrubCommercialPlanId | null;
  benefitEndsAt: string | null;
};

export const reconcileStoreEntitlementForOwner = async (
  rawOwnerId: string,
  nowDate: Date = new Date()
): Promise<StoreEntitlementReconciliation> => {
  const ownerId = safeUid(rawOwnerId);
  const canonicalStoreId = await findCanonicalStore(ownerId);
  const privateStoreReference = adminDb.doc(`users/${ownerId}/stores/${ownerId}`);
  const entitlementReference = adminDb.doc(`${ENTITLEMENT_COLLECTION}/${ownerId}`);
  const baselineReference = adminDb.doc(`${BASELINE_COLLECTION}/${ownerId}`);
  const auditReference = adminDb.doc(
    `${AUDIT_COLLECTION}/${randomUUID().replaceAll('-', '_')}`
  );
  let result: StoreEntitlementReconciliation = {
    status: 'none',
    changed: false,
    plan: null,
    benefitEndsAt: null,
  };

  await adminDb.runTransaction(async transaction => {
    const [storeSnapshot, entitlementSnapshot, baselineSnapshot] =
      await Promise.all([
        transaction.get(privateStoreReference),
        transaction.get(entitlementReference),
        transaction.get(baselineReference),
      ]);

    if (!storeSnapshot.exists || !entitlementSnapshot.exists) {
      result = {
        status: 'none',
        changed: false,
        plan: storeSnapshot.exists
          ? plan(storeSnapshot.data()?.plan)
          : null,
        benefitEndsAt: null,
      };
      return;
    }

    const entitlement = entitlementSnapshot.data() as Record<string, unknown>;
    const currentPlan = plan(storeSnapshot.data()?.plan);
    const entitlementStatus = clean(entitlement.status) || 'active';
    const benefitEndsAtMs = timestampMillis(entitlement.benefitEndsAt);
    const benefitEndsAt = benefitEndsAtMs === null
      ? null
      : new Date(benefitEndsAtMs).toISOString();

    if (
      entitlementStatus !== 'active' ||
      benefitEndsAtMs === null ||
      benefitEndsAtMs > nowDate.getTime()
    ) {
      result = {
        status: entitlementStatus === 'active' ? 'active' : 'expired',
        changed: false,
        plan: currentPlan,
        benefitEndsAt,
      };
      return;
    }

    const fallbackPlan = baselineSnapshot.exists
      ? plan(baselineSnapshot.data()?.plan)
      : 'free';
    const now = FieldValue.serverTimestamp();
    writePlanMirrors(
      transaction,
      ownerId,
      canonicalStoreId,
      fallbackPlan,
      now
    );
    transaction.set(
      entitlementReference,
      {
        status: 'expired',
        expiredAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
    transaction.set(auditReference, {
      id: auditReference.id,
      action: 'store.entitlement.expired',
      actorId: 'kyrub_system',
      actorRole: 'system',
      targetType: 'store',
      targetId: ownerId,
      previousPlan: currentPlan,
      nextPlan: fallbackPlan,
      campaignId: clean(entitlement.campaignId) || null,
      couponCode: clean(entitlement.couponCode) || null,
      source: 'server',
      createdAt: now,
    });

    result = {
      status: 'expired',
      changed: true,
      plan: fallbackPlan,
      benefitEndsAt,
    };
  });

  return result;
};

const captureBaselineForNewBenefit = async (ownerId: string): Promise<void> => {
  const privateStoreReference = adminDb.doc(`users/${ownerId}/stores/${ownerId}`);
  const entitlementReference = adminDb.doc(`${ENTITLEMENT_COLLECTION}/${ownerId}`);
  const baselineReference = adminDb.doc(`${BASELINE_COLLECTION}/${ownerId}`);

  await adminDb.runTransaction(async transaction => {
    const [storeSnapshot, entitlementSnapshot] = await Promise.all([
      transaction.get(privateStoreReference),
      transaction.get(entitlementReference),
    ]);
    if (!storeSnapshot.exists) {
      throw new PlanManagementError(
        404,
        'STORE_NOT_FOUND',
        'Ative a Loja Kyrub antes de conceder um benefício de plano.'
      );
    }

    if (entitlementSnapshot.exists) {
      const existing = entitlementSnapshot.data() as Record<string, unknown>;
      const existingStatus = clean(existing.status) || 'active';
      const existingEnd = timestampMillis(existing.benefitEndsAt);
      if (
        existingStatus === 'active' &&
        (existingEnd === null || existingEnd > Date.now()) &&
        (existing.source === 'promotion' || existing.source === 'admin_grant')
      ) {
        throw new PlanManagementError(
          409,
          'ACTIVE_PROMOTIONAL_BENEFIT_EXISTS',
          'Esta loja já possui um benefício promocional ativo. Encerre ou aguarde esse benefício antes de aplicar outro.'
        );
      }
    }

    const now = FieldValue.serverTimestamp();
    transaction.set(baselineReference, {
      schemaVersion: 1,
      storeId: ownerId,
      ownerId,
      plan: plan(storeSnapshot.data()?.plan),
      capturedAt: now,
      updatedAt: now,
    });
  });
};

export const redeemCouponWithLifecycle = async (
  authorization: string,
  rawCode: unknown
): Promise<CouponRedemptionResult> => {
  const user = await authenticateConsultantRequest(authorization);
  const ownerId = safeUid(user.uid);
  await reconcileStoreEntitlementForOwner(ownerId);
  await captureBaselineForNewBenefit(ownerId);
  return redeemCouponForOwnStore(authorization, rawCode);
};

const targetUserIdFromGrant = (rawInput: unknown): string => {
  const input =
    rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
      ? rawInput as Record<string, unknown>
      : {};
  return safeUid(input.targetUserId);
};

export const grantComplimentaryPlanWithLifecycle = async (
  authorization: string,
  rawInput: unknown
): Promise<DirectComplimentaryGrantResult> => {
  const admin = await authorizeOperationsHealth(authorization);
  if (admin.role !== 'super_admin') {
    throw new PlanManagementError(
      403,
      'ENTITLEMENT_GRANT_FORBIDDEN',
      'Somente Super Admin pode conceder cortesia de plano.'
    );
  }
  const ownerId = targetUserIdFromGrant(rawInput);
  await reconcileStoreEntitlementForOwner(ownerId);
  await captureBaselineForNewBenefit(ownerId);
  return grantComplimentaryPlanByAdmin(authorization, rawInput);
};

export const reconcileStoreEntitlementFromAuthorization = async (
  authorization: string
): Promise<StoreEntitlementReconciliation> => {
  const user = await authenticateConsultantRequest(authorization);
  return reconcileStoreEntitlementForOwner(user.uid);
};
