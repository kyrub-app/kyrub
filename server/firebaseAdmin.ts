import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

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
      `FIREBASE_SERVICE_ACCOUNT_JSON is invalid: ${
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

  return initializeApp({
    credential: applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT,
  });
};

export const adminApp = getAdminApp();
export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp);
