import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';
import { readCommunitySemeaduraJourney, readPersonalSemeaduraJourney, readVerifiedPostSemeadura, seedVerifiedPost } from './semeaduraService.js';

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
  const isJourney = body?.action === 'journey' && Object.keys(body).length === 1;
  const isCommunityJourney = body?.action === 'community-journey' &&
    typeof body.communityId === 'string' &&
    Object.keys(body).length === 2;
  const isPostAction = body && ['semear', 'status'].includes(String(body.action)) &&
    (body.kind === 'personal' || body.kind === 'community') &&
    typeof body.postId === 'string' &&
    Object.keys(body).every(k => ['action','kind','postId'].includes(k));
  if (!isJourney && !isCommunityJourney && !isPostAction) {
    response.status(400).json({ error: 'SEMEADURA_INVALID_INPUT' });
    return;
  }
  try {
    if (isJourney) {
      response.status(200).json({
        journey: await readPersonalSemeaduraJourney(adminDb, actor),
      });
      return;
    }
    if (isCommunityJourney) {
      response.status(200).json({
        journey: await readCommunitySemeaduraJourney(adminDb, actor, body!.communityId as string),
      });
      return;
    }
    const target = { authenticatedUserId: actor, kind: body!.kind as 'personal' | 'community',
      postId: body!.postId as string };
    const result = body!.action === 'status'
      ? await readVerifiedPostSemeadura(adminDb, target)
      : await seedVerifiedPost(adminDb, target);
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
