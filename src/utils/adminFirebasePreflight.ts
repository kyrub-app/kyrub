import type { User } from 'firebase/auth';
import type { AdminProfile } from './adminControlPlane';

export type PreflightStatus = { status: 'PASS' | 'FAIL'; code: string | null };
const fail = (code: string): PreflightStatus => ({ status: 'FAIL', code });
const codes = new Set(['AUTH_REQUIRED', 'AUTH_INVALID', 'FORBIDDEN', 'AUTHORIZED_RUNTIME_REQUIRED',
  'FIREBASE_CREDENTIAL_UNAVAILABLE', 'FIREBASE_CREDENTIAL_INVALID', 'FIREBASE_PROJECT_MISMATCH',
  'ADMIN_AUTH_UNAVAILABLE', 'FIREBASE_READ_FAILED', 'PREFLIGHT_TIMEOUT', 'PREFLIGHT_UNAVAILABLE', 'METHOD_NOT_ALLOWED']);

export const isFirebasePreflightPreview = (hostname: string, search: string): boolean =>
  hostname.endsWith('.vercel.app') && new URLSearchParams(search).get('kyrub_admin_preview') === '1';

export const canRunFirebasePreflight = (user: Pick<User, 'uid' | 'emailVerified'> | null, profile: AdminProfile | null): boolean =>
  Boolean(user?.emailVerified && profile?.uid === user.uid && profile.status === 'active' && profile.role === 'super_admin');

/** A click-owned runner: no effects, storage, audit, token output or cross-origin requests. */
export const createFirebasePreflightRunner = (request: typeof fetch = fetch) => {
  let busy = false;
  return async (user: Pick<User, 'uid' | 'emailVerified' | 'getIdToken'> | null, profile: AdminProfile | null): Promise<PreflightStatus> => {
    if (!user) return fail('AUTH_REQUIRED');
    if (!canRunFirebasePreflight(user, profile)) return fail('FORBIDDEN');
    if (busy) return fail('PREFLIGHT_IN_PROGRESS');
    busy = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      let token: string;
      try { token = await user.getIdToken(); }
      catch { return fail('AUTH_INVALID'); }
      if (!token) return fail('AUTH_INVALID');
      if (controller.signal.aborted) return fail('PREFLIGHT_TIMEOUT');
      const response = await request('/api/admin/operations/health?transport=firebase-preflight', {
        method: 'GET', headers: { authorization: `Bearer ${token}` },
        cache: 'no-store', redirect: 'error', signal: controller.signal,
      });
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object') return fail('PREFLIGHT_UNAVAILABLE');
      const result = body as Record<string, unknown>;
      if (response.ok && result.status === 'PASS' && result.code === null) return { status: 'PASS', code: null };
      return result.status === 'FAIL' && typeof result.code === 'string' && codes.has(result.code)
        ? fail(result.code) : fail('PREFLIGHT_UNAVAILABLE');
    } catch { return fail(controller.signal.aborted ? 'PREFLIGHT_TIMEOUT' : 'PREFLIGHT_UNAVAILABLE'); }
    finally { clearTimeout(timer); busy = false; }
  };
};
