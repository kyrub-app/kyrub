import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';
import { seedVerifiedPost } from './semeaduraService.js';

type RequestLike = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};
type ResponseLike = {
  status(code: number): ResponseLike;
  json(body: unknown): void;
};
const header = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

/**
 * Fail-closed. No production side effects without a separate deployment gate.
 * This transport uses the existing Vercel action handler (no extra function).
 */
export async function handleSemeadura(request: RequestLike, response: ResponseLike): Promise<void> {
  if (request.method?.toUpperCase() !== 'POST') {
    response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    return;
  }
  if (process.env.KYRUB_SEMEADURA_SERVER_ENABLED !== 'true') {
    response.status(503).json({ error: 'SEMEADURA_NOT_ENABLED' });
    return;
  }
  const raw = header(request.headers.authorization);
  const token = /^Bearer\s+(.+)$/i.exec(raw)?.[1]?.trim() ?? '';
  if (!token) {
    response.status(401).json({ error: 'AUTH_REQUIRED' });
    return;
  }

  let actor = '';
  try {
    actor = (await verifyFirebaseIdToken(token)).uid;
    if (!actor) throw Error('INVALID_FIREBASE_IDENTITY');
  } catch {
    response.status(401).json({ error: 'AUTH_INVALID' });
    return;
  }

  const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
    ? request.body as Record<string, unknown> : null;
  if (!body || body.action !== 'semear' ||
      (body.kind !== 'personal' && body.kind !== 'community') ||
      typeof body.postId !== 'string' || Object.keys(body).some(k => !['action','kind','postId'].includes(k))) {
    response.status(400).json({ error: 'SEMEADURA_INVALID_INPUT' });
    return;
  }
  try {
    const result = await seedVerifiedPost(adminDb, {
      authenticatedUserId: actor, kind: body.kind, postId: body.postId,
    });
    response.status(200).json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'UNEXPECTED';
    if (code === 'SEMEADURA_INVALID_INPUT') {
      response.status(400).json({ error: code });
    } else if (code.startsWith('SEMEADURA_')) {
      response.status(409).json({ error: code });
    } else {
      console.error('[Semeadura] Unexpected service failure:', error);
      response.status(503).json({ error: 'SEMEADURA_UNAVAILABLE' });
    }
  }
}
