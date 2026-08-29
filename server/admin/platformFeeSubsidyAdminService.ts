import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  normalizePlatformFeeSubsidyPolicy,
  platformFeeSubsidyPolicyPath,
  platformFeeSubsidyPolicyPointerPath,
  type PlatformFeeSubsidyPolicy,
  type PlatformFeeSubsidyPolicyPointer,
} from '../../shared/platformFeeSubsidyPolicy.js';
import { loadActivePlatformEconomyRule } from '../payments/platformEconomyRuleService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const normalizeContexts = (value: unknown): PlatformFeeSubsidyPolicy['contexts'] => {
  if (!Array.isArray(value)) throw new Error('PLATFORM_POLICY_CONTEXTS_INVALID');
  const contexts = [...new Set(value.filter(
    (item): item is 'marketplace' | 'table' | 'pos' =>
      item === 'marketplace' || item === 'table' || item === 'pos'
  ))];
  if (contexts.length === 0 || contexts.length !== value.length) {
    throw new Error('PLATFORM_POLICY_CONTEXTS_INVALID');
  }
  return contexts;
};

const bps = (value: unknown, label: string): number => {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > 10_000) {
    throw new Error(`PLATFORM_POLICY_${label}_BPS_INVALID`);
  }
  return numeric;
};

export const publishPlatformFeeSubsidyPolicy = async (input: {
  actorUserId: string;
  actorRole: string;
  platformFeeBps: unknown;
  platformSubsidyBps: unknown;
  contexts: unknown;
  now?: Date;
}): Promise<PlatformFeeSubsidyPolicy> => {
  const actorUserId = clean(input.actorUserId);
  if (!actorUserId || input.actorRole !== 'super_admin') {
    throw new Error('PLATFORM_POLICY_FORBIDDEN');
  }
  const platformFeeBps = bps(input.platformFeeBps, 'FEE');
  const platformSubsidyBps = bps(input.platformSubsidyBps, 'SUBSIDY');
  const contexts = normalizeContexts(input.contexts);
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('PLATFORM_POLICY_TIME_INVALID');
  const nowIso = now.toISOString();
  const pointerRef = adminDb.doc(platformFeeSubsidyPolicyPointerPath());

  return adminDb.runTransaction(async transaction => {
    const pointerSnapshot = await transaction.get(pointerRef);
    let previous: PlatformFeeSubsidyPolicy | null = null;
    if (pointerSnapshot.exists) {
      const pointer = pointerSnapshot.data() as Partial<PlatformFeeSubsidyPolicyPointer>;
      const activePolicyId = clean(pointer.activePolicyId);
      if (pointer.schemaVersion !== 1 || !activePolicyId) {
        throw new Error('PLATFORM_POLICY_POINTER_INVALID');
      }
      const previousSnapshot = await transaction.get(
        adminDb.doc(platformFeeSubsidyPolicyPath(activePolicyId))
      );
      if (!previousSnapshot.exists) throw new Error('PLATFORM_POLICY_ACTIVE_NOT_FOUND');
      previous = normalizePlatformFeeSubsidyPolicy(previousSnapshot.data());
    }

    if (
      previous &&
      previous.platformFeeBps === platformFeeBps &&
      previous.platformSubsidyBps === platformSubsidyBps &&
      previous.contexts.length === contexts.length &&
      previous.contexts.every(context => contexts.includes(context))
    ) {
      return previous;
    }

    const version = (previous?.version ?? 0) + 1;
    const policyId = `policy_v${version}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const policy = normalizePlatformFeeSubsidyPolicy({
      schemaVersion: 1,
      id: policyId,
      version,
      status: 'active',
      platformFeeBps,
      platformSubsidyBps,
      contexts,
      effectiveFrom: nowIso,
      createdAt: nowIso,
      createdBy: actorUserId,
      supersedesPolicyId: previous?.id ?? '',
    });
    const pointer: PlatformFeeSubsidyPolicyPointer = {
      schemaVersion: 1,
      activePolicyId: policy.id,
      updatedAt: nowIso,
      updatedBy: actorUserId,
    };
    const auditId = randomUUID().replaceAll('-', '_');

    transaction.set(adminDb.doc(platformFeeSubsidyPolicyPath(policy.id)), policy);
    transaction.set(pointerRef, pointer);
    transaction.set(
      adminDb.doc(`kyrub_admin/control_plane/audit_logs/${auditId}`),
      {
        id: auditId,
        action: 'admin.platform_economy.policy_published',
        actorId: actorUserId,
        actorRole: input.actorRole,
        targetType: 'platform_economy_policy',
        targetId: policy.id,
        source: 'server',
        createdAt: FieldValue.serverTimestamp(),
      }
    );
    return policy;
  });
};

export const getPlatformFeeSubsidyPolicyForAdmin = async (): Promise<PlatformFeeSubsidyPolicy> =>
  loadActivePlatformEconomyRule();
