import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { publicIntegrationCredentialView, type KyrubIntegrationEnvironment } from '../../shared/integrationCredentials.js';
import { adminDb } from '../firebaseAdmin.js';
import {
  loadPlatformCredentialMetadata,
  markPlatformCredentialValidation,
  resolvePlatformCredentials,
  savePlatformCredentials,
} from '../integrations/platformCredentialStore.js';
import { authorizeIntegrationReadiness } from './integrationReadinessService.js';

const PROVIDER_ID = 'focus_nfe' as const;
const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const FOCUS_BASE_URL: Record<KyrubIntegrationEnvironment, string> = {
  sandbox: 'https://homologacao.focusnfe.com.br',
  production: 'https://api.focusnfe.com.br',
};

const environment = (value: unknown): KyrubIntegrationEnvironment => {
  const candidate = clean(value);
  if (candidate === 'sandbox' || candidate === 'production') return candidate;
  throw new Error('FOCUS_NFE_ENVIRONMENT_INVALID');
};

const audit = async (input: { actorId: string; action: string; result: string; environment: KyrubIntegrationEnvironment }): Promise<void> => {
  const id = randomUUID().replaceAll('-', '_');
  await adminDb.doc(`kyrub_admin/control_plane/audit_logs/${id}`).set({
    id,
    action: input.action,
    actorId: input.actorId,
    actorRole: 'super_admin',
    targetType: 'platform_integration',
    targetId: `${PROVIDER_ID}:${input.environment}`,
    result: input.result,
    source: 'server',
    createdAt: FieldValue.serverTimestamp(),
  });
};

const probeFocusCredential = async (token: string, targetEnvironment: KyrubIntegrationEnvironment): Promise<{ ok: boolean; code: string }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${FOCUS_BASE_URL[targetEnvironment]}/v2/empresas?offset=0`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Basic ${Buffer.from(`${token}:`, 'utf8').toString('base64')}`,
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (response.ok) return { ok: true, code: 'FOCUS_REMOTE_AUTHENTICATED' };
    if (response.status === 401 || response.status === 403) return { ok: false, code: 'FOCUS_REMOTE_UNAUTHORIZED' };
    if (response.status === 404 && targetEnvironment === 'sandbox') return { ok: false, code: 'FOCUS_SANDBOX_COMPANY_API_UNAVAILABLE' };
    if (response.status === 429) return { ok: false, code: 'FOCUS_REMOTE_RATE_LIMITED' };
    return { ok: false, code: `FOCUS_REMOTE_HTTP_${response.status}` };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return { ok: false, code: 'FOCUS_REMOTE_TIMEOUT' };
    return { ok: false, code: 'FOCUS_REMOTE_UNREACHABLE' };
  } finally {
    clearTimeout(timeout);
  }
};

export const loadAuthorizedFiscalPlatformCredentialStatus = async (authorization: string, rawEnvironment: unknown) => {
  await authorizeIntegrationReadiness(authorization);
  const targetEnvironment = environment(rawEnvironment);
  const record = await loadPlatformCredentialMetadata(PROVIDER_ID, targetEnvironment);
  return {
    providerId: PROVIDER_ID,
    environment: targetEnvironment,
    configured: Boolean(record?.credentials.token),
    credential: record ? publicIntegrationCredentialView(record) : null,
    capabilities: ['nfce', 'nfe', 'nfse'] as const,
  };
};

export const saveAuthorizedFiscalPlatformCredential = async (input: {
  authorization: string;
  environment: unknown;
  token: unknown;
}) => {
  const admin = await authorizeIntegrationReadiness(input.authorization);
  const targetEnvironment = environment(input.environment);
  const token = clean(input.token);
  if (!token) throw new Error('FOCUS_NFE_TOKEN_REQUIRED');
  if (token.length > 4096) throw new Error('FOCUS_NFE_CREDENTIAL_TOO_LARGE');
  const record = await savePlatformCredentials({
    providerId: PROVIDER_ID,
    environment: targetEnvironment,
    credentials: { token },
  });
  await audit({
    actorId: admin.uid,
    action: 'admin.integration.focus_nfe.credentials.saved',
    result: 'configured',
    environment: targetEnvironment,
  });
  return publicIntegrationCredentialView(record);
};

export const validateAuthorizedFiscalPlatformCredential = async (authorization: string, rawEnvironment: unknown) => {
  const admin = await authorizeIntegrationReadiness(authorization);
  const targetEnvironment = environment(rawEnvironment);
  const credentials = await resolvePlatformCredentials(PROVIDER_ID, targetEnvironment);
  const token = clean(credentials?.token);
  if (!token) throw new Error('FOCUS_NFE_TOKEN_REQUIRED');

  const probe = await probeFocusCredential(token, targetEnvironment);
  await markPlatformCredentialValidation({ providerId: PROVIDER_ID, environment: targetEnvironment, ok: probe.ok, code: probe.code });
  await audit({
    actorId: admin.uid,
    action: 'admin.integration.focus_nfe.credentials.remote_validated',
    result: probe.code,
    environment: targetEnvironment,
  });
  const record = await loadPlatformCredentialMetadata(PROVIDER_ID, targetEnvironment);
  return { ok: probe.ok, code: probe.code, credential: record ? publicIntegrationCredentialView(record) : null };
};

export const mapFiscalPlatformCredentialError = (error: unknown): { status: number; body: { error: string; code: string } } => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'FOCUS_NFE_TOKEN_REQUIRED') return { status: 400, body: { error: 'Informe o token da Focus NFe.', code: message } };
  if (message === 'FOCUS_NFE_ENVIRONMENT_INVALID') return { status: 400, body: { error: 'Selecione homologação ou produção.', code: message } };
  if (message === 'FOCUS_NFE_CREDENTIAL_TOO_LARGE') return { status: 400, body: { error: 'A credencial excede o tamanho permitido.', code: message } };
  if (/AUTH_REQUIRED|id-token|expired|revoked/i.test(message)) return { status: 401, body: { error: 'Faça login novamente.', code: 'AUTH_REQUIRED' } };
  if (message === 'EMAIL_NOT_VERIFIED' || message === 'FORBIDDEN') return { status: 403, body: { error: 'Somente Super Admin pode alterar a integração fiscal da plataforma.', code: message } };
  if (/INTEGRATION_MASTER_KEY/i.test(message)) return { status: 503, body: { error: 'O cofre seguro da plataforma não está disponível.', code: 'VAULT_UNAVAILABLE' } };
  console.error('[Admin Fiscal Platform Credentials]', message);
  return { status: 503, body: { error: 'Não foi possível concluir a configuração fiscal da plataforma.', code: 'FISCAL_PLATFORM_OPERATION_FAILED' } };
};