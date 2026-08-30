import type { User } from 'firebase/auth';
import type { AdminProfile } from './adminControlPlane';

export type AdminIntegrationProviderState =
  | 'configured'
  | 'partial'
  | 'not-configured'
  | 'contract-only';

export interface AdminIntegrationReadinessSnapshot {
  generatedAt: string;
  vault: {
    legacyEnvelopeConfigured: boolean;
    googleSecretManagerAdapterEnabled: boolean;
    googleSecretManagerState: 'disabled' | 'adapter-enabled-unverified';
  };
  providers: Array<{
    id: 'mercado_pago' | 'google_maps' | '99food' | 'lalamove';
    title: string;
    category: 'payments' | 'maps' | 'orders' | 'logistics';
    state: AdminIntegrationProviderState;
    credentialAuthority: 'environment' | 'legacy_envelope' | 'none';
    details: Record<string, boolean | number>;
  }>;
}

export interface AdminMercadoPagoCredentialStatus {
  accessTokenLast4: string;
  webhookSecretLast4: string;
  status: string;
  lastValidatedAt: string;
  lastValidationCode: string;
}

export interface AdminGoogleMapsCredentialStatus {
  apiKeyLast4: string;
  status: string;
  lastValidatedAt: string;
  lastValidationCode: string;
}

const PUBLIC_DETAIL_KEYS = new Set([
  'pixCheckoutConfigured',
  'webhookConfigured',
  'productionActivatedByVault',
  'apiKeyConfigured',
  'geocodingConfigured',
  'connections',
  'connected',
  'attention',
  'runtimeConfigured',
  'fallbackActivated',
]);

const safeBoolean = (value: unknown): boolean => value === true;
const safeString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const parseProviderState = (value: unknown): AdminIntegrationProviderState =>
  value === 'configured' ||
  value === 'partial' ||
  value === 'contract-only'
    ? value
    : 'not-configured';

export const parseAdminIntegrationReadiness = (
  value: unknown
): AdminIntegrationReadinessSnapshot | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const vault = candidate.vault as Record<string, unknown> | undefined;
  if (!vault || !Array.isArray(candidate.providers)) return null;

  const providers: AdminIntegrationReadinessSnapshot['providers'] = [];
  for (const item of candidate.providers) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const provider = item as Record<string, unknown>;
    const id = provider.id;
    const category = provider.category;
    const authority = provider.credentialAuthority;
    if (
      (id !== 'mercado_pago' && id !== 'google_maps' && id !== '99food' && id !== 'lalamove') ||
      (category !== 'payments' && category !== 'maps' && category !== 'orders' && category !== 'logistics') ||
      (authority !== 'environment' && authority !== 'legacy_envelope' && authority !== 'none')
    ) continue;
    const rawDetails = provider.details && typeof provider.details === 'object' && !Array.isArray(provider.details)
      ? provider.details as Record<string, unknown>
      : {};
    const details = Object.fromEntries(
      Object.entries(rawDetails).flatMap(([key, detail]) =>
        PUBLIC_DETAIL_KEYS.has(key) &&
        (typeof detail === 'boolean' || (typeof detail === 'number' && Number.isFinite(detail)))
          ? [[key, detail]]
          : []
      )
    ) as Record<string, boolean | number>;
    providers.push({
      id,
      title: safeString(provider.title),
      category,
      state: parseProviderState(provider.state),
      credentialAuthority: authority,
      details,
    });
  }

  return {
    generatedAt: safeString(candidate.generatedAt),
    vault: {
      legacyEnvelopeConfigured: safeBoolean(vault.legacyEnvelopeConfigured),
      googleSecretManagerAdapterEnabled: safeBoolean(vault.googleSecretManagerAdapterEnabled),
      googleSecretManagerState: vault.googleSecretManagerState === 'adapter-enabled-unverified'
        ? 'adapter-enabled-unverified'
        : 'disabled',
    },
    providers,
  };
};

const requireSuperAdmin = (profile: Pick<AdminProfile, 'role' | 'status'>): void => {
  if (profile.status !== 'active' || profile.role !== 'super_admin') {
    throw new Error('Somente Super Admin pode alterar integrações da plataforma.');
  }
};

const credentialRecord = (value: unknown): Record<string, unknown> => {
  const candidate = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return candidate.credential && typeof candidate.credential === 'object' && !Array.isArray(candidate.credential)
    ? candidate.credential as Record<string, unknown>
    : {};
};

const credentialSlots = (credential: Record<string, unknown>): Record<string, unknown> =>
  credential.credentials && typeof credential.credentials === 'object' && !Array.isArray(credential.credentials)
    ? credential.credentials as Record<string, unknown>
    : {};

const credentialStatus = (value: unknown): AdminMercadoPagoCredentialStatus => {
  const credential = credentialRecord(value);
  const credentials = credentialSlots(credential);
  const access = credentials.access_token && typeof credentials.access_token === 'object'
    ? credentials.access_token as Record<string, unknown>
    : {};
  const webhook = credentials.webhook_secret && typeof credentials.webhook_secret === 'object'
    ? credentials.webhook_secret as Record<string, unknown>
    : {};
  return {
    accessTokenLast4: safeString(access.last4),
    webhookSecretLast4: safeString(webhook.last4),
    status: safeString(credential.status),
    lastValidatedAt: safeString(credential.lastValidatedAt),
    lastValidationCode: safeString(credential.lastValidationCode),
  };
};

const googleMapsCredentialStatus = (value: unknown): AdminGoogleMapsCredentialStatus => {
  const credential = credentialRecord(value);
  const credentials = credentialSlots(credential);
  const apiKey = credentials.api_key && typeof credentials.api_key === 'object'
    ? credentials.api_key as Record<string, unknown>
    : {};
  return {
    apiKeyLast4: safeString(apiKey.last4),
    status: safeString(credential.status),
    lastValidatedAt: safeString(credential.lastValidatedAt),
    lastValidationCode: safeString(credential.lastValidationCode),
  };
};

export const loadAdminIntegrationReadiness = async (
  user: Pick<User, 'getIdToken'>,
  profile: Pick<AdminProfile, 'role' | 'status'>
): Promise<AdminIntegrationReadinessSnapshot> => {
  requireSuperAdmin(profile);
  const token = await user.getIdToken();
  const response = await fetch('/api/admin/operations/health?transport=integration-readiness', {
    headers: { authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Não foi possível consultar as integrações.');
  const parsed = parseAdminIntegrationReadiness(payload);
  if (!parsed) throw new Error('O servidor retornou um estado de integrações inválido.');
  return parsed;
};

const postAdminIntegration = async (
  user: Pick<User, 'getIdToken'>,
  transport: string,
  body?: unknown
): Promise<Record<string, unknown>> => {
  const token = await user.getIdToken();
  const response = await fetch(`/api/admin/operations/health?transport=${encodeURIComponent(transport)}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok && response.status !== 422) {
    throw new Error(typeof payload.error === 'string' ? payload.error : 'Não foi possível concluir a operação de integração.');
  }
  return payload;
};

export const saveAdminMercadoPagoCredentials = async (
  user: Pick<User, 'getIdToken'>,
  profile: Pick<AdminProfile, 'role' | 'status'>,
  input: { accessToken: string; webhookSecret: string }
): Promise<AdminMercadoPagoCredentialStatus> => {
  requireSuperAdmin(profile);
  return credentialStatus(await postAdminIntegration(user, 'mercado-pago-credentials', input));
};

export const testAdminMercadoPagoConnection = async (
  user: Pick<User, 'getIdToken'>,
  profile: Pick<AdminProfile, 'role' | 'status'>
): Promise<{ ok: boolean; code: string; credential: AdminMercadoPagoCredentialStatus }> => {
  requireSuperAdmin(profile);
  const payload = await postAdminIntegration(user, 'mercado-pago-test');
  return { ok: payload.ok === true, code: safeString(payload.code), credential: credentialStatus(payload) };
};

export const saveAdminGoogleMapsCredentials = async (
  user: Pick<User, 'getIdToken'>,
  profile: Pick<AdminProfile, 'role' | 'status'>,
  input: { apiKey: string }
): Promise<AdminGoogleMapsCredentialStatus> => {
  requireSuperAdmin(profile);
  return googleMapsCredentialStatus(await postAdminIntegration(user, 'google-maps-credentials', input));
};

export const testAdminGoogleMapsConnection = async (
  user: Pick<User, 'getIdToken'>,
  profile: Pick<AdminProfile, 'role' | 'status'>
): Promise<{ ok: boolean; code: string; credential: AdminGoogleMapsCredentialStatus }> => {
  requireSuperAdmin(profile);
  const payload = await postAdminIntegration(user, 'google-maps-test');
  return { ok: payload.ok === true, code: safeString(payload.code), credential: googleMapsCredentialStatus(payload) };
};
