import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { authorizeOperationsHealth } from './operationsHealthRouter.js';

export const FOUNDING_PRO_PROMOTION_ID = 'founding_pro_001';

export type PromotionalProGrantStatus = 'granted' | 'already_granted';

export interface PromotionalProGrantResult {
  status: PromotionalProGrantStatus;
  targetUserId: string;
  storeId: string;
  canonicalStoreId: string | null;
  plan: 'pro';
  source: 'promotional';
  promotionId: typeof FOUNDING_PRO_PROMOTION_ID;
  expiresAt: null;
}

export class PromotionalPlanError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'PromotionalPlanError';
  }
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const safeTargetUserId = (value: unknown): string => {
  const targetUserId = clean(value);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(targetUserId)) {
    throw new PromotionalPlanError(
      400,
      'INVALID_TARGET_USER',
      'Informe um UID válido para a loja que receberá a cortesia.'
    );
  }
  return targetUserId;
};

const normalizePlan = (value: unknown): 'free' | 'pro' | 'business' =>
  value === 'pro' || value === 'business' ? value : 'free';

const findCanonicalStoreForOwner = async (
  targetUserId: string
): Promise<{ id: string } | null> => {
  const snapshot = await adminDb
    .collection('stores')
    .where('ownerId', '==', targetUserId)
    .get();

  if (snapshot.size > 1) {
    throw new PromotionalPlanError(
      409,
      'STORE_IDENTITY_CONFLICT',
      'Mais de uma loja canônica foi encontrada para este usuário. A cortesia não foi aplicada.'
    );
  }

  return snapshot.empty ? null : { id: snapshot.docs[0].id };
};

export const grantFoundingProPromotion = async (
  authorization: string,
  rawTargetUserId: unknown
): Promise<PromotionalProGrantResult> => {
  const admin = await authorizeOperationsHealth(authorization);
  if (admin.role !== 'super_admin') {
    throw new PromotionalPlanError(
      403,
      'PROMOTION_GRANT_FORBIDDEN',
      'Somente Super Admin pode conceder uma cortesia de plano.'
    );
  }

  const targetUserId = safeTargetUserId(rawTargetUserId);
  const canonicalStore = await findCanonicalStoreForOwner(targetUserId);
  const privateStoreReference = adminDb.doc(
    `users/${targetUserId}/stores/${targetUserId}`
  );
  const tenantReference = adminDb.doc(`tenants/${targetUserId}`);
  const entitlementReference = adminDb.doc(
    `kyrub_admin/control_plane/store_entitlements/${targetUserId}`
  );
  const auditId = randomUUID().replaceAll('-', '_');
  const auditReference = adminDb.doc(
    `kyrub_admin/control_plane/audit_logs/${auditId}`
  );
  const canonicalReference = canonicalStore
    ? adminDb.doc(`stores/${canonicalStore.id}`)
    : null;

  let resultStatus: PromotionalProGrantStatus = 'granted';

  await adminDb.runTransaction(async transaction => {
    const [privateStoreSnapshot, entitlementSnapshot] = await Promise.all([
      transaction.get(privateStoreReference),
      transaction.get(entitlementReference),
    ]);

    if (!privateStoreSnapshot.exists) {
      throw new PromotionalPlanError(
        404,
        'STORE_NOT_FOUND',
        'A Loja Kyrub privada deste usuário ainda não existe.'
      );
    }

    const storeData = privateStoreSnapshot.data() as Record<string, unknown>;
    if (
      clean(storeData.id) !== targetUserId ||
      clean(storeData.ownerId) !== targetUserId
    ) {
      throw new PromotionalPlanError(
        409,
        'STORE_OWNERSHIP_CONFLICT',
        'A identidade da loja não corresponde ao usuário informado.'
      );
    }

    const currentPlan = normalizePlan(storeData.plan);
    const currentEntitlement = entitlementSnapshot.data() as
      | Record<string, unknown>
      | undefined;
    const alreadyFoundingPro =
      currentPlan === 'pro' &&
      currentEntitlement?.status === 'active' &&
      currentEntitlement?.plan === 'pro' &&
      currentEntitlement?.source === 'promotional' &&
      currentEntitlement?.promotionId === FOUNDING_PRO_PROMOTION_ID;

    if (alreadyFoundingPro) {
      resultStatus = 'already_granted';
    } else {
      if (currentPlan === 'business') {
        throw new PromotionalPlanError(
          409,
          'PLAN_DOWNGRADE_BLOCKED',
          'A loja já possui Business. A cortesia Pro não pode rebaixar um entitlement superior.'
        );
      }
      if (currentPlan === 'pro') {
        throw new PromotionalPlanError(
          409,
          'PLAN_ALREADY_PRO',
          'A loja já possui Pro por outra origem. Revise o entitlement antes de aplicar esta campanha.'
        );
      }
    }

    const now = FieldValue.serverTimestamp();
    transaction.set(
      privateStoreReference,
      {
        plan: 'pro',
        updatedAt: now,
      },
      { merge: true }
    );
    transaction.set(
      tenantReference,
      {
        id: targetUserId,
        ownerId: targetUserId,
        plan: 'pro',
        updatedAt: now,
      },
      { merge: true }
    );
    if (canonicalReference) {
      transaction.set(
        canonicalReference,
        {
          plan: 'pro',
          legacyTenantId: targetUserId,
          updatedAt: now,
        },
        { merge: true }
      );
    }
    transaction.set(
      entitlementReference,
      {
        schemaVersion: 1,
        storeId: targetUserId,
        ownerId: targetUserId,
        plan: 'pro',
        source: 'promotional',
        benefitType: 'complimentary',
        promotionId: FOUNDING_PRO_PROMOTION_ID,
        status: 'active',
        grantedBy: admin.uid,
        grantedByRole: admin.role,
        expiresAt: null,
        grantedAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
    transaction.set(auditReference, {
      id: auditId,
      action: resultStatus === 'already_granted'
        ? 'admin.store_plan.promotional_pro.confirmed'
        : 'admin.store_plan.promotional_pro.granted',
      actorId: admin.uid,
      actorRole: admin.role,
      targetType: 'store',
      targetId: targetUserId,
      previousPlan: currentPlan,
      nextPlan: 'pro',
      entitlementSource: 'promotional',
      promotionId: FOUNDING_PRO_PROMOTION_ID,
      source: 'server',
      createdAt: now,
    });
  });

  return {
    status: resultStatus,
    targetUserId,
    storeId: targetUserId,
    canonicalStoreId: canonicalStore?.id ?? null,
    plan: 'pro',
    source: 'promotional',
    promotionId: FOUNDING_PRO_PROMOTION_ID,
    expiresAt: null,
  };
};

export const mapPromotionalPlanError = (error: unknown): {
  status: number;
  body: { error: string; code: string };
} => {
  if (error instanceof PromotionalPlanError) {
    return {
      status: error.status,
      body: { error: error.message, code: error.code },
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';

  if (
    message === 'AUTH_REQUIRED' ||
    code === 'AUTH_REQUIRED' ||
    /id-token|expired|revoked/i.test(message)
  ) {
    return {
      status: 401,
      body: { error: 'Faça login novamente.', code: 'AUTH_REQUIRED' },
    };
  }
  if (message === 'EMAIL_NOT_VERIFIED' || message === 'FORBIDDEN') {
    return {
      status: 403,
      body: {
        error: 'Esta conta não possui autorização para conceder a cortesia.',
        code: 'FORBIDDEN',
      },
    };
  }
  if (code === 'AUTH_UNAVAILABLE') {
    return {
      status: 503,
      body: {
        error: 'Não foi possível validar a sessão administrativa agora.',
        code: 'AUTH_UNAVAILABLE',
      },
    };
  }

  console.error('[Kyrub Promotional Pro]', error);
  return {
    status: 503,
    body: {
      error: 'Não foi possível conceder a cortesia Pro com segurança agora.',
      code: 'PROMOTION_GRANT_UNAVAILABLE',
    },
  };
};
