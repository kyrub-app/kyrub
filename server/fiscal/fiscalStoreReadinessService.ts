import { FieldValue } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';

const bearerToken = (authorization: string): string => /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';
const clean = (value: unknown, maxLength = 160): string => typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

export type FiscalReadinessRequirementKey =
  | 'fiscal_profile_complete'
  | 'state_nfce_enabled'
  | 'certificate_a1_configured'
  | 'nfce_csc_configured'
  | 'provider_company_provisioned'
  | 'homologation_approved';

export interface FiscalReadinessRequirement {
  key: FiscalReadinessRequirementKey;
  status: 'pending' | 'complete';
  label: string;
  secret: boolean;
}

export interface FiscalStoreReadinessView {
  canonicalStoreId: string;
  status: 'pending' | 'ready_for_production_authorization';
  requirements: FiscalReadinessRequirement[];
  productionTrafficAllowed: false;
}

const assertOwnStore = async (authorization: string, canonicalStoreIdInput: unknown): Promise<string> => {
  const token = bearerToken(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const decoded = await verifyFirebaseIdToken(token);
  if (decoded.emailVerified !== true) throw new Error('EMAIL_NOT_VERIFIED');
  const canonicalStoreId = clean(canonicalStoreIdInput);
  if (!canonicalStoreId) throw new Error('FISCAL_STORE_REQUIRED');
  if (canonicalStoreId !== decoded.uid) throw new Error('FISCAL_STORE_OWNERSHIP_REQUIRED');
  const store = await adminDb.doc(`stores/${canonicalStoreId}`).get();
  if (!store.exists) throw new Error('FISCAL_STORE_NOT_FOUND');
  return canonicalStoreId;
};

const requirement = (key: FiscalReadinessRequirementKey, label: string, complete: boolean, secret = false): FiscalReadinessRequirement => ({
  key,
  label,
  status: complete ? 'complete' : 'pending',
  secret,
});

/**
 * Tenant-safe, read-only readiness projection.
 *
 * Secrets never leave their backstage authorities. This projection exposes only
 * whether a prerequisite has been satisfied. It cannot authorize production.
 */
export const loadOwnFiscalStoreReadiness = async (input: {
  authorization: string;
  canonicalStoreId: unknown;
}): Promise<FiscalStoreReadinessView> => {
  const canonicalStoreId = await assertOwnStore(input.authorization, input.canonicalStoreId);

  const [profileSnapshot, enrollmentSnapshot, readinessSnapshot] = await Promise.all([
    adminDb.doc(`stores/${canonicalStoreId}/fiscal/profile`).get(),
    adminDb.doc(`kyrub_admin/fiscal/store_enrollments/${canonicalStoreId}`).get(),
    adminDb.doc(`kyrub_admin/fiscal/store_readiness/${canonicalStoreId}`).get(),
  ]);

  const profile = profileSnapshot.data() ?? {};
  const enrollment = enrollmentSnapshot.data() ?? {};
  const backstage = readinessSnapshot.data() ?? {};

  const requirements: FiscalReadinessRequirement[] = [
    requirement('fiscal_profile_complete', 'Dados fiscais completos', profile.completeness === 'complete'),
    requirement('state_nfce_enabled', 'NFC-e habilitada na SEFAZ da UF', backstage.stateNfceEnabled === true),
    requirement('certificate_a1_configured', 'Certificado digital A1 configurado', backstage.certificateA1Configured === true, true),
    requirement('nfce_csc_configured', 'CSC e identificador da NFC-e configurados', backstage.nfceCscConfigured === true, true),
    requirement('provider_company_provisioned', 'Emitente provisionado no backstage fiscal', backstage.providerCompanyProvisioned === true, true),
    requirement('homologation_approved', 'Homologação fiscal aprovada', backstage.homologationApproved === true),
  ];

  const allComplete = requirements.every(item => item.status === 'complete');
  const enrollmentPrepared = enrollment.status === 'prepared' || enrollment.status === 'production_authorized';

  return {
    canonicalStoreId,
    status: allComplete && enrollmentPrepared ? 'ready_for_production_authorization' : 'pending',
    requirements,
    productionTrafficAllowed: false,
  };
};

/**
 * Backstage-only persistence helper. Callers must already have passed the
 * administrative/provider authority appropriate to the operation being marked.
 * Secret material itself must never be passed here; only completion evidence.
 */
export const recordFiscalReadinessEvidence = async (input: {
  canonicalStoreId: string;
  evidence: Partial<{
    stateNfceEnabled: boolean;
    certificateA1Configured: boolean;
    nfceCscConfigured: boolean;
    providerCompanyProvisioned: boolean;
    homologationApproved: boolean;
  }>;
  actorId: string;
  source: string;
}): Promise<void> => {
  const canonicalStoreId = clean(input.canonicalStoreId);
  if (!canonicalStoreId) throw new Error('FISCAL_STORE_REQUIRED');
  const allowedKeys = ['stateNfceEnabled', 'certificateA1Configured', 'nfceCscConfigured', 'providerCompanyProvisioned', 'homologationApproved'] as const;
  const evidence: Record<string, boolean> = {};
  for (const key of allowedKeys) if (typeof input.evidence[key] === 'boolean') evidence[key] = input.evidence[key] as boolean;
  if (!Object.keys(evidence).length) throw new Error('FISCAL_READINESS_EVIDENCE_REQUIRED');

  await adminDb.doc(`kyrub_admin/fiscal/store_readiness/${canonicalStoreId}`).set({
    ...evidence,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: clean(input.actorId),
    source: clean(input.source),
  }, { merge: true });
};

export const mapFiscalStoreReadinessError = (error: unknown): { status: number; body: { error: string; code: string } } => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED' || /id-token|expired|revoked/i.test(message)) return { status: 401, body: { error: 'Faça login novamente.', code: 'AUTH_REQUIRED' } };
  if (message === 'EMAIL_NOT_VERIFIED') return { status: 403, body: { error: 'Verifique seu e-mail para consultar a prontidão fiscal.', code: message } };
  if (message === 'FISCAL_STORE_OWNERSHIP_REQUIRED') return { status: 403, body: { error: 'A prontidão fiscal só pode ser consultada pela própria loja autenticada.', code: message } };
  if (message === 'FISCAL_STORE_NOT_FOUND') return { status: 404, body: { error: 'A loja autenticada não foi encontrada.', code: message } };
  if (message === 'FISCAL_STORE_REQUIRED') return { status: 400, body: { error: 'Não foi possível identificar a loja ativa.', code: message } };
  console.error('[Fiscal Store Readiness]', error);
  return { status: 503, body: { error: 'Não foi possível consultar a prontidão fiscal agora.', code: 'FISCAL_STORE_READINESS_FAILED' } };
};
