import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type { ManagedFiscalIssuerEnvironment, ManagedFiscalStoreEnrollment } from './fiscalManagedProviderControlPlane.js';

const clean = (value: unknown, maxLength = 160): string => typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

export interface PrepareManagedFiscalStoreEnrollmentInput { canonicalStoreId: string; actorId: string; environment?: ManagedFiscalIssuerEnvironment; }

export const prepareManagedFiscalStoreEnrollment = async (input: PrepareManagedFiscalStoreEnrollmentInput): Promise<ManagedFiscalStoreEnrollment> => {
  const canonicalStoreId = clean(input.canonicalStoreId);
  const actorId = clean(input.actorId);
  const environment: ManagedFiscalIssuerEnvironment = input.environment === 'production' ? 'production' : 'homologation';
  if (!canonicalStoreId || !actorId) throw new Error('FISCAL_STORE_ENROLLMENT_INPUT_REQUIRED');
  const storeSnapshot = await adminDb.doc(`stores/${canonicalStoreId}`).get();
  if (!storeSnapshot.exists) throw new Error('FISCAL_STORE_NOT_FOUND');
  const ref = adminDb.doc(`kyrub_admin/control_plane/fiscal_store_enrollments/${canonicalStoreId}`);
  const existingSnapshot = await ref.get();
  const existing = existingSnapshot.data() as Partial<ManagedFiscalStoreEnrollment> | undefined;
  if (existing?.status === 'production_authorized' || existing?.status === 'suspended') throw new Error('FISCAL_STORE_ENROLLMENT_STATE_REQUIRES_SEPARATE_CONTROL');
  if (existing?.environment === 'production' && environment !== 'production') throw new Error('FISCAL_STORE_ENROLLMENT_ENVIRONMENT_REQUIRES_SEPARATE_CONTROL');
  const enrollment: ManagedFiscalStoreEnrollment = { schemaVersion: 1, canonicalStoreId, providerId: 'focus-nfe', documentFamily: 'nfce', environment, status: 'prepared', authority: 'server_owned_managed_fiscal_store_enrollment' };
  await ref.set({ ...enrollment, preparedBy: actorId, preparedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return enrollment;
};
