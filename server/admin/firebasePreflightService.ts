import { randomUUID } from 'node:crypto';
import { cert, deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'kyrub-b8d0e';
export const FIREBASE_PREFLIGHT_TIMEOUT_MS = 10_000;

export interface FirebasePreflightResult {
  httpStatus: number;
  body: { status: 'PASS' | 'FAIL'; code: string | null };
}

class PreflightFailure extends Error {
  constructor(readonly httpStatus: number, readonly code: string) { super(code); }
}

/** Temporary, server-only diagnostic. No shared app, ADC, writes or audit loader. */
export const runFirebasePreflight = async (authorization: string): Promise<FirebasePreflightResult> => {
  const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim();
  if (!token) return { httpStatus: 401, body: { status: 'FAIL', code: 'AUTH_REQUIRED' } };

  let app: App | undefined;
  let firestore: Firestore | undefined;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const checkDeadline = () => { if (expired) throw new PreflightFailure(503, 'PREFLIGHT_TIMEOUT'); };

  const probe = async (): Promise<FirebasePreflightResult> => {
    if (!['production', 'preview'].includes(process.env.VERCEL_ENV ?? '') || !process.env.VERCEL ||
        process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
      throw new PreflightFailure(503, 'AUTHORIZED_RUNTIME_REQUIRED');
    }
    const serialized = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
    if (!serialized) throw new PreflightFailure(503, 'FIREBASE_CREDENTIAL_UNAVAILABLE');
    let account: Record<string, unknown>;
    try {
      const parsed = JSON.parse(serialized);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error();
      account = parsed;
    } catch { throw new PreflightFailure(503, 'FIREBASE_CREDENTIAL_INVALID'); }
    if (account.project_id !== PROJECT_ID) throw new PreflightFailure(503, 'FIREBASE_PROJECT_MISMATCH');
    if (typeof account.client_email !== 'string' || !account.client_email.trim() ||
        typeof account.private_key !== 'string' || !account.private_key.trim()) {
      throw new PreflightFailure(503, 'FIREBASE_CREDENTIAL_INVALID');
    }
    try {
      app = initializeApp({ projectId: PROJECT_ID, credential: cert({
        projectId: PROJECT_ID, clientEmail: account.client_email,
        privateKey: account.private_key.replace(/\\n/g, '\n'),
      }) }, `firebase-preflight-${randomUUID()}`);
    } catch { throw new PreflightFailure(503, 'FIREBASE_CREDENTIAL_INVALID'); }
    if (app.options.projectId !== PROJECT_ID) throw new PreflightFailure(503, 'FIREBASE_PROJECT_MISMATCH');

    let user;
    try { user = await getAuth(app).verifyIdToken(token); }
    catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
      if (['auth/argument-error', 'auth/invalid-id-token', 'auth/id-token-expired', 'auth/id-token-revoked'].includes(String(code))) {
        throw new PreflightFailure(401, 'AUTH_INVALID');
      }
      throw new PreflightFailure(503, 'ADMIN_AUTH_UNAVAILABLE');
    }
    checkDeadline();
    if (!user.uid || user.uid.includes('/')) throw new PreflightFailure(401, 'AUTH_INVALID');
    if (user.email_verified !== true) throw new PreflightFailure(403, 'FORBIDDEN');

    // Authorization and the real credential read use the SAME explicit Admin app.
    firestore = getFirestore(app);
    const profile = await firestore.doc(`kyrub_admin/control_plane/admins/${user.uid}`).get();
    checkDeadline();
    const data = profile.data();
    if (!profile.exists || data?.uid !== user.uid || data.status !== 'active' || data.role !== 'super_admin') {
      throw new PreflightFailure(403, 'FORBIDDEN');
    }
    return { httpStatus: 200, body: { status: 'PASS', code: null } };
  };

  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        expired = true;
        reject(new PreflightFailure(503, 'PREFLIGHT_TIMEOUT'));
      }, FIREBASE_PREFLIGHT_TIMEOUT_MS);
    });
    return await Promise.race([probe(), deadline]);
  } catch (error) {
    // Never return/log SDK messages, credentials, decoded claims or profile data.
    return error instanceof PreflightFailure
      ? { httpStatus: error.httpStatus, body: { status: 'FAIL', code: error.code } }
      : { httpStatus: 503, body: { status: 'FAIL', code: 'FIREBASE_READ_FAILED' } };
  } finally {
    if (timer) clearTimeout(timer);
    // Do not extend the HTTP deadline waiting on an SDK operation that timed out.
    if (firestore) void firestore.terminate().catch(() => undefined);
    if (app) void deleteApp(app).catch(() => undefined);
  }
};
