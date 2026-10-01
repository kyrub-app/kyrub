import type { User } from 'firebase/auth';
import type { AdminProfile } from './adminControlPlane';

export interface AdminFocusCredentialStatus {
  configured: boolean;
  tokenLast4: string;
  status: string;
  lastValidatedAt: string;
  lastValidationCode: string;
  capabilities: Array<'nfce' | 'nfe' | 'nfse'>;
}

const safeString = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const requireSuperAdmin = (profile: Pick<AdminProfile, 'role' | 'status'>): void => {
  if (profile.status !== 'active' || profile.role !== 'super_admin') throw new Error('Somente Super Admin pode alterar o fornecedor fiscal da plataforma.');
};
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const parse = (value: unknown): AdminFocusCredentialStatus => {
  const payload = record(value);
  const credential = record(payload.credential);
  const credentials = record(credential.credentials);
  const token = record(credentials.token);
  const capabilities = Array.isArray(payload.capabilities) ? payload.capabilities.filter((item): item is 'nfce' | 'nfe' | 'nfse' => item === 'nfce' || item === 'nfe' || item === 'nfse') : ['nfce', 'nfe', 'nfse'];
  return { configured: payload.configured === true || token.configured === true, tokenLast4: safeString(token.last4), status: safeString(credential.status), lastValidatedAt: safeString(credential.lastValidatedAt), lastValidationCode: safeString(credential.lastValidationCode), capabilities };
};
const tokenFor = async (user: Pick<User, 'getIdToken'>): Promise<string> => user.getIdToken();

export const loadAdminFocusCredentialStatus = async (user: Pick<User, 'getIdToken'>, profile: Pick<AdminProfile, 'role' | 'status'>): Promise<AdminFocusCredentialStatus> => {
  requireSuperAdmin(profile);
  const response = await fetch('/api/admin/operations/health?transport=fiscal-platform-status&environment=production', { headers: { authorization: `Bearer ${await tokenFor(user)}` }, cache: 'no-store' });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(safeString(payload.error) || 'Não foi possível consultar a Focus.');
  return parse(payload);
};

export const saveAdminFocusCredential = async (user: Pick<User, 'getIdToken'>, profile: Pick<AdminProfile, 'role' | 'status'>, focusToken: string): Promise<AdminFocusCredentialStatus> => {
  requireSuperAdmin(profile);
  const response = await fetch('/api/admin/operations/health?transport=fiscal-platform-credentials', { method: 'POST', headers: { authorization: `Bearer ${await tokenFor(user)}`, 'content-type': 'application/json' }, body: JSON.stringify({ environment: 'production', token: focusToken }) });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(safeString(payload.error) || 'Não foi possível salvar a credencial da Focus.');
  return parse({ credential: payload, configured: true, capabilities: ['nfce', 'nfe', 'nfse'] });
};

export const testAdminFocusConnection = async (user: Pick<User, 'getIdToken'>, profile: Pick<AdminProfile, 'role' | 'status'>): Promise<{ ok: boolean; code: string; credential: AdminFocusCredentialStatus }> => {
  requireSuperAdmin(profile);
  const response = await fetch('/api/admin/operations/health?transport=fiscal-platform-validate', { method: 'POST', headers: { authorization: `Bearer ${await tokenFor(user)}`, 'content-type': 'application/json' }, body: JSON.stringify({ environment: 'production' }) });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok && response.status !== 422) throw new Error(safeString(payload.error) || 'Não foi possível testar a conexão com a Focus.');
  return { ok: payload.ok === true, code: safeString(payload.code), credential: parse({ credential: payload.credential, configured: true, capabilities: ['nfce', 'nfe', 'nfse'] }) };
};