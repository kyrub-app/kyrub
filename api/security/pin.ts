import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

type HeaderValue = string | string[] | undefined;

type RequestLike = {
  method?: string;
  headers: Record<string, HeaderValue>;
  body?: unknown;
};

type ResponseLike = {
  setHeader(name: string, value: string): void;
  status(code: number): ResponseLike;
  json(body: unknown): void;
};

type VerifiedSession = {
  uid: string;
  authTime: number;
};

const DEFAULT_FIREBASE_WEB_API_KEY = 'AIzaSyCgWDortDA5DYjx4xIlC9YjKH3ZNIrv99U';
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const RECENT_AUTH_SECONDS = 5 * 60;

const jsonBody = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object'
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
};

const authorization = (request: RequestLike): string => {
  const value = request.headers.authorization;
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
};

const bearerToken = (value: string): string =>
  /^Bearer\s+(.+)$/i.exec(value)?.[1]?.trim() ?? '';

const decodePayload = (token: string): Record<string, unknown> => {
  try {
    const payload = token.split('.')[1];
    if (!payload) return {};
    return JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    ) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const verifySession = async (request: RequestLike): Promise<VerifiedSession> => {
  const token = bearerToken(authorization(request));
  if (!token) throw new Error('AUTH_REQUIRED');

  const apiKey =
    process.env.FIREBASE_WEB_API_KEY?.trim()
    || process.env.VITE_FIREBASE_API_KEY?.trim()
    || DEFAULT_FIREBASE_WEB_API_KEY;
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    }
  );
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const users = Array.isArray(payload.users) ? payload.users : [];
  const account = users[0] && typeof users[0] === 'object'
    ? users[0] as Record<string, unknown>
    : null;
  if (!response.ok || !account || account.disabled === true) {
    throw new Error('AUTH_REQUIRED');
  }

  const uid = typeof account.localId === 'string' ? account.localId : '';
  if (!uid) throw new Error('AUTH_REQUIRED');
  const jwt = decodePayload(token);
  const authTime = typeof jwt.auth_time === 'number' ? jwt.auth_time : 0;
  return { uid, authTime };
};

const pinHash = (pin: string, salt: string, pepper: string): string =>
  scryptSync(`${pin}:${pepper}`, salt, 64).toString('base64');

const validPin = (pin: unknown): pin is string =>
  typeof pin === 'string' && /^\d{4}$/.test(pin);

const sendError = (response: ResponseLike, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED') {
    response.status(401).json({ error: 'Sua sessão expirou. Entre novamente.' });
    return;
  }
  if (message === 'RECENT_AUTH_REQUIRED') {
    response.status(401).json({
      error: 'Confirme novamente sua conta Google antes de alterar o PIN.',
      code: 'RECENT_AUTH_REQUIRED',
    });
    return;
  }
  if (message === 'PIN_LOCKED') {
    response.status(429).json({
      error: 'PIN temporariamente bloqueado após tentativas incorretas.',
      code: 'PIN_LOCKED',
    });
    return;
  }
  console.error('[Kyrub PIN]', error);
  response.status(503).json({
    error: 'A segurança transacional está temporariamente indisponível.',
  });
};

export default async function handler(
  request: RequestLike,
  response: ResponseLike
): Promise<void> {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-type', 'application/json; charset=utf-8');

  try {
    const session = await verifySession(request);
    const { adminDb } = await import('../../server/firebaseAdmin');
    const reference = adminDb.collection('user_security').doc(session.uid);

    if (request.method === 'GET') {
      const snapshot = await reference.get();
      response.status(200).json({
        configured: snapshot.exists && typeof snapshot.data()?.pinHash === 'string',
        lockedUntil: snapshot.data()?.lockedUntil?.toMillis?.() ?? null,
      });
      return;
    }

    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Método não permitido.' });
      return;
    }

    const body = jsonBody(request.body);
    const action = body.action;
    const pin = body.pin;
    if ((action !== 'set' && action !== 'verify' && action !== 'remove') || !validPin(pin)) {
      response.status(400).json({ error: 'Informe uma ação válida e um PIN de quatro dígitos.' });
      return;
    }

    const pepper = process.env.SECURITY_PIN_PEPPER?.trim();
    if (!pepper || pepper.length < 24) {
      response.status(503).json({
        error: 'O cofre de PIN ainda não foi configurado no servidor.',
        code: 'PIN_NOT_CONFIGURED',
      });
      return;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (
      (action === 'set' || action === 'remove')
      && (!session.authTime || nowSeconds - session.authTime > RECENT_AUTH_SECONDS)
    ) {
      throw new Error('RECENT_AUTH_REQUIRED');
    }

    if (action === 'set') {
      const salt = randomBytes(24).toString('base64');
      await reference.set({
        uid: session.uid,
        pinHash: pinHash(pin, salt, pepper),
        pinSalt: salt,
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      }, { merge: true });
      response.status(200).json({ configured: true });
      return;
    }

    if (action === 'remove') {
      await reference.delete();
      response.status(200).json({ configured: false });
      return;
    }

    const result = await adminDb.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference);
      const data = snapshot.data();
      if (!snapshot.exists || typeof data?.pinHash !== 'string' || typeof data.pinSalt !== 'string') {
        return { verified: false, notConfigured: true };
      }

      const lockedUntil = data.lockedUntil?.toMillis?.() ?? 0;
      if (lockedUntil > Date.now()) throw new Error('PIN_LOCKED');

      const expected = Buffer.from(data.pinHash, 'base64');
      const actual = Buffer.from(pinHash(pin, data.pinSalt, pepper), 'base64');
      const verified = expected.length === actual.length && timingSafeEqual(expected, actual);
      if (verified) {
        transaction.set(reference, {
          failedAttempts: 0,
          lockedUntil: null,
          lastVerifiedAt: new Date(),
          updatedAt: new Date(),
        }, { merge: true });
        return { verified: true, notConfigured: false };
      }

      const failedAttempts = Number(data.failedAttempts || 0) + 1;
      transaction.set(reference, {
        failedAttempts: failedAttempts >= MAX_FAILED_ATTEMPTS ? 0 : failedAttempts,
        lockedUntil: failedAttempts >= MAX_FAILED_ATTEMPTS
          ? new Date(Date.now() + LOCK_DURATION_MS)
          : null,
        updatedAt: new Date(),
      }, { merge: true });
      return { verified: false, notConfigured: false };
    });

    response.status(result.verified ? 200 : 403).json(result.notConfigured
      ? { verified: false, error: 'PIN ainda não configurado.' }
      : { verified: result.verified, error: result.verified ? undefined : 'PIN incorreto.' });
  } catch (error) {
    sendError(response, error);
  }
}
