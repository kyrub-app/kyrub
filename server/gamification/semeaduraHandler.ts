import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminAuth, adminDb, getFirebaseAdminProjectId } from '../firebaseAdmin.js';
import { authorizeSemeaduraMutation, parseSemeaduraRequest } from './semeaduraRequestAuthority.js';
import { SemeaduraDailyLimitError, readPersonalSemeaduraJourney, readVerifiedPostSemeadura, seedReleaseControlledPost } from './semeaduraService.js';

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

  // Exact discriminated request: no coercion, undo, toggle or caller UID.
  const body = parseSemeaduraRequest(request.body);
  if(!body){
    response.status(400).json({error:'SEMEADURA_INVALID_INPUT'});
    return;
  }
  let actor = '';
  try {
    actor=body.action==='semear'
      ? await authorizeSemeaduraMutation(token,{
          verify:verifyFirebaseIdToken,
          getUser:uid=>adminAuth.getUser(uid),
          actualProject:getFirebaseAdminProjectId,
          expectedProject:process.env.FIREBASE_PROJECT_ID?.trim()||'kyrub-b8d0e',
          now:Date.now,
        })
      : (await verifyFirebaseIdToken(token)).uid;
    if (!actor) throw Error('INVALID_FIREBASE_IDENTITY');
  } catch {
    response.status(401).json({ error: 'AUTH_INVALID' });
    return;
  }

  try {
    if (body.action==='journey') {
      response.status(200).json({
        journey: await readPersonalSemeaduraJourney(adminDb, actor),
      });
      return;
    }
    const target = { authenticatedUserId: actor, kind: body.kind, postId: body.postId };
    const result = body.action === 'status'
      ? await readVerifiedPostSemeadura(adminDb, target)
      : await seedReleaseControlledPost(adminDb, target, adminAuth);
    response.status(200).json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'UNEXPECTED';
    if (code === 'SEMEADURA_INVALID_INPUT') {
      response.status(400).json({ error: code });
    } else if (error instanceof SemeaduraDailyLimitError) {
      response.status(429).json({error:code,dailyDay:error.day,dailyRemaining:0});
    } else if (code === 'SEMEADURA_RELEASE_UNAVAILABLE') {
      response.status(503).json({error:code});
    } else if (code.startsWith('SEMEADURA_')) {
      response.status(409).json({ error: code });
    } else {
      console.error('[Semeadura] Unexpected service failure:', error);
      response.status(503).json({ error: 'SEMEADURA_UNAVAILABLE' });
    }
  }
}
