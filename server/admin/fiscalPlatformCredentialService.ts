import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { publicIntegrationCredentialView } from '../../shared/integrationCredentials.js';
import { adminDb } from '../firebaseAdmin.js';
import {
  loadPlatformCredentialMetadata,
  markPlatformCredentialValidation,
  resolvePlatformCredentials,
  savePlatformCredentials,
} from '../integrations/platformCredentialStore.js';
import { authorizeIntegrationReadiness } from './integrationReadinessService.js';

const PROVIDER_ID = 'focus_nfe' as const;
const PLATFORM_ENVIRONMENT = 'production' as const;
const FOCUS_COMPANY_API = 'https://api.focusnfe.com.br/v2/empresas';
const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const audit = async (input: { actorId: string; action: string; result: string }): Promise<void> => {
  const id = randomUUID().replaceAll('-', '_');
  await adminDb.doc(`kyrub_admin/control_plane/audit_logs/${id}`).set({
    id,
    action: input.action,
    actorId: input.actorId,
    actorRole: 'super_admin',
    targetType: 'platform_integration',
    targetId: `${PROVIDER_ID}:platform_authority`,
    result: input.result,
    source: 'server',
    createdAt: FieldValue.serverTimestamp(),
  });
};

const probePlatformAuthority = async (token: string): Promise<{ ok: boolean; code: string }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    // Focus' company-management API is production-only. This probe validates the
    // Kyrub platform/master authority; it does not validate any tenant issuer token.
    const response = await fetch(`${FOCUS_COMPANY_API}?offset=0`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Basic ${Buffer.from(`${token}:`, 'utf8').toString('base64')}`,
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (response.ok) return { ok: true, code: 'FOCUS_PLATFORM_AUTHORITY_VALIDATED' };
    if (response.status === 401 || response.status === 403) return { ok: false, code: 'FOCUS_PLATFORM_AUTHORITY_UNAUTHORIZED' };
    if (response.status === 429) return { ok: false, code: 'FOCUS_PLATFORM_AUTHORITY_RATE_LIMITED' };
    return { ok: false, code: `FOCUS_PLATFORM_AUTHORITY_HTTP_${response.status}` };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return { ok: false, code: 'FOCUS_PLATFORM_AUTHORITY_TIMEOUT' };
    return { ok: false, code: 'FOCUS_PLATFORM_AUTHORITY_UNREACHABLE' };
  } finally {
    clearTimeout(timeout);
  }
};

export const loadAuthorizedFiscalPlatformCredentialStatus = async (authorization: string) => {
  await authorizeIntegrationReadiness(authorization);
  const record = await loadPlatformCredentialMetadata(PROVIDER_ID, PLATFORM_ENVIRONMENT);
  return {
    providerId: PROVIDER_ID,
    authorityType: 'platform_master_production',
    environment: PLATFORM_ENVIRONMENT,
    configured: Boolean(record?.credentials.token),
    credential: record ? publicIntegrationCredentialView(record) : null,
    capabilities: ['company_provisioning', 'nfce', 'nfe', 'nfse'] as const,
    issuerCredentialPolicy: {
      scope: 'per_provisioned_company',
      storedServerSideOnly: true,
      exposedToTenant: false,
      productionTokenFromProvisioning: true,
      homologationTokenFromProvisioning: true,
    },
  };
};

export const saveAuthorizedFiscalPlatformCredential = async (input: { authorization: string; token: unknown }) => {
  const admin = await authorizeIntegrationReadiness(input.authorization);
  const token = clean(input.token);
  if (!token) throw new Error('FOCUS_PLATFORM_TOKEN_REQUIRED');
  if (token.length > 4096) throw new Error('FOCUS_NFE_CREDENTIAL_TOO_LARGE');
  const record = await savePlatformCredentials({ providerId: PROVIDER_ID, environment: PLATFORM_ENVIRONMENT, credentials: { token } });
  await audit({ actorId: admin.uid, action: 'admin.integration.focus_nfe.platform_authority.saved', result: 'configured' });
  return publicIntegrationCredentialView(record);
};

export const validateAuthorizedFiscalPlatformCredential = async (authorization: string) => {
  const admin = await authorizeIntegrationReadiness(authorization);
  const credentials = await resolvePlatformCredentials(PROVIDER_ID, PLATFORM_ENVIRONMENT);
  const token = clean(credentials?.token);
  if (!token) throw new Error('FOCUS_PLATFORM_TOKEN_REQUIRED');
  const probe = await probePlatformAuthority(token);
  await markPlatformCredentialValidation({ providerId: PROVIDER_ID, environment: PLATFORM_ENVIRONMENT, ok: probe.ok, code: probe.code });
  await audit({ actorId: admin.uid, action: 'admin.integration.focus_nfe.platform_authority.remote_validated', result: probe.code });
  const record = await loadPlatformCredentialMetadata(PROVIDER_ID, PLATFORM_ENVIRONMENT);
  return { ok: probe.ok, code: probe.code, authorityType: 'platform_master_production', credential: record ? publicIntegrationCredentialView(record) : null };
};

export const mapFiscalPlatformCredentialError = (error: unknown): { status: number; body: { error: string; code: string } } => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'FOCUS_PLATFORM_TOKEN_REQUIRED') return { status: 400, body: { error: 'Informe o token principal de produção da Focus NFe.', code: message } };
  if (message === 'FOCUS_NFE_CREDENTIAL_TOO_LARGE') return { status: 400, body: { error: 'A credencial excede o tamanho permitido.', code: message } };
  if (/AUTH_REQUIRED|id-token|expired|revoked/i.test(message)) return { status: 401, body: { error: 'Faça login novamente.', code: 'AUTH_REQUIRED' } };
  if (message === 'EMAIL_NOT_VERIFIED' || message === 'FORBIDDEN') return { status: 403, body: { error: 'Somente Super Admin pode alterar a integração fiscal da plataforma.', code: message } };
  if (/INTEGRATION_MASTER_KEY/i.test(message)) return { status: 503, body: { error: 'O cofre seguro da plataforma não está disponível.', code: 'VAULT_UNAVAILABLE' } };
  console.error('[Admin Fiscal Platform Credentials]', message);
  return { status: 503, body: { error: 'Não foi possível concluir a configuração fiscal da plataforma.', code: 'FISCAL_PLATFORM_OPERATION_FAILED' } };
};