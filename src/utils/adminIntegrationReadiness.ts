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
    id: 'mercado_pago' | '99food' | 'lalamove';
    title: string;
    category: 'payments' | 'orders' | 'logistics';
    state: AdminIntegrationProviderState;
    credentialAuthority: 'environment' | 'legacy_envelope' | 'none';
    details: Record<string, boolean | number | string>;
  }>;
}

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

  const providers = candidate.providers.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const provider = item as Record<string, unknown>;
    const id = provider.id;
    const category = provider.category;
    const authority = provider.credentialAuthority;
    if (
      (id !== 'mercado_pago' && id !== '99food' && id !== 'lalamove') ||
      (category !== 'payments' && category !== 'orders' && category !== 'logistics') ||
      (authority !== 'environment' && authority !== 'legacy_envelope' && authority !== 'none')
    ) {
      return [];
    }
    const rawDetails = provider.details && typeof provider.details === 'object' && !Array.isArray(provider.details)
      ? provider.details as Record<string, unknown>
      : {};
    const details = Object.fromEntries(
      Object.entries(rawDetails).flatMap(([key, detail]) =>
        typeof detail === 'boolean' || typeof detail === 'string' || typeof detail === 'number'
          ? [[key, detail]]
          : []
      )
    ) as Record<string, boolean | number | string>;
    return [{
      id,
      title: safeString(provider.title),
      category,
      state: parseProviderState(provider.state),
      credentialAuthority: authority,
      details,
    }];
  });

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

export const loadAdminIntegrationReadiness = async (
  user: Pick<User, 'getIdToken'>,
  profile: Pick<AdminProfile, 'role' | 'status'>
): Promise<AdminIntegrationReadinessSnapshot> => {
  if (profile.status !== 'active' || profile.role !== 'super_admin') {
    throw new Error('Somente Super Admin pode consultar integrações da plataforma.');
  }
  const token = await user.getIdToken();
  const response = await fetch(
    '/api/admin/operations/health?transport=integration-readiness',
    { headers: { authorization: `Bearer ${token}` } }
  );
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : 'Não foi possível consultar as integrações.'
    );
  }
  const parsed = parseAdminIntegrationReadiness(payload);
  if (!parsed) throw new Error('O servidor retornou um estado de integrações inválido.');
  return parsed;
};
