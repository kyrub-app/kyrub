import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

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

  // Vercel does not provide Google Application Default Credentials implicitly.
  // Failing fast here keeps the request inside Kyrub's safe error envelope
  // instead of allowing credential discovery to fail opaquely at runtime.
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

// Firebase Authentication is deliberately not imported here. Serverless routes
// verify Firebase ID tokens through the public-certificate verifier and keep the
// Admin SDK scoped to privileged Firestore access.
export const adminDb = lazyService<Firestore>(() => getFirestore(getAdminApp()));
