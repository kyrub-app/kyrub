import { randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  KYRUB_BOOTSTRAP_PLAN_CATALOG,
  KYRUB_PLAN_FEATURES,
  isValidKyrubCouponCode,
  normalizeKyrubCouponCode,
  validateKyrubDiscount,
  type KyrubCouponCampaign,
  type KyrubCouponDiscountType,
  type KyrubCouponDurationType,
  type KyrubCouponStatus,
  type KyrubPlanCatalogEntry,
  type KyrubPlanFeatureId,
  type KyrubPlanFeatureStates,
  type KyrubPlanVersion,
} from '../../shared/kyrubPlanManagement.js';
import type { KyrubCommercialPlanId } from '../../shared/kyrubCommercialPlans.js';
import { adminDb } from '../firebaseAdmin.js';
import { authorizeOperationsHealth } from './operationsHealthRouter.js';

const CONTROL_PLANE_ROOT = 'kyrub_admin/control_plane';
const PLAN_CATALOG_COLLECTION = `${CONTROL_PLANE_ROOT}/plan_catalog`;
const PLAN_VERSIONS_COLLECTION = `${CONTROL_PLANE_ROOT}/plan_versions`;
const COUPON_COLLECTION = `${CONTROL_PLANE_ROOT}/coupon_campaigns`;
const AUDIT_COLLECTION = `${CONTROL_PLANE_ROOT}/audit_logs`;

const PLAN_IDS: readonly KyrubCommercialPlanId[] = ['free', 'pro', 'business'];
const COUPON_STATUSES: readonly KyrubCouponStatus[] = [
  'draft',
  'active',
  'paused',
  'retired',
];

export class PlanManagementError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'PlanManagementError';
  }
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const numberValue = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const integerValue = (value: unknown): number | null => {
  const parsed = numberValue(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
};

const nullableIso = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const timestampToIso = (value: unknown): string | null => {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value && typeof value === 'object' && 'toDate' in value) {
    try {
      return (value as { toDate(): Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  return nullableIso(value);
};

const safePlanId = (value: unknown): KyrubCommercialPlanId => {
  if (typeof value === 'string' && PLAN_IDS.includes(value as KyrubCommercialPlanId)) {
    return value as KyrubCommercialPlanId;
  }
  throw new PlanManagementError(400, 'INVALID_PLAN', 'Informe um plano Kyrub válido.');
};

const safeTargetPaidPlan = (
  value: unknown
): Exclude<KyrubCommercialPlanId, 'free'> => {
  const planId = safePlanId(value);
  if (planId === 'free') {
    throw new PlanManagementError(
      400,
      'COUPON_FREE_PLAN_NOT_ALLOWED',
      'Cupons promocionais devem apontar para Pro ou Business.'
    );
  }
  return planId;
};

const requireSuperAdmin = async (authorization: string) => {
  const admin = await authorizeOperationsHealth(authorization);
  if (admin.role !== 'super_admin') {
    throw new PlanManagementError(
      403,
      'PLAN_MANAGEMENT_FORBIDDEN',
      'Somente Super Admin pode administrar planos e cupons.'
    );
  }
  return admin;
};

const safeFeatureStates = (value: unknown): KyrubPlanFeatureStates => {
  const candidate = asRecord(value);
  const featureIds = KYRUB_PLAN_FEATURES.map(feature => feature.id);
  const result = {} as KyrubPlanFeatureStates;
  for (const featureId of featureIds) {
    if (typeof candidate[featureId] !== 'boolean') {
      throw new PlanManagementError(
        400,
        'INVALID_PLAN_FEATURES',
        `Defina explicitamente se “${featureId}” está ativo neste plano.`
      );
    }
    result[featureId] = candidate[featureId] as boolean;
  }
  return result;
};

const parsePlanVersion = (
  value: Record<string, unknown>,
  fallback: KyrubPlanVersion
): KyrubPlanVersion => {
  const planId = PLAN_IDS.includes(value.planId as KyrubCommercialPlanId)
    ? value.planId as KyrubCommercialPlanId
    : fallback.planId;
  const version = integerValue(value.version) ?? fallback.version;
  const monthlyPriceBRL = numberValue(value.monthlyPriceBRL) ?? fallback.monthlyPriceBRL;
  const rawCatalogLimit = value.activeCatalogLimit;
  const activeCatalogLimit = rawCatalogLimit === null
    ? null
    : integerValue(rawCatalogLimit) ?? fallback.activeCatalogLimit;
  const credits = integerValue(value.kyrubiaIntelligenceCredits)
    ?? fallback.kyrubiaIntelligenceCredits;
  const commission = numberValue(value.marketplaceOriginatedSaleCommissionPercent)
    ?? fallback.marketplaceOriginatedSaleCommissionPercent;
  const rawFeatures = asRecord(value.features);
  const features = { ...fallback.features };
  for (const feature of KYRUB_PLAN_FEATURES) {
    if (typeof rawFeatures[feature.id] === 'boolean') {
      features[feature.id] = rawFeatures[feature.id] as boolean;
    }
  }

  return {
    schemaVersion: 1,
    planId,
    version,
    status: value.status === 'retired' || value.status === 'draft' ? value.status : 'active',
    monthlyPriceBRL,
    activeCatalogLimit,
    kyrubiaIntelligenceCredits: credits,
    marketplaceOriginatedSaleCommissionPercent: commission,
    features,
    effectiveFrom: nullableIso(value.effectiveFrom),
    createdBy: clean(value.createdBy) || fallback.createdBy,
    createdAt: timestampToIso(value.createdAt),
  };
};

const currentCatalogEntry = async (
  planId: KyrubCommercialPlanId
): Promise<KyrubPlanCatalogEntry> => {
  const fallback = KYRUB_BOOTSTRAP_PLAN_CATALOG[planId];
  const snapshot = await adminDb.doc(`${PLAN_CATALOG_COLLECTION}/${planId}`).get();
  if (!snapshot.exists) {
    return {
      schemaVersion: 1,
      planId,
      activeVersion: fallback.version,
      definition: fallback,
      updatedBy: fallback.createdBy,
      updatedAt: null,
    };
  }
  const data = snapshot.data() as Record<string, unknown>;
  const definition = parsePlanVersion(asRecord(data.definition), fallback);
  return {
    schemaVersion: 1,
    planId,
    activeVersion: integerValue(data.activeVersion) ?? definition.version,
    definition,
    updatedBy: clean(data.updatedBy) || definition.createdBy,
    updatedAt: timestampToIso(data.updatedAt),
  };
};

export type PlanManagementSnapshot = {
  plans: KyrubPlanCatalogEntry[];
  coupons: KyrubCouponCampaign[];
};

const parseCoupon = (data: Record<string, unknown>): KyrubCouponCampaign | null => {
  const code = normalizeKyrubCouponCode(clean(data.code));
  const targetPlan = data.targetPlan;
  const discountType = data.discountType;
  const durationType = data.durationType;
  const status = data.status;
  if (
    !isValidKyrubCouponCode(code) ||
    (targetPlan !== 'pro' && targetPlan !== 'business') ||
    (discountType !== 'percent' && discountType !== 'fixed_brl') ||
    (durationType !== 'months' && durationType !== 'until' && durationType !== 'indefinite') ||
    !COUPON_STATUSES.includes(status as KyrubCouponStatus)
  ) {
    return null;
  }
  const discountValue = numberValue(data.discountValue);
  if (discountValue === null || !validateKyrubDiscount(discountType, discountValue)) {
    return null;
  }
  return {
    schemaVersion: 1,
    id: clean(data.id) || code,
    code,
    label: clean(data.label),
    targetPlan,
    targetPlanVersion: data.targetPlanVersion === null
      ? null
      : integerValue(data.targetPlanVersion),
    discountType,
    discountValue,
    durationType,
    durationMonths: data.durationMonths === null ? null : integerValue(data.durationMonths),
    benefitEndsAt: nullableIso(data.benefitEndsAt),
    redeemStartsAt: nullableIso(data.redeemStartsAt),
    redeemEndsAt: nullableIso(data.redeemEndsAt),
    maxRedemptions: data.maxRedemptions === null ? null : integerValue(data.maxRedemptions),
    maxRedemptionsPerStore: integerValue(data.maxRedemptionsPerStore) ?? 1,
    redemptionCount: integerValue(data.redemptionCount) ?? 0,
    status: status as KyrubCouponStatus,
    createdBy: clean(data.createdBy),
    createdAt: timestampToIso(data.createdAt),
    updatedBy: clean(data.updatedBy),
    updatedAt: timestampToIso(data.updatedAt),
  };
};

export const loadPlanManagementSnapshot = async (
  authorization: string
): Promise<PlanManagementSnapshot> => {
  await requireSuperAdmin(authorization);
  const [plans, couponSnapshot] = await Promise.all([
    Promise.all(PLAN_IDS.map(currentCatalogEntry)),
    adminDb.collection(COUPON_COLLECTION).orderBy('createdAt', 'desc').limit(100).get(),
  ]);
  const coupons = couponSnapshot.docs
    .map(document => parseCoupon(document.data() as Record<string, unknown>))
    .filter((coupon): coupon is KyrubCouponCampaign => coupon !== null);
  return { plans, coupons };
};

export type PublishPlanVersionInput = {
  planId: KyrubCommercialPlanId;
  monthlyPriceBRL: number;
  activeCatalogLimit: number | null;
  kyrubiaIntelligenceCredits: number;
  marketplaceOriginatedSaleCommissionPercent: number;
  features: KyrubPlanFeatureStates;
};

const normalizePlanInput = (raw: unknown): PublishPlanVersionInput => {
  const input = asRecord(raw);
  const planId = safePlanId(input.planId);
  const monthlyPrice = numberValue(input.monthlyPriceBRL);
  const rawCatalogLimit = input.activeCatalogLimit;
  const catalogLimit = rawCatalogLimit === null ? null : integerValue(rawCatalogLimit);
  const credits = integerValue(input.kyrubiaIntelligenceCredits);
  const commission = numberValue(input.marketplaceOriginatedSaleCommissionPercent);

  if (monthlyPrice === null || monthlyPrice < 0 || monthlyPrice > 1_000_000) {
    throw new PlanManagementError(400, 'INVALID_PLAN_PRICE', 'Informe um valor mensal válido.');
  }
  if (planId === 'free' && monthlyPrice !== 0) {
    throw new PlanManagementError(400, 'FREE_MUST_REMAIN_FREE', 'O plano Free deve permanecer com preço R$ 0.');
  }
  if (planId !== 'business' && catalogLimit === null) {
    throw new PlanManagementError(
      400,
      'FINITE_CATALOG_REQUIRED',
      'Free e Pro precisam de um limite numérico de catálogo.'
    );
  }
  if (catalogLimit !== null && (catalogLimit < 0 || catalogLimit > 1_000_000)) {
    throw new PlanManagementError(400, 'INVALID_CATALOG_LIMIT', 'Informe um limite de catálogo válido.');
  }
  if (credits === null || credits < 0 || credits > 100_000_000) {
    throw new PlanManagementError(400, 'INVALID_CREDIT_LIMIT', 'Informe uma franquia válida de Créditos Kyrubia.');
  }
  if (commission === null || commission < 0 || commission > 100) {
    throw new PlanManagementError(400, 'INVALID_COMMISSION', 'Informe uma comissão entre 0 e 100%.');
  }

  return {
    planId,
    monthlyPriceBRL: monthlyPrice,
    activeCatalogLimit: catalogLimit,
    kyrubiaIntelligenceCredits: credits,
    marketplaceOriginatedSaleCommissionPercent: commission,
    features: safeFeatureStates(input.features),
  };
};

const auditId = (): string => randomUUID().replaceAll('-', '_');
const versionDocumentId = (planId: KyrubCommercialPlanId, version: number): string =>
  `${planId}_v${version}`;

export const publishPlanVersion = async (
  authorization: string,
  rawInput: unknown
): Promise<KyrubPlanCatalogEntry> => {
  const admin = await requireSuperAdmin(authorization);
  const input = normalizePlanInput(rawInput);
  const catalogReference = adminDb.doc(`${PLAN_CATALOG_COLLECTION}/${input.planId}`);
  const auditReference = adminDb.doc(`${AUDIT_COLLECTION}/${auditId()}`);
  let response!: KyrubPlanCatalogEntry;

  await adminDb.runTransaction(async transaction => {
    const catalogSnapshot = await transaction.get(catalogReference);
    const fallback = KYRUB_BOOTSTRAP_PLAN_CATALOG[input.planId];
    const currentVersion = catalogSnapshot.exists
      ? integerValue(catalogSnapshot.data()?.activeVersion) ?? fallback.version
      : fallback.version;
    const nextVersion = currentVersion + 1;
    const createdAt = FieldValue.serverTimestamp();
    const definition: KyrubPlanVersion = {
      schemaVersion: 1,
      planId: input.planId,
      version: nextVersion,
      status: 'active',
      monthlyPriceBRL: input.monthlyPriceBRL,
      activeCatalogLimit: input.activeCatalogLimit,
      kyrubiaIntelligenceCredits: input.kyrubiaIntelligenceCredits,
      marketplaceOriginatedSaleCommissionPercent:
        input.marketplaceOriginatedSaleCommissionPercent,
      features: input.features,
      effectiveFrom: new Date().toISOString(),
      createdBy: admin.uid,
      createdAt: null,
    };

    if (!catalogSnapshot.exists) {
      transaction.set(
        adminDb.doc(`${PLAN_VERSIONS_COLLECTION}/${versionDocumentId(input.planId, fallback.version)}`),
        {
          ...fallback,
          createdAt,
        }
      );
    }
    transaction.set(
      adminDb.doc(`${PLAN_VERSIONS_COLLECTION}/${versionDocumentId(input.planId, nextVersion)}`),
      { ...definition, createdAt }
    );
    transaction.set(catalogReference, {
      schemaVersion: 1,
      planId: input.planId,
      activeVersion: nextVersion,
      definition: { ...definition, createdAt },
      updatedBy: admin.uid,
      updatedAt: createdAt,
    });
    transaction.set(auditReference, {
      id: auditReference.id,
      action: 'admin.plan.version.published',
      actorId: admin.uid,
      actorRole: admin.role,
      targetType: 'plan',
      targetId: input.planId,
      previousVersion: currentVersion,
      nextVersion,
      source: 'server',
      createdAt,
    });

    response = {
      schemaVersion: 1,
      planId: input.planId,
      activeVersion: nextVersion,
      definition,
      updatedBy: admin.uid,
      updatedAt: null,
    };
  });

  return response;
};

export type CreateCouponCampaignInput = {
  code: string;
  label: string;
  targetPlan: Exclude<KyrubCommercialPlanId, 'free'>;
  targetPlanVersion: number | null;
  discountType: KyrubCouponDiscountType;
  discountValue: number;
  durationType: KyrubCouponDurationType;
  durationMonths: number | null;
  benefitEndsAt: string | null;
  redeemStartsAt: string | null;
  redeemEndsAt: string | null;
  maxRedemptions: number | null;
  maxRedemptionsPerStore: number;
  status: KyrubCouponStatus;
};

const normalizeCouponInput = (raw: unknown): CreateCouponCampaignInput => {
  const input = asRecord(raw);
  const code = normalizeKyrubCouponCode(clean(input.code));
  if (!isValidKyrubCouponCode(code)) {
    throw new PlanManagementError(
      400,
      'INVALID_COUPON_CODE',
      'Use um código de 3 a 40 caracteres com letras, números, _ ou -.'
    );
  }
  const label = clean(input.label).slice(0, 120);
  if (!label) {
    throw new PlanManagementError(400, 'COUPON_LABEL_REQUIRED', 'Informe um nome para a campanha.');
  }
  const targetPlan = safeTargetPaidPlan(input.targetPlan);
  const targetPlanVersion = input.targetPlanVersion === null || input.targetPlanVersion === undefined
    ? null
    : integerValue(input.targetPlanVersion);
  if (targetPlanVersion !== null && targetPlanVersion < 1) {
    throw new PlanManagementError(400, 'INVALID_TARGET_VERSION', 'A versão alvo do plano é inválida.');
  }
  const discountType = input.discountType;
  if (discountType !== 'percent' && discountType !== 'fixed_brl') {
    throw new PlanManagementError(400, 'INVALID_DISCOUNT_TYPE', 'Escolha desconto percentual ou em reais.');
  }
  const discountValue = numberValue(input.discountValue);
  if (discountValue === null || !validateKyrubDiscount(discountType, discountValue)) {
    throw new PlanManagementError(400, 'INVALID_DISCOUNT', 'Informe um desconto válido.');
  }
  const durationType = input.durationType;
  if (durationType !== 'months' && durationType !== 'until' && durationType !== 'indefinite') {
    throw new PlanManagementError(400, 'INVALID_DURATION', 'Escolha uma duração válida para o benefício.');
  }
  const durationMonths = durationType === 'months' ? integerValue(input.durationMonths) : null;
  if (durationType === 'months' && (durationMonths === null || durationMonths < 1 || durationMonths > 120)) {
    throw new PlanManagementError(400, 'INVALID_DURATION_MONTHS', 'Informe de 1 a 120 meses de benefício.');
  }
  const benefitEndsAt = durationType === 'until' ? nullableIso(input.benefitEndsAt) : null;
  if (durationType === 'until' && !benefitEndsAt) {
    throw new PlanManagementError(400, 'BENEFIT_END_REQUIRED', 'Informe até quando o benefício será válido.');
  }
  const redeemStartsAt = nullableIso(input.redeemStartsAt);
  const redeemEndsAt = nullableIso(input.redeemEndsAt);
  if (redeemStartsAt && redeemEndsAt && redeemEndsAt <= redeemStartsAt) {
    throw new PlanManagementError(400, 'INVALID_REDEMPTION_WINDOW', 'O fim dos resgates deve ocorrer após o início.');
  }
  const maxRedemptions = input.maxRedemptions === null || input.maxRedemptions === undefined
    ? null
    : integerValue(input.maxRedemptions);
  if (maxRedemptions !== null && (maxRedemptions < 1 || maxRedemptions > 10_000_000)) {
    throw new PlanManagementError(400, 'INVALID_MAX_REDEMPTIONS', 'Informe um limite total de resgates válido.');
  }
  const maxRedemptionsPerStore = integerValue(input.maxRedemptionsPerStore) ?? 1;
  if (maxRedemptionsPerStore < 1 || maxRedemptionsPerStore > 100) {
    throw new PlanManagementError(400, 'INVALID_STORE_REDEMPTIONS', 'Informe um limite por loja entre 1 e 100.');
  }
  const status = COUPON_STATUSES.includes(input.status as KyrubCouponStatus)
    ? input.status as KyrubCouponStatus
    : 'draft';

  return {
    code,
    label,
    targetPlan,
    targetPlanVersion,
    discountType,
    discountValue,
    durationType,
    durationMonths,
    benefitEndsAt,
    redeemStartsAt,
    redeemEndsAt,
    maxRedemptions,
    maxRedemptionsPerStore,
    status,
  };
};

export const createCouponCampaign = async (
  authorization: string,
  rawInput: unknown
): Promise<KyrubCouponCampaign> => {
  const admin = await requireSuperAdmin(authorization);
  const input = normalizeCouponInput(rawInput);
  const campaignReference = adminDb.doc(`${COUPON_COLLECTION}/${input.code}`);
  const auditReference = adminDb.doc(`${AUDIT_COLLECTION}/${auditId()}`);
  const now = FieldValue.serverTimestamp();

  await adminDb.runTransaction(async transaction => {
    const existing = await transaction.get(campaignReference);
    if (existing.exists) {
      throw new PlanManagementError(
        409,
        'COUPON_CODE_EXISTS',
        'Já existe uma campanha com esse código.'
      );
    }
    transaction.set(campaignReference, {
      schemaVersion: 1,
      id: input.code,
      ...input,
      redemptionCount: 0,
      createdBy: admin.uid,
      createdAt: now,
      updatedBy: admin.uid,
      updatedAt: now,
    });
    transaction.set(auditReference, {
      id: auditReference.id,
      action: 'admin.coupon.created',
      actorId: admin.uid,
      actorRole: admin.role,
      targetType: 'coupon',
      targetId: input.code,
      targetPlan: input.targetPlan,
      source: 'server',
      createdAt: now,
    });
  });

  return {
    schemaVersion: 1,
    id: input.code,
    ...input,
    redemptionCount: 0,
    createdBy: admin.uid,
    createdAt: null,
    updatedBy: admin.uid,
    updatedAt: null,
  };
};

export const setCouponCampaignStatus = async (
  authorization: string,
  rawCode: unknown,
  rawStatus: unknown
): Promise<{ code: string; status: KyrubCouponStatus }> => {
  const admin = await requireSuperAdmin(authorization);
  const code = normalizeKyrubCouponCode(clean(rawCode));
  if (!isValidKyrubCouponCode(code)) {
    throw new PlanManagementError(400, 'INVALID_COUPON_CODE', 'Código de cupom inválido.');
  }
  if (!COUPON_STATUSES.includes(rawStatus as KyrubCouponStatus)) {
    throw new PlanManagementError(400, 'INVALID_COUPON_STATUS', 'Status de cupom inválido.');
  }
  const status = rawStatus as KyrubCouponStatus;
  const campaignReference = adminDb.doc(`${COUPON_COLLECTION}/${code}`);
  const auditReference = adminDb.doc(`${AUDIT_COLLECTION}/${auditId()}`);
  const now = FieldValue.serverTimestamp();

  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(campaignReference);
    if (!snapshot.exists) {
      throw new PlanManagementError(404, 'COUPON_NOT_FOUND', 'Cupom não encontrado.');
    }
    transaction.set(campaignReference, {
      status,
      updatedBy: admin.uid,
      updatedAt: now,
    }, { merge: true });
    transaction.set(auditReference, {
      id: auditReference.id,
      action: 'admin.coupon.status_changed',
      actorId: admin.uid,
      actorRole: admin.role,
      targetType: 'coupon',
      targetId: code,
      nextStatus: status,
      source: 'server',
      createdAt: now,
    });
  });

  return { code, status };
};

export const mapPlanManagementError = (error: unknown): {
  status: number;
  body: { error: string; code: string };
} => {
  if (error instanceof PlanManagementError) {
    return { status: error.status, body: { error: error.message, code: error.code } };
  }
  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  if (message === 'AUTH_REQUIRED' || code === 'AUTH_REQUIRED' || /id-token|expired|revoked/i.test(message)) {
    return { status: 401, body: { error: 'Faça login novamente.', code: 'AUTH_REQUIRED' } };
  }
  if (message === 'EMAIL_NOT_VERIFIED' || message === 'FORBIDDEN') {
    return { status: 403, body: { error: 'Esta conta não possui autorização administrativa.', code: 'FORBIDDEN' } };
  }
  if (code === 'AUTH_UNAVAILABLE') {
    return { status: 503, body: { error: 'Não foi possível validar a sessão administrativa agora.', code: 'AUTH_UNAVAILABLE' } };
  }
  console.error('[Kyrub Plan Management]', error);
  return {
    status: 503,
    body: {
      error: 'Não foi possível concluir a operação de planos e cupons com segurança agora.',
      code: 'PLAN_MANAGEMENT_UNAVAILABLE',
    },
  };
};

export const isManagedPlanFeature = (value: string): value is KyrubPlanFeatureId =>
  KYRUB_PLAN_FEATURES.some(feature => feature.id === value);
