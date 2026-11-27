import { adminAuth } from '../firebaseAdmin.js';
import { loadCourierEarningsProjection } from './courierEarningsProjectionService.js';

type Request = { method?: string; headers: Record<string, string | string[] | undefined> };
type Response = { setHeader(name: string, value: string): unknown; status(code: number): { json(value: unknown): unknown } };
type Dependencies = {
  verify: (token: string) => Promise<{uid: string}>;
  load: typeof loadCourierEarningsProjection;
};
const defaults: Dependencies = {
  verify: token => adminAuth.verifyIdToken(token, true),
  load: loadCourierEarningsProjection,
};

export async function handleCourierEarningsRead(request: Request, response: Response, deps: Dependencies = defaults): Promise<void> {
  response.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.status(405).json({ error: 'Método não permitido.' });
    return;
  }
  const header = request.headers.authorization ?? request.headers.Authorization;
  const token = typeof header === 'string' ? /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() : '';
  if (!token) {
    response.status(401).json({ error: 'Entre novamente para consultar seus ganhos.' });
    return;
  }
  let uid: string;
  try {
    uid = (await deps.verify(token)).uid;
    if (!uid || uid.includes('/')) throw new Error('AUTH_REQUIRED');
  } catch (error) {
    const code = (error as {code?: string})?.code ?? '';
    const invalid = ['auth/id-token-expired','auth/id-token-revoked','auth/invalid-id-token','auth/argument-error','auth/user-disabled','auth/user-not-found'].includes(code) || (error instanceof Error && error.message === 'AUTH_REQUIRED');
    response.status(invalid ? 401 : 503).json({ error: invalid ? 'Entre novamente para consultar seus ganhos.' : 'Não foi possível confirmar sua sessão.' });
    return;
  }
  try {
    response.status(200).json(await deps.load(uid));
  } catch (error) {
    // Do not leak identifiers, index creation URLs, or ledger details.
    const code = (error as {code?: unknown})?.code;
    console.warn('[courier-earnings-read]', code === 9 || code === 'FAILED_PRECONDITION' ? 'index-or-precondition' : 'unavailable');
    response.status(503).json({ error: 'Não foi possível consultar seus ganhos de entrega.' });
  }
}
