import { randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  KYRUB_BOOTSTRAP_PLAN_CATALOG,
  normalizeKyrubCouponCode,
  isValidKyrubCouponCode,
  type KyrubCouponCampaign,
  type KyrubCouponDurationType,
  type KyrubStoreEntitlement,
} from '../../shared/kyrubPlanManagement.js';
import {
  KYRUB_COMMERCIAL_PLAN_BILLING_AVAILABLE,
  type KyrubCommercialPlanId,
} from '../../shared/kyrubCommercialPlans.js';
import { authenticateConsultantRequest } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';
import { authorizeOperationsHealth } from './operationsHealthRouter.js';
import { PlanManagementError, mapPlanManagementError } from './planManagementService.js';

const ROOT = 'kyrub_admin/control_plane';
const COUPON_COLLECTION = `${ROOT}/coupon_campaigns`;
const ENTITLEMENT_COLLECTION = `${ROOT}/store_entitlements`;
const REDEMPTION_COLLECTION = `${ROOT}/coupon_redemptions`;
const PLAN_CATALOG_COLLECTION = `${ROOT}/plan_catalog`;
const AUDIT_COLLECTION = `${ROOT}/audit_logs`;

const rank: Record<KyrubCommercialPlanId, number> = {
  free: 0,
  pro: 1,
  business: 2,
};

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const integer = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) ? value : null;

const iso = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === 'object' && 'toDate' in value) {
    try {
      return (value as { toDate(): Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
};

const safeUid = (value: unknown): string => {
  const uid = clean(value);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(uid)) {
    throw new PlanManagementError(400, 'INVALID_TARGET_USER', 'Informe um UID de loja válido.');
  }
  return uid;
};

const safePaidPlan = (value: unknown): 'pro' | 'business' => {
  if (value === 'pro' || value === 'business') return value;
  throw new PlanManagementError(400, 'INVALID_TARGET_PLAN', 'Escolha Pro ou Business.');
};

const normalizeCurrentPlan = (value: unknown): KyrubCommercialPlanId =>
  value === 'business' || value === 'pro' ? value : 'free';

const findCanonicalStore = async (ownerId: string): Promise<string | null> => {
  const snapshot = await adminDb.collection('stores').where('ownerId', '==', ownerId).get();
  if (snapshot.size > 1) {
    throw new PlanManagementError(
      409,
      'STORE_IDENTITY_CONFLICT',
      'Mais de uma loja canônica foi encontrada para este proprietário.'
    );
  }
  return snapshot.empty ? null : snapshot.docs[0].id;
};

const parseCampaign = (value: Record<string, unknown>): KyrubCouponCampaign => {
  const code = normalizeKyrubCouponCode(clean(value.code));
  if (!isValidKyrubCouponCode(code)) {
    throw new PlanManagementError(409, 'INVALID_CAMPAIGN_STATE', 'A campanha possui código inválido.');
  }
  const targetPlan = safePaidPlan(value.targetPlan);
  const discountType = value.discountType === 'fixed_brl' ? 'fixed_brl' : 'percent';
  const durationType: KyrubCouponDurationType =
    value.durationType === 'until' || value.durationType === 'indefinite'
      ? value.durationType
      : 'months';
  return {
    schemaVersion: 1,
    id: clean(value.id) || code,
    code,
    label: clean(value.label),
    targetPlan,
    targetPlanVersion: value.targetPlanVersion === null
      ? null
      : integer(value.targetPlanVersion),
    discountType,
    discountValue: typeof value.discountValue === 'number' ? value.discountValue : 0,
    durationType,
    durationMonths: value.durationMonths === null ? null : integer(value.durationMonths),
    benefitEndsAt: iso(value.benefitEndsAt),
    redeemStartsAt: iso(value.redeemStartsAt),
    redeemEndsAt: iso(value.redeemEndsAt),
    maxRedemptions: value.maxRedemptions === null ? null : integer(value.maxRedemptions),
    maxRedemptionsPerStore: integer(value.maxRedemptionsPerStore) ?? 1,
    redemptionCount: integer(value.redemptionCount) ?? 0,
    status: value.status === 'active' || value.status === 'paused' || value.status === 'retired'
      ? value.status
      : 'draft',
    createdBy: clean(value.createdBy),
    createdAt: iso(value.createdAt),
    updatedBy: clean(value.updatedBy),
    updatedAt: iso(value.updatedAt),
  };
};

const planVersionFromCatalog = (
  planId: KyrubCommercialPlanId,
  value: Record<string, unknown> | undefined
): number =>
  integer(value?.activeVersion) ?? KYRUB_BOOTSTRAP_PLAN_CATALOG[planId].version;

const calculateBenefitEnd = (
  campaign: Pick<KyrubCouponCampaign, 'durationType' | 'durationMonths' | 'benefitEndsAt'>,
  now: Date,
  previousEnd: string | null = null
): string | null => {
  if (campaign.durationType === 'indefinite') return null;
  if (campaign.durationType === 'until') return campaign.benefitEndsAt;
  const months = campaign.durationMonths ?? 1;
  const previousDate = previousEnd ? new Date(previousEnd) : null;
  const base = previousDate && previousDate.getTime() > now.getTime()
    ? previousDate
    : now;
  const end = new Date(base);
  end.setUTCMonth(end.getUTCMonth() + months);
  return end.toISOString();
};

const assertExecutableDiscount = (campaign: KyrubCouponCampaign): void => {
  if (KYRUB_COMMERCIAL_PLAN_BILLING_AVAILABLE) return;
  if (campaign.discountType === 'percent' && campaign.discountValue === 100) return;
  throw new PlanManagementError(
    409,
    'BILLING_REQUIRED_FOR_PARTIAL_DISCOUNT',
    'Este cupom possui desconto parcial. Ele pode ser preparado no beta, mas só poderá ser resgatado quando o billing estiver conectado.'
  );
};

const writeEntitlementMirrors = (
  transaction: FirebaseFirestore.Transaction,
  ownerId: string,
  canonicalStoreId: string | null,
  plan: KyrubCommercialPlanId,
  now: FirebaseFirestore.FieldValue
): void => {
  transaction.set(
    adminDb.doc(`users/${ownerId}/stores/${ownerId}`),
    { plan, updatedAt: now },
    { merge: true }
  );
  transaction.set(
    adminDb.doc(`tenants/${ownerId}`),
    { id: ownerId, ownerId, plan, updatedAt: now },
    { merge: true }
  );
  if (canonicalStoreId) {
    transaction.set(
      adminDb.doc(`stores/${canonicalStoreId}`),
      { plan, legacyTenantId: ownerId, updatedAt: now },
      { merge: true }
    );
  }
};

const parseExistingEntitlementEnd = (value: Record<string, unknown> | undefined): string | null =>
  iso(value?.benefitEndsAt ?? value?.expiresAt);

export type CouponRedemptionResult = {
  status: 'redeemed';
  code: string;
  storeId: string;
  plan: 'pro' | 'business';
  planVersion: number;
  benefitEndsAt: string | null;
  discountType: 'percent' | 'fixed_brl';
  discountValue: number;
};

export const redeemCouponForOwnStore = async (
  authorization: string,
  rawCode: unknown
): Promise<CouponRedemptionResult> => {
  const user = await authenticateConsultantRequest(authorization);
  const ownerId = safeUid(user.uid);
  const code = normalizeKyrubCouponCode(clean(rawCode));
  if (!isValidKyrubCouponCode(code)) {
    throw new PlanManagementError(400, 'INVALID_COUPON_CODE', 'Informe um cupom Kyrub válido.');
  }
  const canonicalStoreId = await findCanonicalStore(ownerId);
  const privateStoreReference = adminDb.doc(`users/${ownerId}/stores/${ownerId}`);
  const campaignReference = adminDb.doc(`${COUPON_COLLECTION}/${code}`);
  const entitlementReference = adminDb.doc(`${ENTITLEMENT_COLLECTION}/${ownerId}`);
  const redemptionReference = adminDb.doc(`${REDEMPTION_COLLECTION}/${code}_${ownerId}`);
  const auditReference = adminDb.doc(`${AUDIT_COLLECTION}/${randomUUID().replaceAll('-', '_')}`);
  const nowDate = new Date();
  let result!: CouponRedemptionResult;

  await adminDb.runTransaction(async transaction => {
    const [privateStoreSnapshot, campaignSnapshot, entitlementSnapshot, redemptionSnapshot] =
      await Promise.all([
        transaction.get(privateStoreReference),
        transaction.get(campaignReference),
        transaction.get(entitlementReference),
        transaction.get(redemptionReference),
      ]);
    if (!privateStoreSnapshot.exists) {
      throw new PlanManagementError(404, 'STORE_NOT_FOUND', 'Ative sua Loja Kyrub antes de resgatar um cupom de plano.');
    }
    const storeData = privateStoreSnapshot.data() as Record<string, unknown>;
    if (clean(storeData.id) !== ownerId || clean(storeData.ownerId) !== ownerId) {
      throw new PlanManagementError(409, 'STORE_OWNERSHIP_CONFLICT', 'A identidade da loja não corresponde à sua conta.');
    }
    if (!campaignSnapshot.exists) {
      throw new PlanManagementError(404, 'COUPON_NOT_FOUND', 'Este cupom não existe.');
    }
    const campaign = parseCampaign(campaignSnapshot.data() as Record<string, unknown>);
    if (campaign.status !== 'active') {
      throw new PlanManagementError(409, 'COUPON_NOT_ACTIVE', 'Este cupom não está ativo para resgate.');
    }
    const nowMs = nowDate.getTime();
    if (campaign.redeemStartsAt && new Date(campaign.redeemStartsAt).getTime() > nowMs) {
      throw new PlanManagementError(409, 'COUPON_NOT_STARTED', 'Este cupom ainda não iniciou o período de resgate.');
    }
    if (campaign.redeemEndsAt && new Date(campaign.redeemEndsAt).getTime() < nowMs) {
      throw new PlanManagementError(409, 'COUPON_EXPIRED', 'O período de resgate deste cupom terminou.');
    }
    if (campaign.maxRedemptions !== null && campaign.redemptionCount >= campaign.maxRedemptions) {
      throw new PlanManagementError(409, 'COUPON_LIMIT_REACHED', 'Este cupom atingiu o limite total de resgates.');
    }
    const storeRedemptionCount = redemptionSnapshot.exists
      ? integer(redemptionSnapshot.data()?.count) ?? 0
      : 0;
    if (storeRedemptionCount >= campaign.maxRedemptionsPerStore) {
      throw new PlanManagementError(409, 'COUPON_ALREADY_REDEEMED', 'Esta loja já atingiu o limite de uso deste cupom.');
    }
    assertExecutableDiscount(campaign);

    const currentPlan = normalizeCurrentPlan(storeData.plan);
    if (rank[currentPlan] > rank[campaign.targetPlan]) {
      throw new PlanManagementError(
        409,
        'PLAN_DOWNGRADE_BLOCKED',
        `Sua loja já possui ${currentPlan === 'business' ? 'Business' : 'Pro'} e este cupom não pode reduzir o plano.`
      );
    }

    const catalogReference = adminDb.doc(`${PLAN_CATALOG_COLLECTION}/${campaign.targetPlan}`);
    const catalogSnapshot = await transaction.get(catalogReference);
    const planVersion = campaign.targetPlanVersion
      ?? planVersionFromCatalog(
        campaign.targetPlan,
        catalogSnapshot.exists ? catalogSnapshot.data() as Record<string, unknown> : undefined
      );
    const entitlementData = entitlementSnapshot.exists
      ? entitlementSnapshot.data() as Record<string, unknown>
      : undefined;
    const previousEnd =
      entitlementData?.campaignId === campaign.id
        ? parseExistingEntitlementEnd(entitlementData)
        : null;
    const benefitEndsAt = calculateBenefitEnd(campaign, nowDate, previousEnd);
    const now = FieldValue.serverTimestamp();

    writeEntitlementMirrors(transaction, ownerId, canonicalStoreId, campaign.targetPlan, now);
    transaction.set(entitlementReference, {
      schemaVersion: 2,
      storeId: ownerId,
      ownerId,
      plan: campaign.targetPlan,
      planVersion,
      source: 'promotion',
      status: 'active',
      campaignId: campaign.id,
      couponCode: campaign.code,
      discountType: campaign.discountType,
      discountValue: campaign.discountValue,
      benefitStartsAt: now,
      benefitEndsAt,
      grantedBy: null,
      updatedAt: now,
    });
    transaction.set(redemptionReference, {
      schemaVersion: 1,
      campaignId: campaign.id,
      couponCode: campaign.code,
      storeId: ownerId,
      ownerId,
      count: storeRedemptionCount + 1,
      lastRedeemedAt: now,
      createdAt: redemptionSnapshot.exists
        ? redemptionSnapshot.data()?.createdAt ?? now
        : now,
    });
    transaction.set(campaignReference, {
      redemptionCount: campaign.redemptionCount + 1,
      updatedAt: now,
    }, { merge: true });
    transaction.set(auditReference, {
      id: auditReference.id,
      action: 'store.coupon.redeemed',
      actorId: ownerId,
      actorRole: 'store_owner',
      targetType: 'store',
      targetId: ownerId,
      couponCode: campaign.code,
      campaignId: campaign.id,
      previousPlan: currentPlan,
      nextPlan: campaign.targetPlan,
      source: 'server',
      createdAt: now,
    });

    result = {
      status: 'redeemed',
      code: campaign.code,
      storeId: ownerId,
      plan: campaign.targetPlan,
      planVersion,
      benefitEndsAt,
      discountType: campaign.discountType,
      discountValue: campaign.discountValue,
    };
  });

  return result;
};

export type DirectComplimentaryGrantInput = {
  targetUserId: string;
  targetPlan: 'pro' | 'business';
  durationType: KyrubCouponDurationType;
  durationMonths: number | null;
  benefitEndsAt: string | null;
  campaignId: string | null;
};

const normalizeDirectGrant = (raw: unknown): DirectComplimentaryGrantInput => {
  const input = record(raw);
  const targetUserId = safeUid(input.targetUserId);
  const targetPlan = safePaidPlan(input.targetPlan);
  const durationType: KyrubCouponDurationType =
    input.durationType === 'months' || input.durationType === 'until'
      ? input.durationType
      : 'indefinite';
  const durationMonths = durationType === 'months' ? integer(input.durationMonths) : null;
  if (durationType === 'months' && (durationMonths === null || durationMonths < 1 || durationMonths > 120)) {
    throw new PlanManagementError(400, 'INVALID_DURATION_MONTHS', 'Informe de 1 a 120 meses de cortesia.');
  }
  const benefitEndsAt = durationType === 'until' ? iso(input.benefitEndsAt) : null;
  if (durationType === 'until' && !benefitEndsAt) {
    throw new PlanManagementError(400, 'BENEFIT_END_REQUIRED', 'Informe até quando a cortesia será válida.');
  }
  const campaignId = clean(input.campaignId).slice(0, 80) || null;
  return {
    targetUserId,
    targetPlan,
    durationType,
    durationMonths,
    benefitEndsAt,
    campaignId,
  };
};

export type DirectComplimentaryGrantResult = {
  status: 'granted';
  storeId: string;
  plan: 'pro' | 'business';
  planVersion: number;
  source: 'admin_grant';
  benefitEndsAt: string | null;
};

export const grantComplimentaryPlanByAdmin = async (
  authorization: string,
  rawInput: unknown
): Promise<DirectComplimentaryGrantResult> => {
  const admin = await authorizeOperationsHealth(authorization);
  if (admin.role !== 'super_admin') {
    throw new PlanManagementError(403, 'ENTITLEMENT_GRANT_FORBIDDEN', 'Somente Super Admin pode conceder cortesia de plano.');
  }
  const input = normalizeDirectGrant(rawInput);
  const canonicalStoreId = await findCanonicalStore(input.targetUserId);
  const privateStoreReference = adminDb.doc(`users/${input.targetUserId}/stores/${input.targetUserId}`);
  const entitlementReference = adminDb.doc(`${ENTITLEMENT_COLLECTION}/${input.targetUserId}`);
  const catalogReference = adminDb.doc(`${PLAN_CATALOG_COLLECTION}/${input.targetPlan}`);
  const auditReference = adminDb.doc(`${AUDIT_COLLECTION}/${randomUUID().replaceAll('-', '_')}`);
  let result!: DirectComplimentaryGrantResult;

  await adminDb.runTransaction(async transaction => {
    const [storeSnapshot, catalogSnapshot] = await Promise.all([
      transaction.get(privateStoreReference),
      transaction.get(catalogReference),
    ]);
    if (!storeSnapshot.exists) {
      throw new PlanManagementError(404, 'STORE_NOT_FOUND', 'A Loja Kyrub privada deste usuário ainda não existe.');
    }
    const storeData = storeSnapshot.data() as Record<string, unknown>;
    if (
      clean(storeData.id) !== input.targetUserId ||
      clean(storeData.ownerId) !== input.targetUserId
    ) {
      throw new PlanManagementError(409, 'STORE_OWNERSHIP_CONFLICT', 'A identidade da loja não corresponde ao usuário informado.');
    }
    const currentPlan = normalizeCurrentPlan(storeData.plan);
    if (rank[currentPlan] > rank[input.targetPlan]) {
      throw new PlanManagementError(409, 'PLAN_DOWNGRADE_BLOCKED', 'A cortesia escolhida não pode rebaixar o plano atual da loja.');
    }
    const planVersion = planVersionFromCatalog(
      input.targetPlan,
      catalogSnapshot.exists ? catalogSnapshot.data() as Record<string, unknown> : undefined
    );
    const benefitEndsAt = calculateBenefitEnd(input, new Date());
    const now = FieldValue.serverTimestamp();
    writeEntitlementMirrors(
      transaction,
      input.targetUserId,
      canonicalStoreId,
      input.targetPlan,
      now
    );
    transaction.set(entitlementReference, {
      schemaVersion: 2,
      storeId: input.targetUserId,
      ownerId: input.targetUserId,
      plan: input.targetPlan,
      planVersion,
      source: 'admin_grant',
      status: 'active',
      campaignId: input.campaignId,
      couponCode: null,
      discountType: 'percent',
      discountValue: 100,
      benefitStartsAt: now,
      benefitEndsAt,
      grantedBy: admin.uid,
      grantedByRole: admin.role,
      updatedAt: now,
    });
    transaction.set(auditReference, {
      id: auditReference.id,
      action: 'admin.store_plan.complimentary.granted',
      actorId: admin.uid,
      actorRole: admin.role,
      targetType: 'store',
      targetId: input.targetUserId,
      previousPlan: currentPlan,
      nextPlan: input.targetPlan,
      campaignId: input.campaignId,
      source: 'server',
      createdAt: now,
    });
    result = {
      status: 'granted',
      storeId: input.targetUserId,
      plan: input.targetPlan,
      planVersion,
      source: 'admin_grant',
      benefitEndsAt,
    };
  });

  return result;
};

export const mapStoreEntitlementError = mapPlanManagementError;

export const parseStoreEntitlementForResponse = (
  value: Record<string, unknown>
): KyrubStoreEntitlement => ({
  schemaVersion: 2,
  storeId: clean(value.storeId),
  ownerId: clean(value.ownerId),
  plan: normalizeCurrentPlan(value.plan),
  planVersion: integer(value.planVersion) ?? 1,
  source:
    value.source === 'subscription' || value.source === 'promotion' || value.source === 'admin_grant'
      ? value.source
      : 'free_default',
  status: value.status === 'expired' || value.status === 'revoked' ? value.status : 'active',
  campaignId: clean(value.campaignId) || null,
  couponCode: clean(value.couponCode) || null,
  discountType: value.discountType === 'percent' || value.discountType === 'fixed_brl'
    ? value.discountType
    : null,
  discountValue: typeof value.discountValue === 'number' ? value.discountValue : null,
  benefitStartsAt: iso(value.benefitStartsAt),
  benefitEndsAt: iso(value.benefitEndsAt),
  grantedBy: clean(value.grantedBy) || null,
  updatedAt: iso(value.updatedAt),
});
