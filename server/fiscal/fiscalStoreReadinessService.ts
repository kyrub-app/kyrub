import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { loadManagedFiscalStoreEnrollment } from '../integrations/fiscalManagedStoreEnrollment.js';
import { loadCanonicalFiscalProfileData } from './fiscalCanonicalStore.js';
import { authorizeOwnFiscalStore } from './fiscalStoreAuthorization.js';
import { loadFiscalStoreCredentialStatus } from './fiscalStoreCredentialService.js';

const clean = (value: unknown, maxLength = 160): string => typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

export type FiscalDocumentFamily = 'nfce' | 'nfe' | 'nfse';
export type FiscalReadinessRequirementKey =
  | 'fiscal_profile_complete'
  | 'state_document_enabled'
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

export interface FiscalFamilyReadinessView {
  family: FiscalDocumentFamily;
  enabled: boolean;
  status: 'not_configured' | 'pending' | 'ready_for_production_authorization';
  requirements: FiscalReadinessRequirement[];
  productionTrafficAllowed: false;
}

export interface FiscalStoreReadinessView {
  canonicalStoreId: string;
  status: 'pending' | 'ready_for_production_authorization';
  families: FiscalFamilyReadinessView[];
  productionTrafficAllowed: false;
}

const requirement = (key: FiscalReadinessRequirementKey, label: string, complete: boolean, secret = false): FiscalReadinessRequirement => ({ key, label, status: complete ? 'complete' : 'pending', secret });
const familyLabel = (family: FiscalDocumentFamily): string => family === 'nfce' ? 'NFC-e' : family === 'nfe' ? 'NF-e' : 'NFS-e';

const buildFamily = (input: {
  family: FiscalDocumentFamily;
  enabled: boolean;
  profileComplete: boolean;
  enrollmentPrepared: boolean;
  certificateA1Configured: boolean;
  nfceCscConfigured: boolean;
  evidence: Record<string, unknown>;
}): FiscalFamilyReadinessView => {
  const { family, enabled, profileComplete, enrollmentPrepared, certificateA1Configured, nfceCscConfigured, evidence } = input;
  const label = familyLabel(family);
  const requirements: FiscalReadinessRequirement[] = [
    requirement('fiscal_profile_complete', 'Dados fiscais completos', profileComplete),
    requirement('state_document_enabled', `${label} habilitada no ambiente fiscal competente`, evidence.stateDocumentEnabled === true),
    requirement('certificate_a1_configured', 'Certificado digital A1 configurado', certificateA1Configured, true),
    ...(family === 'nfce' ? [requirement('nfce_csc_configured', 'CSC e identificador da NFC-e configurados', nfceCscConfigured, true)] : []),
    requirement('provider_company_provisioned', `Emitente provisionado para ${label}`, evidence.providerCompanyProvisioned === true, true),
    requirement('homologation_approved', `Homologação de ${label} aprovada`, evidence.homologationApproved === true),
  ];
  const allComplete = requirements.every(item => item.status === 'complete');
  return {
    family,
    enabled,
    status: !enabled ? 'not_configured' : allComplete && enrollmentPrepared ? 'ready_for_production_authorization' : 'pending',
    requirements,
    productionTrafficAllowed: false,
  };
};

/** Tenant-safe readiness projection by fiscal document family. Secret material never leaves backstage. */
export const loadOwnFiscalStoreReadiness = async (input: { authorization: string; canonicalStoreId: unknown; }): Promise<FiscalStoreReadinessView> => {
  const authorized = await authorizeOwnFiscalStore(input);
  const canonicalStoreId = authorized.canonicalStoreId;
  const [profile, enrollmentRead, readinessSnapshot, credentialStatus] = await Promise.all([
    loadCanonicalFiscalProfileData(canonicalStoreId, canonicalStoreId),
    loadManagedFiscalStoreEnrollment(canonicalStoreId),
    adminDb.doc(`kyrub_admin/fiscal/store_readiness/${canonicalStoreId}`).get(),
    loadFiscalStoreCredentialStatus(canonicalStoreId),
  ]);
  const enrollment = enrollmentRead.enrollment ?? {};
  const backstage = readinessSnapshot.data() ?? {};
  // Enrollment only proves that managed onboarding has reached an explicit lifecycle state.
  // It never completes habilitation, provider provisioning or homologation evidence.
  const enrollmentPrepared = enrollment.status === 'prepared' || enrollment.status === 'homologation_ready' || enrollment.status === 'production_authorized';
  const configuredFamilies = backstage.families && typeof backstage.families === 'object' ? backstage.families as Record<string, unknown> : {};
  // Backward-compatible migration: the existing single-family non-secret evidence is treated as NFC-e only.
  // A1 and CSC readiness are deliberately NOT trusted from the legacy booleans anymore; they come from credential metadata.
  const legacyNfceEvidence = {
    stateDocumentEnabled: backstage.stateNfceEnabled,
    providerCompanyProvisioned: backstage.providerCompanyProvisioned,
    homologationApproved: backstage.homologationApproved,
  };
  const evidenceFor = (family: FiscalDocumentFamily): Record<string, unknown> => {
    const raw = configuredFamilies[family];
    if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
    return family === 'nfce' ? legacyNfceEvidence : {};
  };
  const enabledFor = (family: FiscalDocumentFamily): boolean => {
    const raw = configuredFamilies[family];
    if (raw && typeof raw === 'object' && 'enabled' in raw) return (raw as Record<string, unknown>).enabled === true;
    return family === 'nfce';
  };
  const families: FiscalFamilyReadinessView[] = (['nfce', 'nfe', 'nfse'] as FiscalDocumentFamily[]).map(family => buildFamily({
    family,
    enabled: enabledFor(family),
    profileComplete: profile.completeness === 'complete',
    enrollmentPrepared,
    certificateA1Configured: credentialStatus.certificateA1.configured,
    nfceCscConfigured: credentialStatus.nfceCsc.configured,
    evidence: evidenceFor(family),
  }));
  const enabledFamilies = families.filter(item => item.enabled);
  return {
    canonicalStoreId,
    status: enabledFamilies.length > 0 && enabledFamilies.every(item => item.status === 'ready_for_production_authorization') ? 'ready_for_production_authorization' : 'pending',
    families,
    productionTrafficAllowed: false,
  };
};

/** Backstage-only persistence helper. Stores non-secret completion evidence, never credential material or credential-presence authority. */
export const recordFiscalReadinessEvidence = async (input: {
  canonicalStoreId: string;
  family?: FiscalDocumentFamily;
  enabled?: boolean;
  evidence: Partial<{ stateDocumentEnabled: boolean; providerCompanyProvisioned: boolean; homologationApproved: boolean; }>;
  actorId: string;
  source: string;
}): Promise<void> => {
  const canonicalStoreId = clean(input.canonicalStoreId);
  if (!canonicalStoreId) throw new Error('FISCAL_STORE_REQUIRED');
  const family = input.family ?? 'nfce';
  if (!(['nfce', 'nfe', 'nfse'] as string[]).includes(family)) throw new Error('FISCAL_DOCUMENT_FAMILY_INVALID');
  const allowedKeys = ['stateDocumentEnabled', 'providerCompanyProvisioned', 'homologationApproved'] as const;
  const evidence: Record<string, boolean> = {};
  for (const key of allowedKeys) if (typeof input.evidence[key] === 'boolean') evidence[key] = input.evidence[key] as boolean;
  const familyUpdate: Record<string, unknown> = { ...evidence, updatedAt: FieldValue.serverTimestamp(), updatedBy: clean(input.actorId), source: clean(input.source) };
  if (typeof input.enabled === 'boolean') familyUpdate.enabled = input.enabled;
  if (!Object.keys(evidence).length && typeof input.enabled !== 'boolean') throw new Error('FISCAL_READINESS_EVIDENCE_REQUIRED');
  await adminDb.doc(`kyrub_admin/fiscal/store_readiness/${canonicalStoreId}`).set({ families: { [family]: familyUpdate }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
};

export const mapFiscalStoreReadinessError = (error: unknown): { status: number; body: { error: string; code: string } } => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED' || /id-token|expired|revoked/i.test(message)) return { status: 401, body: { error: 'Faça login novamente.', code: 'AUTH_REQUIRED' } };
  if (message === 'EMAIL_NOT_VERIFIED') return { status: 403, body: { error: 'Verifique seu e-mail para consultar a prontidão fiscal.', code: message } };
  if (message === 'FISCAL_STORE_OWNERSHIP_REQUIRED') return { status: 403, body: { error: 'A prontidão fiscal só pode ser consultada pela própria loja autenticada.', code: message } };
  if (message === 'FISCAL_STORE_NOT_FOUND') return { status: 404, body: { error: 'A loja autenticada não foi encontrada.', code: message } };
  if (message === 'FISCAL_STORE_IDENTITY_INVALID') return { status: 409, body: { error: 'A identidade canônica da loja está inconsistente.', code: message } };
  if (message === 'FISCAL_STORE_REQUIRED' || message === 'FISCAL_DOCUMENT_FAMILY_INVALID') return { status: 400, body: { error: 'A configuração fiscal informada é inválida.', code: message } };
  console.error('[Fiscal Store Readiness]', error);
  return { status: 503, body: { error: 'Não foi possível consultar a prontidão fiscal agora.', code: 'FISCAL_STORE_READINESS_FAILED' } };
};
