import type { User } from 'firebase/auth';
import type { AdminProfile } from './adminControlPlane';

export interface AdminSerproCnpjCredentialStatus {
  configured: boolean;
  consumerKeyLast4: string;
  consumerSecretLast4: string;
  status: string;
  lastValidatedAt: string;
  lastValidationCode: string;
}

const safeString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const requireSuperAdmin = (
  profile: Pick<AdminProfile, 'role' | 'status'>
): void => {
  if (profile.status !== 'active' || profile.role !== 'super_admin') {
    throw new Error('Somente Super Admin pode alterar a integração SERPRO.');
  }
};

const parseCredentialStatus = (value: unknown): AdminSerproCnpjCredentialStatus => {
  const root = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const credential = root.credential && typeof root.credential === 'object' && !Array.isArray(root.credential)
    ? root.credential as Record<string, unknown>
    : {};
  const credentials = credential.credentials && typeof credential.credentials === 'object' && !Array.isArray(credential.credentials)
    ? credential.credentials as Record<string, unknown>
    : {};
  const consumerKey = credentials.consumer_key && typeof credentials.consumer_key === 'object'
    ? credentials.consumer_key as Record<string, unknown>
    : {};
  const consumerSecret = credentials.consumer_secret && typeof credentials.consumer_secret === 'object'
    ? credentials.consumer_secret as Record<string, unknown>
    : {};
  return {
    configured: Boolean(consumerKey.configured && consumerSecret.configured),
    consumerKeyLast4: safeString(consumerKey.last4),
    consumerSecretLast4: safeString(consumerSecret.last4),
    status: safeString(credential.status),
    lastValidatedAt: safeString(credential.lastValidatedAt),
    lastValidationCode: safeString(credential.lastValidationCode),
  };
};

const request = async (
  user: Pick<User, 'getIdToken'>,
  transport: string,
  method: 'GET' | 'POST',
  body?: unknown
): Promise<{ response: Response; payload: Record<string, unknown> }> => {
  const token = await user.getIdToken();
  const response = await fetch(
    `/api/admin/operations/health?transport=${encodeURIComponent(transport)}`,
    {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }
  );
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok && response.status !== 422) {
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : 'Não foi possível concluir a operação SERPRO.'
    );
  }
  return { response, payload };
};

export const loadAdminSerproCnpjCredentialStatus = async (
  user: Pick<User, 'getIdToken'>,
  profile: Pick<AdminProfile, 'role' | 'status'>
): Promise<AdminSerproCnpjCredentialStatus> => {
  requireSuperAdmin(profile);
  const { payload } = await request(user, 'serpro-cnpj-status', 'GET');
  return parseCredentialStatus(payload);
};

export const saveAdminSerproCnpjCredentials = async (
  user: Pick<User, 'getIdToken'>,
  profile: Pick<AdminProfile, 'role' | 'status'>,
  input: { consumerKey: string; consumerSecret: string }
): Promise<AdminSerproCnpjCredentialStatus> => {
  requireSuperAdmin(profile);
  const { payload } = await request(
    user,
    'serpro-cnpj-credentials',
    'POST',
    input
  );
  return parseCredentialStatus(payload);
};

export const testAdminSerproCnpjAuthentication = async (
  user: Pick<User, 'getIdToken'>,
  profile: Pick<AdminProfile, 'role' | 'status'>
): Promise<{ ok: boolean; code: string; credential: AdminSerproCnpjCredentialStatus }> => {
  requireSuperAdmin(profile);
  const { payload } = await request(user, 'serpro-cnpj-test', 'POST');
  return {
    ok: payload.ok === true,
    code: safeString(payload.code),
    credential: parseCredentialStatus(payload),
  };
};
