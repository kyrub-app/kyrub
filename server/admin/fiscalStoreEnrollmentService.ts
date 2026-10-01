import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { authorizeIntegrationReadiness } from './integrationReadinessService.js';
import { prepareManagedFiscalStoreEnrollment } from '../integrations/fiscalManagedStoreEnrollment.js';

const clean = (value: unknown, maxLength = 160): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

export interface AdminFiscalStoreEnrollmentView {
  canonicalStoreId: string;
  providerId: 'focus-nfe';
  documentFamily: 'nfce';
  environment: 'production';
  status: 'prepared';
  productionTrafficAllowed: false;
}

export const prepareAuthorizedFiscalStoreEnrollment = async (input: {
  authorization: string;
  canonicalStoreId: unknown;
}): Promise<AdminFiscalStoreEnrollmentView> => {
  const admin = await authorizeIntegrationReadiness(input.authorization);
  const canonicalStoreId = clean(input.canonicalStoreId);
  if (!canonicalStoreId) throw new Error('FISCAL_STORE_ENROLLMENT_INPUT_REQUIRED');

  const enrollment = await prepareManagedFiscalStoreEnrollment({
    canonicalStoreId,
    actorId: admin.uid,
  });

  const auditId = crypto.randomUUID().replaceAll('-', '_');
  await adminDb.doc(`kyrub_admin/control_plane/audit_logs/${auditId}`).set({
    id: auditId,
    action: 'admin.fiscal.store.prepared',
    actorId: admin.uid,
    actorRole: admin.role,
    targetType: 'store',
    targetId: canonicalStoreId,
    providerId: enrollment.providerId,
    documentFamily: enrollment.documentFamily,
    source: 'server',
    createdAt: FieldValue.serverTimestamp(),
  });

  return {
    canonicalStoreId: enrollment.canonicalStoreId,
    providerId: 'focus-nfe',
    documentFamily: 'nfce',
    environment: 'production',
    status: 'prepared',
    productionTrafficAllowed: false,
  };
};

export const mapFiscalStoreEnrollmentError = (error: unknown): { status: number; body: { error: string; code: string } } => {
  const message = error instanceof Error ? error.message : String(error);
  if (/AUTH_REQUIRED|id-token|expired|revoked/i.test(message)) return { status: 401, body: { error: 'Faça login novamente.', code: 'AUTH_REQUIRED' } };
  if (message === 'EMAIL_NOT_VERIFIED' || message === 'FORBIDDEN') return { status: 403, body: { error: 'Somente Super Admin pode preparar lojas para o Kyrub Fiscal.', code: message } };
  if (message === 'FISCAL_STORE_NOT_FOUND') return { status: 404, body: { error: 'A loja selecionada não existe.', code: message } };
  if (message === 'FISCAL_STORE_ENROLLMENT_INPUT_REQUIRED') return { status: 400, body: { error: 'Selecione uma loja válida.', code: message } };
  if (message === 'FISCAL_STORE_ENROLLMENT_STATE_REQUIRES_SEPARATE_CONTROL') return { status: 409, body: { error: 'O estado fiscal atual da loja exige um controle administrativo separado.', code: message } };
  console.error('[Admin Fiscal Store Enrollment]', error);
  return { status: 503, body: { error: 'Não foi possível preparar a loja para o Kyrub Fiscal agora.', code: 'FISCAL_STORE_ENROLLMENT_FAILED' } };
};
