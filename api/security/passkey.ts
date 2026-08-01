import {
  createHash,
  createPublicKey,
  randomBytes,
  verify as verifySignature,
} from 'node:crypto';

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

type VerifiedSession = { uid: string; authTime: number; displayName: string };
type ChallengePurpose = 'registration' | 'authentication';

const DEFAULT_FIREBASE_WEB_API_KEY = 'AIzaSyCgWDortDA5DYjx4xIlC9YjKH3ZNIrv99U';
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const RECENT_AUTH_SECONDS = 5 * 60;
const ALLOWED_ALGORITHMS = new Set([-7, -257]);

const toBase64Url = (value: Uint8Array | Buffer): string =>
  Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const fromBase64Url = (value: string): Buffer => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='), 'base64');
};

const requestBody = (value: unknown): Record<string, unknown> => {
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

const header = (request: RequestLike, name: string): string => {
  const value = request.headers[name] ?? request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
};

const bearerToken = (request: RequestLike): string =>
  /^Bearer\s+(.+)$/i.exec(header(request, 'authorization'))?.[1]?.trim() ?? '';

const decodeJwtPayload = (token: string): Record<string, unknown> => {
  try {
    const encoded = token.split('.')[1] ?? '';
    return JSON.parse(fromBase64Url(encoded).toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const verifySession = async (request: RequestLike): Promise<VerifiedSession> => {
  const token = bearerToken(request);
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
  const uid = typeof account?.localId === 'string' ? account.localId : '';
  if (!response.ok || !uid || account?.disabled === true) throw new Error('AUTH_REQUIRED');
  const jwt = decodeJwtPayload(token);
  return {
    uid,
    authTime: typeof jwt.auth_time === 'number' ? jwt.auth_time : 0,
    displayName:
      typeof account?.displayName === 'string' && account.displayName.trim()
        ? account.displayName.trim().slice(0, 64)
        : typeof account?.email === 'string'
          ? account.email.split('@')[0]?.slice(0, 64) || 'Usuário Kyrub'
          : 'Usuário Kyrub',
  };
};

const relyingParty = (request: RequestLike) => {
  const forwardedHost = header(request, 'x-forwarded-host').split(',')[0]?.trim();
  const rawHost = forwardedHost || header(request, 'host') || 'www.kyrub.com';
  const hostname = rawHost.replace(/:\d+$/, '').toLocaleLowerCase('en-US');
  const forwardedProtocol = header(request, 'x-forwarded-proto').split(',')[0]?.trim();
  const protocol = hostname === 'localhost' ? 'http' : forwardedProtocol || 'https';
  const origin = `${protocol}://${rawHost}`;
  const rpId = hostname === 'localhost'
    ? 'localhost'
    : hostname === 'kyrub.com' || hostname.endsWith('.kyrub.com')
      ? 'kyrub.com'
      : hostname;
  return { origin, rpId, rpName: 'Kyrub' };
};

const parseClientData = (encoded: unknown) => {
  if (typeof encoded !== 'string') throw new Error('INVALID_CREDENTIAL');
  try {
    return JSON.parse(fromBase64Url(encoded).toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new Error('INVALID_CREDENTIAL');
  }
};

const validateClientData = (
  encoded: unknown,
  expectedType: 'webauthn.create' | 'webauthn.get',
  challenge: string,
  origin: string
): Buffer => {
  const clientData = parseClientData(encoded);
  if (
    clientData.type !== expectedType
    || clientData.challenge !== challenge
    || clientData.origin !== origin
  ) {
    throw new Error('INVALID_CREDENTIAL');
  }
  return fromBase64Url(String(encoded));
};

const validateAuthenticatorData = (
  encoded: unknown,
  rpId: string,
  requireVerification = true
): { bytes: Buffer; counter: number } => {
  if (typeof encoded !== 'string') throw new Error('INVALID_CREDENTIAL');
  const bytes = fromBase64Url(encoded);
  if (bytes.length < 37) throw new Error('INVALID_CREDENTIAL');
  const expectedRpIdHash = createHash('sha256').update(rpId).digest();
  if (!expectedRpIdHash.equals(bytes.subarray(0, 32))) {
    throw new Error('INVALID_CREDENTIAL');
  }
  const flags = bytes[32] ?? 0;
  const userPresent = (flags & 0x01) !== 0;
  const userVerified = (flags & 0x04) !== 0;
  if (!userPresent || (requireVerification && !userVerified)) {
    throw new Error('USER_VERIFICATION_REQUIRED');
  }
  return { bytes, counter: bytes.readUInt32BE(33) };
};

const challengeReference = (adminDb: FirebaseFirestore.Firestore, uid: string) =>
  adminDb.collection('passkey_challenges').doc(uid);

const credentialCollection = (adminDb: FirebaseFirestore.Firestore, uid: string) =>
  adminDb.collection('user_security').doc(uid).collection('passkeys');

const storeChallenge = async (
  adminDb: FirebaseFirestore.Firestore,
  uid: string,
  purpose: ChallengePurpose,
  challenge: string,
  origin: string,
  rpId: string
) => {
  await challengeReference(adminDb, uid).set({
    uid,
    purpose,
    challenge,
    origin,
    rpId,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    createdAt: new Date(),
  });
};

const consumeChallenge = async (
  adminDb: FirebaseFirestore.Firestore,
  uid: string,
  purpose: ChallengePurpose
) => adminDb.runTransaction(async transaction => {
  const reference = challengeReference(adminDb, uid);
  const snapshot = await transaction.get(reference);
  const data = snapshot.data();
  const expiresAt = data?.expiresAt?.toMillis?.() ?? 0;
  if (
    !snapshot.exists
    || data?.purpose !== purpose
    || typeof data.challenge !== 'string'
    || typeof data.origin !== 'string'
    || typeof data.rpId !== 'string'
    || expiresAt < Date.now()
  ) {
    throw new Error('CHALLENGE_EXPIRED');
  }
  transaction.delete(reference);
  return {
    challenge: data.challenge as string,
    origin: data.origin as string,
    rpId: data.rpId as string,
  };
});

const credentialId = (body: Record<string, unknown>): string =>
  typeof body.id === 'string' ? body.id.slice(0, 1024) : '';

const sendError = (response: ResponseLike, error: unknown) => {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'AUTH_REQUIRED') {
    response.status(401).json({ error: 'Sua sessão expirou. Entre novamente.' });
    return;
  }
  if (code === 'RECENT_AUTH_REQUIRED') {
    response.status(401).json({
      error: 'Confirme novamente sua conta Google antes de cadastrar a biometria.',
      code,
    });
    return;
  }
  if (code === 'CHALLENGE_EXPIRED') {
    response.status(400).json({ error: 'A solicitação expirou. Inicie novamente.', code });
    return;
  }
  if (code === 'USER_VERIFICATION_REQUIRED') {
    response.status(400).json({ error: 'O aparelho não confirmou a biometria ou o PIN local.', code });
    return;
  }
  if (code === 'INVALID_CREDENTIAL' || code === 'CREDENTIAL_NOT_FOUND') {
    response.status(400).json({ error: 'A credencial do aparelho não pôde ser validada.', code });
    return;
  }
  console.error('[Kyrub Passkey]', error);
  response.status(503).json({ error: 'A biometria do aparelho está temporariamente indisponível.' });
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
    const rp = relyingParty(request);
    const body = requestBody(request.body);
    const action = request.method === 'GET'
      ? 'status'
      : typeof body.action === 'string' ? body.action : '';
    const credentials = credentialCollection(adminDb, session.uid);

    if (action === 'status' && request.method === 'GET') {
      const snapshot = await credentials.limit(10).get();
      response.status(200).json({
        configured: !snapshot.empty,
        credentialCount: snapshot.size,
      });
      return;
    }

    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Método não permitido.' });
      return;
    }

    if (action === 'registration-options') {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (!session.authTime || nowSeconds - session.authTime > RECENT_AUTH_SECONDS) {
        throw new Error('RECENT_AUTH_REQUIRED');
      }
      const challenge = toBase64Url(randomBytes(32));
      await storeChallenge(
        adminDb,
        session.uid,
        'registration',
        challenge,
        rp.origin,
        rp.rpId
      );
      const existing = await credentials.limit(20).get();
      response.status(200).json({
        challenge,
        rp: { id: rp.rpId, name: rp.rpName },
        user: {
          id: toBase64Url(createHash('sha256').update(session.uid).digest()),
          name: session.uid,
          displayName: session.displayName,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        timeout: 60_000,
        attestation: 'none',
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'required',
        },
        excludeCredentials: existing.docs.map(item => ({
          id: item.id,
          type: 'public-key',
          transports: Array.isArray(item.data().transports)
            ? item.data().transports
            : undefined,
        })),
      });
      return;
    }

    if (action === 'registration-finish') {
      const expected = await consumeChallenge(adminDb, session.uid, 'registration');
      const clientDataJSON = validateClientData(
        body.clientDataJSON,
        'webauthn.create',
        expected.challenge,
        expected.origin
      );
      const authenticator = validateAuthenticatorData(
        body.authenticatorData,
        expected.rpId
      );
      const id = credentialId(body);
      const publicKey = typeof body.publicKey === 'string' ? body.publicKey : '';
      const algorithm = typeof body.algorithm === 'number' ? body.algorithm : 0;
      if (!id || !publicKey || !ALLOWED_ALGORITHMS.has(algorithm)) {
        throw new Error('INVALID_CREDENTIAL');
      }
      createPublicKey({ key: fromBase64Url(publicKey), format: 'der', type: 'spki' });
      await credentials.doc(id).set({
        id,
        uid: session.uid,
        publicKey,
        algorithm,
        counter: authenticator.counter,
        transports: Array.isArray(body.transports)
          ? body.transports.filter(item => typeof item === 'string').slice(0, 10)
          : [],
        clientDataHash: toBase64Url(createHash('sha256').update(clientDataJSON).digest()),
        createdAt: new Date(),
        lastUsedAt: null,
      });
      response.status(200).json({ configured: true });
      return;
    }

    if (action === 'authentication-options') {
      const existing = await credentials.limit(20).get();
      if (existing.empty) throw new Error('CREDENTIAL_NOT_FOUND');
      const challenge = toBase64Url(randomBytes(32));
      await storeChallenge(
        adminDb,
        session.uid,
        'authentication',
        challenge,
        rp.origin,
        rp.rpId
      );
      response.status(200).json({
        challenge,
        rpId: rp.rpId,
        timeout: 60_000,
        userVerification: 'required',
        allowCredentials: existing.docs.map(item => ({
          id: item.id,
          type: 'public-key',
          transports: Array.isArray(item.data().transports)
            ? item.data().transports
            : undefined,
        })),
      });
      return;
    }

    if (action === 'authentication-finish') {
      const expected = await consumeChallenge(adminDb, session.uid, 'authentication');
      const clientDataJSON = validateClientData(
        body.clientDataJSON,
        'webauthn.get',
        expected.challenge,
        expected.origin
      );
      const authenticator = validateAuthenticatorData(
        body.authenticatorData,
        expected.rpId
      );
      const id = credentialId(body);
      const signature = typeof body.signature === 'string'
        ? fromBase64Url(body.signature)
        : Buffer.alloc(0);
      const reference = credentials.doc(id);
      const snapshot = await reference.get();
      const credential = snapshot.data();
      if (!snapshot.exists || !credential || typeof credential.publicKey !== 'string') {
        throw new Error('CREDENTIAL_NOT_FOUND');
      }
      const signedBytes = Buffer.concat([
        authenticator.bytes,
        createHash('sha256').update(clientDataJSON).digest(),
      ]);
      const key = createPublicKey({
        key: fromBase64Url(credential.publicKey),
        format: 'der',
        type: 'spki',
      });
      const verified = verifySignature('sha256', signedBytes, key, signature);
      const previousCounter = Number(credential.counter || 0);
      if (
        !verified
        || (authenticator.counter !== 0
          && previousCounter !== 0
          && authenticator.counter <= previousCounter)
      ) {
        throw new Error('INVALID_CREDENTIAL');
      }
      await reference.set({
        counter: authenticator.counter,
        lastUsedAt: new Date(),
      }, { merge: true });
      response.status(200).json({ verified: true });
      return;
    }

    response.status(400).json({ error: 'Ação de passkey inválida.' });
  } catch (error) {
    sendError(response, error);
  }
}
