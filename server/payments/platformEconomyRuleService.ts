import type { Transaction } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  buildDefaultPlatformFeeSubsidyPolicy,
  normalizePlatformFeeSubsidyPolicy,
  platformFeeSubsidyPolicyPath,
  platformFeeSubsidyPolicyPointerPath,
  type PlatformFeeSubsidyPolicy,
  type PlatformFeeSubsidyPolicyPointer,
} from '../../shared/platformFeeSubsidyPolicy.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const loadActivePlatformEconomyRuleInTransaction = async (
  transaction: Transaction,
  nowIso: string
): Promise<PlatformFeeSubsidyPolicy> => {
  const pointerSnapshot = await transaction.get(
    adminDb.doc(platformFeeSubsidyPolicyPointerPath())
  );
  if (!pointerSnapshot.exists) {
    return buildDefaultPlatformFeeSubsidyPolicy(nowIso);
  }
  const pointer = pointerSnapshot.data() as Partial<PlatformFeeSubsidyPolicyPointer>;
  const activePolicyId = clean(pointer.activePolicyId);
  if (pointer.schemaVersion !== 1 || !activePolicyId) {
    throw new Error('PLATFORM_POLICY_POINTER_INVALID');
  }
  const policySnapshot = await transaction.get(
    adminDb.doc(platformFeeSubsidyPolicyPath(activePolicyId))
  );
  if (!policySnapshot.exists) throw new Error('PLATFORM_POLICY_ACTIVE_NOT_FOUND');
  const policy = normalizePlatformFeeSubsidyPolicy(policySnapshot.data());
  if (policy.id !== activePolicyId || policy.status !== 'active') {
    throw new Error('PLATFORM_POLICY_ACTIVE_INVALID');
  }
  return policy;
};

export const loadActivePlatformEconomyRule = async (): Promise<PlatformFeeSubsidyPolicy> => {
  const pointerSnapshot = await adminDb
    .doc(platformFeeSubsidyPolicyPointerPath())
    .get();
  if (!pointerSnapshot.exists) {
    return buildDefaultPlatformFeeSubsidyPolicy(new Date().toISOString());
  }
  const pointer = pointerSnapshot.data() as Partial<PlatformFeeSubsidyPolicyPointer>;
  const activePolicyId = clean(pointer.activePolicyId);
  if (pointer.schemaVersion !== 1 || !activePolicyId) {
    throw new Error('PLATFORM_POLICY_POINTER_INVALID');
  }
  const policySnapshot = await adminDb
    .doc(platformFeeSubsidyPolicyPath(activePolicyId))
    .get();
  if (!policySnapshot.exists) throw new Error('PLATFORM_POLICY_ACTIVE_NOT_FOUND');
  return normalizePlatformFeeSubsidyPolicy(policySnapshot.data());
};
