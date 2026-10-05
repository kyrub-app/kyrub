import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type { ManagedFiscalIssuerEnvironment, ManagedFiscalStoreEnrollment } from './fiscalManagedProviderControlPlane.js';

const clean = (value: unknown, maxLength = 160): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const managedEnrollmentRef = (canonicalStoreId: string) =>
  adminDb.doc(`kyrub_admin/control_plane/fiscal_store_enrollments/${canonicalStoreId}`);

const legacyEnrollmentRef = (canonicalStoreId: string) =>
  adminDb.doc(`kyrub_admin/fiscal/store_enrollments/${canonicalStoreId}`);

export interface PrepareManagedFiscalStoreEnrollmentInput {
  canonicalStoreId: string;
  actorId: string;
  environment?: ManagedFiscalIssuerEnvironment;
}

export interface ManagedFiscalStoreEnrollmentRead {
  enrollment: Partial<ManagedFiscalStoreEnrollment> | null;
  source: 'canonical' | 'legacy' | 'none';
}

/**
 * Reads the server-owned enrollment authority. The control-plane document is the
 * canonical source. The old fiscal/store_enrollments location remains read-only
 * compatibility evidence so historical state is not lost during cutover.
 */
export const loadManagedFiscalStoreEnrollment = async (
  canonicalStoreIdInput: unknown
): Promise<ManagedFiscalStoreEnrollmentRead> => {
  const canonicalStoreId = clean(canonicalStoreIdInput);
  if (!canonicalStoreId) throw new Error('FISCAL_STORE_REQUIRED');

  const canonicalSnapshot = await managedEnrollmentRef(canonicalStoreId).get();
  if (canonicalSnapshot.exists) {
    return {
      enrollment: canonicalSnapshot.data() as Partial<ManagedFiscalStoreEnrollment>,
      source: 'canonical',
    };
  }

  const legacySnapshot = await legacyEnrollmentRef(canonicalStoreId).get();
  if (legacySnapshot.exists) {
    return {
      enrollment: legacySnapshot.data() as Partial<ManagedFiscalStoreEnrollment>,
      source: 'legacy',
    };
  }

  return { enrollment: null, source: 'none' };
};

/**
 * Prepares a store for Kyrub Fiscal without granting production authority.
 * Canonical store ownership/existence is asserted by the authenticated fiscal
 * onboarding boundary before this helper is called. New enrollments default to
 * homologation. Existing production enrollments are never silently downgraded or
 * reinterpreted; changing their environment requires a separate explicit control
 * operation.
 */
export const prepareManagedFiscalStoreEnrollment = async (
  input: PrepareManagedFiscalStoreEnrollmentInput
): Promise<ManagedFiscalStoreEnrollment> => {
  const canonicalStoreId = clean(input.canonicalStoreId);
  const actorId = clean(input.actorId);
  const environment: ManagedFiscalIssuerEnvironment = input.environment === 'production' ? 'production' : 'homologation';
  if (!canonicalStoreId || !actorId) throw new Error('FISCAL_STORE_ENROLLMENT_INPUT_REQUIRED');

  const ref = managedEnrollmentRef(canonicalStoreId);
  const existingSnapshot = await ref.get();
  const existing = existingSnapshot.data() as Partial<ManagedFiscalStoreEnrollment> | undefined;
  if (existing?.status === 'production_authorized' || existing?.status === 'suspended') {
    throw new Error('FISCAL_STORE_ENROLLMENT_STATE_REQUIRES_SEPARATE_CONTROL');
  }
  if (existing?.environment === 'production' && environment !== 'production') {
    throw new Error('FISCAL_STORE_ENROLLMENT_ENVIRONMENT_REQUIRES_SEPARATE_CONTROL');
  }

  const enrollment: ManagedFiscalStoreEnrollment = {
    schemaVersion: 1,
    canonicalStoreId,
    providerId: 'focus-nfe',
    documentFamily: 'nfce',
    environment,
    status: 'prepared',
    authority: 'server_owned_managed_fiscal_store_enrollment',
  };

  await ref.set({
    ...enrollment,
    preparedBy: actorId,
    preparedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return enrollment;
};
