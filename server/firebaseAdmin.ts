import { createRequire } from 'node:module';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import type { Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage, type Storage } from 'firebase-admin/storage';

const require = createRequire(import.meta.url);

const parseServiceAccount = (): Record<string, string> | null => {
  const serialized = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!serialized) return null;

  try {
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    const projectId = typeof parsed.project_id === 'string' ? parsed.project_id : '';
    const clientEmail = typeof parsed.client_email === 'string' ? parsed.client_email : '';
    const privateKey = typeof parsed.private_key === 'string'
      ? parsed.private_key.replace(/\\n/g, '\n')
      : '';

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error('Service account is missing project_id, client_email or private_key.');
    }

    return {
      projectId,
      clientEmail,
      privateKey,
    };
  } catch (error) {
    throw new Error(
      `Could not load Firebase Admin credentials: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};

const getAdminApp = () => {
  const existing = getApps()[0];
  if (existing) return existing;

  const serviceAccount = parseServiceAccount();
  if (serviceAccount) {
    return initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.projectId,
    });
  }

  if (process.env.VERCEL) {
    throw new Error(
      'Could not load Firebase Admin credentials: FIREBASE_SERVICE_ACCOUNT_JSON is required on Vercel.'
    );
  }

  return initializeApp({
    credential: applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT,
  });
};

const lazyService = <T extends object>(resolve: () => T): T =>
  new Proxy({} as T, {
    get(_target, property) {
      const service = resolve();
      const value = Reflect.get(service, property, service) as unknown;
      return typeof value === 'function'
        ? value.bind(service)
        : value;
    },
  });

const getLegacyAdminAuth = (): Auth => {
  const authModule = require('firebase-admin/auth') as typeof import('firebase-admin/auth');
  return authModule.getAuth(getAdminApp());
};

export const getFirebaseAdminAccessToken = async (): Promise<string> => {
  const credential = getAdminApp().options.credential;
  if (!credential) throw new Error('FIREBASE_ADMIN_CREDENTIAL_UNAVAILABLE');
  const token = await credential.getAccessToken();
  const value = token.access_token?.trim() ?? '';
  if (!value) throw new Error('FIREBASE_ADMIN_ACCESS_TOKEN_UNAVAILABLE');
  return value;
};

// Keep the Firestore-only bootstrap free from firebase-admin/auth. Legacy routes
// can still resolve Admin Auth lazily, while new Vercel execution paths use the
// public-certificate Firebase token verifier and avoid jwks-rsa/jose at startup.
export const adminAuth = lazyService<Auth>(() => getLegacyAdminAuth());
export const adminDb = lazyService<Firestore>(() => getFirestore(getAdminApp()));
export const adminStorage = lazyService<Storage>(() => getStorage(getAdminApp()));
