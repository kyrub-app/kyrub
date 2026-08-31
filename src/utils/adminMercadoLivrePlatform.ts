import type { User } from 'firebase/auth';
import type { AdminProfile } from './adminControlPlane';
import type { MercadoLivrePlatformCredentialStatus } from '../../shared/mercadoLivrePlatformCredential';

const endpoint = '/api/admin/integrations/mercado-livre';

const assertSuperAdmin = (profile: AdminProfile): void => {
  if (profile.role !== 'super_admin' || profile.status !== 'active') {
    throw new Error('Somente Super Admin pode configurar o Mercado Livre da plataforma.');
  }
};

const request = async <T>(
  user: User,
  profile: AdminProfile,
  path: string,
  init?: RequestInit
): Promise<T> => {
  assertSuperAdmin(profile);
  const token = await user.getIdToken();
  const response = await fetch(`${endpoint}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : 'Não foi possível configurar o Mercado Livre.');
  }
  return payload as T;
};

export const loadAdminMercadoLivrePlatformStatus = (
  user: User,
  profile: AdminProfile
): Promise<MercadoLivrePlatformCredentialStatus> => request(user, profile, '/status');

export const saveAdminMercadoLivrePlatformCredentials = (
  user: User,
  profile: AdminProfile,
  input: { clientId: string; clientSecret: string; redirectUri: string }
): Promise<MercadoLivrePlatformCredentialStatus> => request(user, profile, '/credentials', {
  method: 'POST',
  body: JSON.stringify(input),
});

export const validateAdminMercadoLivrePlatformConfiguration = (
  user: User,
  profile: AdminProfile
): Promise<{ ok: boolean; code: string; credential: MercadoLivrePlatformCredentialStatus }> =>
  request(user, profile, '/validate', { method: 'POST' });
