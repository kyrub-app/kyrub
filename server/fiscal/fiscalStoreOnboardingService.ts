import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { prepareManagedFiscalStoreEnrollment } from '../integrations/fiscalManagedStoreEnrollment.js';
import { authorizeOwnFiscalStore } from './fiscalStoreAuthorization.js';

export interface FiscalStoreOnboardingView {
  canonicalStoreId: string;
  status: 'prepared';
  productionTrafficAllowed: false;
}

/**
 * Tenant-facing entrypoint for Kyrub Fiscal onboarding.
 *
 * The caller may only prepare the canonical store whose document id matches the
 * authenticated Firebase uid. This mirrors the current one-store-per-user ERP
 * authority and deliberately does not expose provider identity or production
 * authorization to the tenant runtime.
 */
export const prepareOwnFiscalStoreOnboarding = async (input: {
  authorization: string;
  canonicalStoreId: unknown;
}): Promise<FiscalStoreOnboardingView> => {
  const authorized = await authorizeOwnFiscalStore({ ...input, storeRequiredCode: 'FISCAL_STORE_ENROLLMENT_INPUT_REQUIRED' });
  const canonicalStoreId = authorized.canonicalStoreId;

  const enrollment = await prepareManagedFiscalStoreEnrollment({
    canonicalStoreId,
    actorId: authorized.actorId,
  });

  const auditId = crypto.randomUUID().replaceAll('-', '_');
  await adminDb.doc(`kyrub_admin/control_plane/audit_logs/${auditId}`).set({
    id: auditId, action: 'store.fiscal.onboarding.prepared',
    actorId: authorized.actorId,
    actorRole: 'store_owner',
    targetType: 'store',
    targetId: canonicalStoreId,
    source: 'server',
    createdAt: FieldValue.serverTimestamp(),
  });

  return {
    canonicalStoreId: enrollment.canonicalStoreId,
    status: 'prepared',
    productionTrafficAllowed: false,
  };
};

export const mapFiscalStoreOnboardingError = (error: unknown): { status: number; body: { error: string; code: string } } => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED' || /id-token|expired|revoked/i.test(message)) return { status: 401, body: { error: 'Faça login novamente.', code: 'AUTH_REQUIRED' } };
  if (message === 'EMAIL_NOT_VERIFIED') return { status: 403, body: { error: 'Verifique seu e-mail antes de configurar a emissão fiscal.', code: message } };
  if (message === 'FISCAL_STORE_OWNERSHIP_REQUIRED') return { status: 403, body: { error: 'A configuração fiscal só pode ser iniciada pela própria loja autenticada.', code: message } };
  if (message === 'FISCAL_STORE_NOT_FOUND') return { status: 404, body: { error: 'A loja autenticada não foi encontrada.', code: message } };
  if (message === 'FISCAL_STORE_IDENTITY_INVALID') return { status: 409, body: { error: 'A identidade canônica da loja está inconsistente.', code: message } };
  if (message === 'FISCAL_STORE_ENROLLMENT_INPUT_REQUIRED') return { status: 400, body: { error: 'Não foi possível identificar a loja ativa.', code: message } };
  if (message === 'FISCAL_STORE_ENROLLMENT_STATE_REQUIRES_SEPARATE_CONTROL') return { status: 409, body: { error: 'O estado fiscal atual da loja exige um controle separado.', code: message } };
  console.error('[Fiscal Store Onboarding]', error);
  return { status: 503, body: { error: 'Não foi possível iniciar a configuração fiscal agora.', code: 'FISCAL_STORE_ONBOARDING_FAILED' } };
};