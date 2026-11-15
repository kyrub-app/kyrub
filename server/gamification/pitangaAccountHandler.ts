import type { KyrubMcpHttpRequest, KyrubMcpHttpResponse } from '../mcp/kyrubiaMcpServer.js';

type Dependencies = {
  verify(token: string): Promise<{ uid: string }>;
  read(uid: string): Promise<unknown>;
  convert(uid: string, input: { requestId: string; requestedXp: number }): Promise<unknown>;
};

/** Shared production/local entry point; dependency failures also fail closed. */
export async function handlePitangaAccountRequest(req: KyrubMcpHttpRequest, res: KyrubMcpHttpResponse) {
  try {
    const [{ readPitangaAccount, convertPitangaAccount }, { adminDb }, { verifyFirebaseIdToken }] = await Promise.all([
      import('./pitangaAccountService.js'), import('../firebaseAdmin.js'), import('../ai/consultantAuth.js'),
    ]);
    await handlePitangaAccount(req, res, { verify: verifyFirebaseIdToken,
      read: uid => readPitangaAccount(adminDb, uid), convert: (uid, input) => convertPitangaAccount(adminDb, uid, input),
    });
  } catch {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.status(503).json({ error: 'PITANGA_ACCOUNT_UNAVAILABLE' });
  }
}

export async function handlePitangaAccount(req: KyrubMcpHttpRequest, res: KyrubMcpHttpResponse, deps: Dependencies) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const method = (req.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    res.setHeader('Allow', 'GET, POST'); res.status(405).json({ error: 'METHOD_NOT_ALLOWED' }); return;
  }
  const value = req.headers.authorization ?? req.headers.Authorization;
  const token = /^Bearer\s+(.+)$/i.exec(Array.isArray(value) ? value[0] : value ?? '')?.[1]?.trim();
  if (!token) { res.status(401).json({ error: 'AUTH_REQUIRED' }); return; }
  let uid: string;
  try { uid = (await deps.verify(token)).uid; }
  catch { res.status(401).json({ error: 'AUTH_INVALID' }); return; }
  try {
    if (method === 'GET') { res.status(200).json(await deps.read(uid)); return; }
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(k => k !== 'requestId' && k !== 'requestedXp')) throw Error('PITANGA_CONVERSION_INPUT_INVALID');
    const { requestId, requestedXp } = body as Record<string, unknown>;
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(requestId) ||
        !Number.isSafeInteger(requestedXp) || (requestedXp as number) < 1 ||
        !Number.isSafeInteger((requestedXp as number) * 1000)) throw Error('PITANGA_CONVERSION_INPUT_INVALID');
    res.status(200).json(await deps.convert(uid, { requestId, requestedXp: requestedXp as number }));
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'PITANGA_CONVERSION_INPUT_INVALID') res.status(400).json({ error: code });
    else if (code === 'PITANGA_BALANCE_INSUFFICIENT') res.status(409).json({ error: code });
    else if (code === 'CONVERSION_IDEMPOTENCY_CONFLICT') res.status(409).json({ error: code });
    else res.status(503).json({ error: 'PITANGA_ACCOUNT_UNAVAILABLE' });
  }
}
