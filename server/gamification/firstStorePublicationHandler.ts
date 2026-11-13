import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminAuth, adminDb } from '../firebaseAdmin.js';
import { hideVerifiedFirstStorePublication, publishFirstStoreAndAwardXp, syncVerifiedFirstStoreProfile } from './firstStorePublicationAuthority.js';

type RequestLike = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};
type ResponseLike = {
  setHeader(name: string, value: string): void;
  status(code: number): ResponseLike;
  json(body: unknown): void;
};
const header = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';
const id = (value: unknown): string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : '';

/**
 * Explicitly disabled until the existing browser publication flow has been
 * migrated to this endpoint and security rules are audited. No implicit
 * fallback to client-side XP awards is permitted.
 */
export async function handleFirstStorePublication(
  request: RequestLike,
  response: ResponseLike,
): Promise<void> {
  response.setHeader('cache-control', 'no-store, max-age=0');
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    return;
  }
  if (process.env.KYRUB_FIRST_STORE_PUBLICATION_SERVER_ENABLED !== 'true') {
    response.status(503).json({ error: 'FIRST_STORE_PUBLICATION_NOT_ENABLED' });
    return;
  }
  const authorization = header(request.headers.authorization);
  const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';
  if (!token) {
    response.status(401).json({ error: 'AUTH_REQUIRED' });
    return;
  }
  let uid: string;
  try {
    const emulatorOnly =
      process.env.NODE_ENV !== 'production' &&
      process.env.KYRUB_FIRST_STORE_PUBLICATION_E2E_LOCAL === 'true' &&
      process.env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099' &&
      process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8088' &&
      process.env.FIREBASE_PROJECT_ID === 'kyrub-security-test' &&
      process.env.GCLOUD_PROJECT === 'kyrub-security-test' &&
      process.env.GOOGLE_CLOUD_PROJECT === 'kyrub-security-test';
    // Emulator tokens are unsigned. Only the emulator SDK may verify them,
    // and only under the explicit local-only isolation guard above.
    const identity = emulatorOnly
      ? await adminAuth.verifyIdToken(token)
      : await verifyFirebaseIdToken(token);
    uid = identity.uid;
    if (!uid) throw Error('INVALID_FIREBASE_IDENTITY');
  } catch {
    response.status(401).json({ error: 'AUTH_INVALID' });
    return;
  }
  try {
    const canonicalStoreId = id((request.body as Record<string, unknown> | null)?.canonicalStoreId);
    if (!canonicalStoreId) {
      response.status(400).json({ error: 'INVALID_CANONICAL_STORE_ID' });
      return;
    }
    const action = (request.body as Record<string, unknown> | null)?.action;
    if (action !== undefined && action !== 'publish' && action !== 'hide' && action !== 'sync-profile') {
      response.status(400).json({ error: 'INVALID_PUBLICATION_ACTION' });
      return;
    }
    const result = action === 'hide'
      ? await hideVerifiedFirstStorePublication(adminDb, { authenticatedUserId: uid, canonicalStoreId })
      : action === 'sync-profile'
        ? await syncVerifiedFirstStoreProfile(adminDb, { authenticatedUserId: uid, canonicalStoreId })
        : await publishFirstStoreAndAwardXp(adminDb, { authenticatedUserId: uid, canonicalStoreId });
    response.status(200).json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'UNKNOWN';
    if (code === 'FIRST_STORE_PUBLICATION_INVALID_INPUT') {
      response.status(400).json({ error: code });
      return;
    }
    if (code.startsWith('FIRST_STORE_PUBLICATION_')) {
      response.status(409).json({ error: code });
      return;
    }
    console.error('[First store publication]', code);
    response.status(503).json({ error: 'FIRST_STORE_PUBLICATION_UNAVAILABLE' });
  }
}
