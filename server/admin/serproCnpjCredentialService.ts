import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { publicIntegrationCredentialView } from '../../shared/integrationCredentials.js';
import {
  SERPRO_CNPJ_TOKEN_ENDPOINT,
  assertSerproCnpjCredentials,
} from '../../shared/serproCnpjIntegration.js';
import { adminDb } from '../firebaseAdmin.js';
import {
  loadPlatformCredentialMetadata,
  markPlatformCredentialValidation,
  resolvePlatformCredentials,
  savePlatformCredentials,
} from '../integrations/platformCredentialStore.js';
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
    targetId: 'serpro_cnpj',
    result: input.result,
    source: 'server',
    createdAt: FieldValue.serverTimestamp(),
  });
};

const publicMetadata = async () => {
  const record = await loadPlatformCredentialMetadata('serpro_cnpj', 'production');
  return record ? publicIntegrationCredentialView(record) : null;
};

export const loadAuthorizedSerproCnpjCredentialStatus = async (
  authorization: string
): Promise<{ credential: Awaited<ReturnType<typeof publicMetadata>> }> => {
  await authorizeIntegrationReadiness(authorization);
  return { credential: await publicMetadata() };
};

export const saveAuthorizedSerproCnpjCredentials = async (input: {
  authorization: string;
  consumerKey: unknown;
  consumerSecret: unknown;
}): Promise<{ credential: NonNullable<Awaited<ReturnType<typeof publicMetadata>>> }> => {
  const admin = await authorizeIntegrationReadiness(input.authorization);
  const credentials = assertSerproCnpjCredentials({
    consumerKey: input.consumerKey,
    consumerSecret: input.consumerSecret,
  });
  const record = await savePlatformCredentials({
    providerId: 'serpro_cnpj',
    environment: 'production',
    credentials: {
      consumer_key: credentials.consumerKey,
      consumer_secret: credentials.consumerSecret,
    },
  });
  await audit({
    actorId: admin.uid,
    action: 'admin.integration.serpro_cnpj.credentials.saved',
    result: 'configured',
  });
  return { credential: publicIntegrationCredentialView(record) };
};

export const testAuthorizedSerproCnpjAuthentication = async (
  authorization: string
): Promise<{
  ok: boolean;
  code: string;
  credential: Awaited<ReturnType<typeof publicMetadata>>;
}> => {
  const admin = await authorizeIntegrationReadiness(authorization);
  let ok = false;
  let code = 'SERPRO_CNPJ_AUTHENTICATION_FAILED';

  try {
    const stored = await resolvePlatformCredentials('serpro_cnpj', 'production');
    const credentials = assertSerproCnpjCredentials({
      consumerKey: stored?.consumer_key,
      consumerSecret: stored?.consumer_secret,
    });
    const basic = Buffer.from(
      `${credentials.consumerKey}:${credentials.consumerSecret}`,
      'utf8'
    ).toString('base64');
    const response = await fetch(SERPRO_CNPJ_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    const accessToken = clean(payload.access_token);
    const oauthError = clean(payload.error);
    ok = response.ok && Boolean(accessToken);
    code = ok
      ? 'AUTHENTICATED'
      : oauthError
        ? `SERPRO_${oauthError.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 80)}`
        : `HTTP_${response.status}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('SERPRO_CNPJ_')) code = message.split(':')[0];
  }

  await markPlatformCredentialValidation({
    providerId: 'serpro_cnpj',
    environment: 'production',
    ok,
    code,
  });
  await audit({
    actorId: admin.uid,
    action: 'admin.integration.serpro_cnpj.authentication.tested',
    result: code,
  });
  return { ok, code, credential: await publicMetadata() };
};

export const mapSerproCnpjCredentialError = (
  error: unknown
): { status: number; body: { error: string; code: string } } => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'SERPRO_CNPJ_CONSUMER_KEY_REQUIRED') {
    return { status: 400, body: { error: 'Informe a Consumer Key do SERPRO.', code: message } };
  }
  if (message === 'SERPRO_CNPJ_CONSUMER_SECRET_REQUIRED') {
    return { status: 400, body: { error: 'Informe a Consumer Secret do SERPRO.', code: message } };
  }
  if (message === 'SERPRO_CNPJ_CREDENTIAL_TOO_LARGE') {
    return { status: 400, body: { error: 'A credencial SERPRO excede o tamanho permitido.', code: message } };
  }
  if (/AUTH_REQUIRED|id-token|expired|revoked/i.test(message)) {
    return { status: 401, body: { error: 'Faça login novamente.', code: 'AUTH_REQUIRED' } };
  }
  if (message === 'EMAIL_NOT_VERIFIED' || message === 'FORBIDDEN') {
    return { status: 403, body: { error: 'Somente Super Admin pode alterar a integração SERPRO.', code: message } };
  }
  if (/INTEGRATION_MASTER_KEY/i.test(message)) {
    return { status: 503, body: { error: 'O cofre seguro da plataforma não está disponível.', code: 'VAULT_UNAVAILABLE' } };
  }
  console.error('[Admin SERPRO CNPJ]', error);
  return {
    status: 503,
    body: {
      error: 'Não foi possível concluir a operação com a integração SERPRO.',
      code: 'SERPRO_CNPJ_OPERATION_FAILED',
    },
  };
};
