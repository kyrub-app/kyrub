import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  loadPlatformCredentialMetadata,
  markPlatformCredentialValidation,
  resolvePlatformCredentials,
  savePlatformCredentials,
} from '../integrations/platformCredentialStore.js';
import { authorizeIntegrationReadiness } from './integrationReadinessService.js';

const PROVIDER = '99food' as const;

type Environment = 'sandbox' | 'production';

const clean = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string' ? value.trim().slice(0, maximum) : '';

const normalizeUrl = (value: unknown, required: boolean): string => {
  const raw = clean(value);
  if (!raw && !required) return '';
  if (!raw) throw new Error('NINETY_NINE_FOOD_PLATFORM_BASE_URL_REQUIRED');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('NINETY_NINE_FOOD_PLATFORM_URL_INVALID');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('NINETY_NINE_FOOD_PLATFORM_URL_INVALID');
  }
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
};

const environmentOf = (value: unknown): Environment =>
  value === 'production' ? 'production' : 'sandbox';

const audit = async (input: { actorId: string; environment: Environment; action: string; result: string }) => {
  const id = randomUUID().replaceAll('-', '_');
  await adminDb.doc(`kyrub_admin/control_plane/audit_logs/${id}`).set({
    id,
    action: input.action,
    actorId: input.actorId,
    actorRole: 'super_admin',
    targetType: 'platform_integration',
    targetId: `${PROVIDER}:${input.environment}`,
    result: input.result,
    source: 'server',
    createdAt: FieldValue.serverTimestamp(),
  });
};

export interface NinetyNineFoodPlatformCredentialStatus {
  provider: typeof PROVIDER;
  environment: Environment;
  configured: boolean;
  validated: boolean;
  clientIdLast4: string;
  clientSecretLast4: string;
  baseUrlConfigured: boolean;
  tokenUrlConfigured: boolean;
  lastValidatedAt: string;
  validationCode: string;
}

const status = async (environment: Environment): Promise<NinetyNineFoodPlatformCredentialStatus> => {
  const metadata = await loadPlatformCredentialMetadata(PROVIDER, environment);
  return {
    provider: PROVIDER,
    environment,
    configured: Boolean(
      metadata?.credentials.client_id &&
      metadata.credentials.client_secret &&
      metadata.credentials.base_url
    ),
    validated: metadata?.status === 'validated',
    clientIdLast4: metadata?.credentials.client_id?.last4 ?? '',
    clientSecretLast4: metadata?.credentials.client_secret?.last4 ?? '',
    baseUrlConfigured: Boolean(metadata?.credentials.base_url),
    tokenUrlConfigured: Boolean(metadata?.credentials.token_url),
    lastValidatedAt: metadata?.lastValidatedAt ?? '',
    validationCode: metadata?.lastValidationCode ?? '',
  };
};

export const loadAuthorizedNinetyNineFoodPlatformCredentialStatus = async (
  authorization: string,
  environmentValue: unknown
): Promise<NinetyNineFoodPlatformCredentialStatus> => {
  await authorizeIntegrationReadiness(authorization);
  return status(environmentOf(environmentValue));
};

export const saveAuthorizedNinetyNineFoodPlatformCredentials = async (input: {
  authorization: string;
  environment: unknown;
  clientId: unknown;
  clientSecret: unknown;
  baseUrl: unknown;
  tokenUrl?: unknown;
}): Promise<NinetyNineFoodPlatformCredentialStatus> => {
  const admin = await authorizeIntegrationReadiness(input.authorization);
  const environment = environmentOf(input.environment);
  const clientId = clean(input.clientId, 500);
  const clientSecret = clean(input.clientSecret, 2_000);
  if (!clientId || !clientSecret) {
    throw new Error('NINETY_NINE_FOOD_PLATFORM_CREDENTIALS_REQUIRED');
  }
  const baseUrl = normalizeUrl(input.baseUrl, true);
  const tokenUrl = normalizeUrl(input.tokenUrl, false) || new URL('/oauth/token', `${baseUrl}/`).toString();

  await savePlatformCredentials({
    providerId: PROVIDER,
    environment,
    credentials: {
      client_id: clientId,
      client_secret: clientSecret,
      base_url: baseUrl,
      token_url: tokenUrl,
    },
  });
  await audit({
    actorId: admin.uid,
    environment,
    action: 'admin.integration.99food.credentials.saved',
    result: 'configured',
  });
  return status(environment);
};

export const validateAuthorizedNinetyNineFoodPlatformConfiguration = async (input: {
  authorization: string;
  environment: unknown;
}): Promise<{ ok: boolean; code: string; credential: NinetyNineFoodPlatformCredentialStatus }> => {
  const admin = await authorizeIntegrationReadiness(input.authorization);
  const environment = environmentOf(input.environment);
  let ok = false;
  let code = 'NINETY_NINE_FOOD_PLATFORM_CONFIGURATION_INVALID';
  try {
    const stored = await resolvePlatformCredentials(PROVIDER, environment);
    if (!clean(stored?.client_id, 500) || !clean(stored?.client_secret, 2_000)) {
      throw new Error('NINETY_NINE_FOOD_PLATFORM_CREDENTIALS_REQUIRED');
    }
    normalizeUrl(stored?.base_url, true);
    normalizeUrl(stored?.token_url, true);
    ok = true;
    code = 'CONFIGURATION_VALID';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('NINETY_NINE_FOOD_')) code = message.split(':')[0];
  }

  await markPlatformCredentialValidation({ providerId: PROVIDER, environment, ok, code });
  await audit({
    actorId: admin.uid,
    environment,
    action: 'admin.integration.99food.configuration.validated',
    result: code,
  });
  return { ok, code, credential: await status(environment) };
};
