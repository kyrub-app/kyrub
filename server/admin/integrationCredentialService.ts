import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { publicIntegrationCredentialView } from '../../shared/integrationCredentials.js';
import { adminDb } from '../firebaseAdmin.js';
import {
  loadPlatformCredentialMetadata,
  markPlatformCredentialValidation,
  savePlatformCredentials,
} from '../integrations/platformCredentialStore.js';
import { testMercadoPagoConnection } from '../payments/mercadoPagoPixProvider.js';
import { authorizeIntegrationReadiness } from './integrationReadinessService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const audit = async (input: {
  actorId: string;
  action: string;
  result: string;
}): Promise<void> => {
  const id = randomUUID().replaceAll('-', '_');
  await adminDb.doc(`kyrub_admin/control_plane/audit_logs/${id}`).set({
    id,
    action: input.action,
    actorId: input.actorId,
    actorRole: 'super_admin',
    targetType: 'platform_integration',
    targetId: 'mercado_pago',
    result: input.result,
    source: 'server',
    createdAt: FieldValue.serverTimestamp(),
  });
};

export const saveAuthorizedMercadoPagoCredentials = async (input: {
  authorization: string;
  accessToken: unknown;
  webhookSecret?: unknown;
}): Promise<ReturnType<typeof publicIntegrationCredentialView>> => {
  const admin = await authorizeIntegrationReadiness(input.authorization);
  const accessToken = clean(input.accessToken);
  const webhookSecret = clean(input.webhookSecret);
  if (!accessToken) throw new Error('MERCADO_PAGO_ACCESS_TOKEN_REQUIRED');
  if (accessToken.length > 4096 || webhookSecret.length > 4096) {
    throw new Error('MERCADO_PAGO_CREDENTIAL_TOO_LARGE');
  }

  const record = await savePlatformCredentials({
    providerId: 'mercado_pago',
    environment: 'production',
    credentials: {
      access_token: accessToken,
      ...(webhookSecret ? { webhook_secret: webhookSecret } : {}),
    },
  });
  await audit({
    actorId: admin.uid,
    action: 'admin.integration.mercado_pago.credentials.saved',
    result: 'configured',
  });
  return publicIntegrationCredentialView(record);
};

export const testAuthorizedMercadoPagoConnection = async (
  authorization: string
): Promise<{ ok: boolean; code: string; credential: ReturnType<typeof publicIntegrationCredentialView> | null }> => {
  const admin = await authorizeIntegrationReadiness(authorization);
  let ok = false;
  let code = 'MERCADO_PAGO_CONNECTION_FAILED';
  try {
    await testMercadoPagoConnection();
    ok = true;
    code = 'CONNECTED';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    code = message.startsWith('MERCADO_PAGO_') ? message.split(':')[0] : code;
  }

  await markPlatformCredentialValidation({
    providerId: 'mercado_pago',
    environment: 'production',
    ok,
    code,
  });
  await audit({
    actorId: admin.uid,
    action: 'admin.integration.mercado_pago.connection.tested',
    result: code,
  });
  const record = await loadPlatformCredentialMetadata('mercado_pago', 'production');
  return {
    ok,
    code,
    credential: record ? publicIntegrationCredentialView(record) : null,
  };
};

export const mapIntegrationCredentialError = (error: unknown): {
  status: number;
  body: { error: string; code: string };
} => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'MERCADO_PAGO_ACCESS_TOKEN_REQUIRED') {
    return { status: 400, body: { error: 'Informe o Access Token do Mercado Pago.', code: message } };
  }
  if (message === 'MERCADO_PAGO_CREDENTIAL_TOO_LARGE') {
    return { status: 400, body: { error: 'A credencial excede o tamanho permitido.', code: message } };
  }
  if (/AUTH_REQUIRED|id-token|expired|revoked/i.test(message)) {
    return { status: 401, body: { error: 'Faça login novamente.', code: 'AUTH_REQUIRED' } };
  }
  if (message === 'EMAIL_NOT_VERIFIED' || message === 'FORBIDDEN') {
    return { status: 403, body: { error: 'Somente Super Admin pode alterar integrações da plataforma.', code: message } };
  }
  if (/INTEGRATION_MASTER_KEY/i.test(message)) {
    return { status: 503, body: { error: 'O cofre seguro da plataforma não está disponível.', code: 'VAULT_UNAVAILABLE' } };
  }
  console.error('[Admin Integration Credentials]', error);
  return { status: 503, body: { error: 'Não foi possível concluir a operação de integração.', code: 'INTEGRATION_OPERATION_FAILED' } };
};