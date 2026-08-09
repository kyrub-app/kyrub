import { verify as verifySignature } from 'node:crypto';
import type { AuthenticatedConsultantUser } from './types.js';
import { ConsultantHttpError } from './types.js';

const FIREBASE_CERTIFICATES_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const DEFAULT_FIREBASE_PROJECT_ID = 'kyrub-b8d0e';
const ALLOWED_CLOCK_SKEW_SECONDS = 300;

type FirebaseTokenHeader = {
  alg?: unknown;
  kid?: unknown;
  typ?: unknown;
};

type FirebaseTokenPayload = {
  aud?: unknown;
  iss?: unknown;
  sub?: unknown;
  exp?: unknown;
  iat?: unknown;
  auth_time?: unknown;
  name?: unknown;
  email?: unknown;
  email_verified?: unknown;
};

type CertificateCache = {
  certificates: Record<string, string>;
  expiresAt: number;
};

let certificateCache: CertificateCache | null = null;

const readBearerToken = (authorization: string | null | undefined): string =>
  /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1]?.trim() ?? '';

const decodeJsonPart = <T>(encoded: string): T => {
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as T;
  } catch {
    throw new ConsultantHttpError(
      401,
      'AUTH_REQUIRED',
      'Sua sessão é inválida. Entre novamente para usar a Kyrub I.A.'
    );
  }
};

const cacheDurationMs = (cacheControl: string | null): number => {
  const seconds = Number(/max-age=(\d+)/i.exec(cacheControl ?? '')?.[1] ?? '3600');
  return Number.isFinite(seconds) && seconds > 0
    ? seconds * 1_000
    : 60 * 60 * 1_000;
};

const loadFirebaseCertificates = async (): Promise<Record<string, string>> => {
  if (certificateCache && certificateCache.expiresAt > Date.now()) {
    return certificateCache.certificates;
  }

  let response: Response;
  try {
    response = await fetch(FIREBASE_CERTIFICATES_URL, {
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    console.error('[Kyrub AI] Firebase certificate request failed.', error);
    throw new ConsultantHttpError(
      503,
      'AUTH_UNAVAILABLE',
      'Não foi possível validar sua sessão agora. Tente novamente em instantes.'
    );
  }

  if (!response.ok) {
    throw new ConsultantHttpError(
      503,
      'AUTH_UNAVAILABLE',
      'Não foi possível validar sua sessão agora. Tente novamente em instantes.'
    );
  }

  const certificates = await response.json().catch(() => null);
  if (!certificates || typeof certificates !== 'object') {
    throw new ConsultantHttpError(
      503,
      'AUTH_UNAVAILABLE',
      'Não foi possível validar sua sessão agora. Tente novamente em instantes.'
    );
  }

  certificateCache = {
    certificates: certificates as Record<string, string>,
    expiresAt: Date.now() + cacheDurationMs(response.headers.get('cache-control')),
  };
  return certificateCache.certificates;
};

const requireNumericClaim = (
  value: unknown,
  claim: string
): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ConsultantHttpError(
      401,
      'AUTH_REQUIRED',
      `Sua sessão não contém o campo obrigatório ${claim}. Entre novamente.`
    );
  }
  return value;
};

const validateTokenClaims = (
  payload: FirebaseTokenPayload,
  projectId: string
): string => {
  const now = Math.floor(Date.now() / 1_000);
  const subject = typeof payload.sub === 'string' ? payload.sub : '';
  const expiresAt = requireNumericClaim(payload.exp, 'exp');
  const issuedAt = requireNumericClaim(payload.iat, 'iat');
  const authenticatedAt = requireNumericClaim(payload.auth_time, 'auth_time');

  const valid =
    payload.aud === projectId &&
    payload.iss === `https://securetoken.google.com/${projectId}` &&
    subject.length > 0 &&
    subject.length <= 128 &&
    expiresAt > now - ALLOWED_CLOCK_SKEW_SECONDS &&
    issuedAt <= now + ALLOWED_CLOCK_SKEW_SECONDS &&
    authenticatedAt <= now + ALLOWED_CLOCK_SKEW_SECONDS;

  if (!valid) {
    throw new ConsultantHttpError(
      401,
      'AUTH_REQUIRED',
      'Sua sessão expirou ou não pertence ao Kyrub. Entre novamente.'
    );
  }

  return subject;
};

export const verifyFirebaseIdToken = async (
  token: string,
  projectId = process.env.FIREBASE_PROJECT_ID?.trim() || DEFAULT_FIREBASE_PROJECT_ID
): Promise<AuthenticatedConsultantUser> => {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new ConsultantHttpError(
      401,
      'AUTH_REQUIRED',
      'Sua sessão é inválida. Entre novamente para usar a Kyrub I.A.'
    );
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJsonPart<FirebaseTokenHeader>(encodedHeader);
  const payload = decodeJsonPart<FirebaseTokenPayload>(encodedPayload);
  const keyId = typeof header.kid === 'string' ? header.kid : '';

  if (header.alg !== 'RS256' || !keyId) {
    throw new ConsultantHttpError(
      401,
      'AUTH_REQUIRED',
      'Sua sessão é inválida. Entre novamente para usar a Kyrub I.A.'
    );
  }

  const certificates = await loadFirebaseCertificates();
  const certificate = certificates[keyId];
  if (!certificate) {
    certificateCache = null;
    throw new ConsultantHttpError(
      401,
      'AUTH_REQUIRED',
      'Sua sessão não pôde ser confirmada. Atualize a página e tente novamente.'
    );
  }

  const signatureValid = verifySignature(
    'RSA-SHA256',
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    certificate,
    Buffer.from(encodedSignature, 'base64url')
  );
  if (!signatureValid) {
    throw new ConsultantHttpError(
      401,
      'AUTH_REQUIRED',
      'Sua sessão é inválida. Entre novamente para usar a Kyrub I.A.'
    );
  }

  const uid = validateTokenClaims(payload, projectId);
  return {
    uid,
    name:
      typeof payload.name === 'string' && payload.name.trim()
        ? payload.name.trim()
        : typeof payload.email === 'string'
          ? payload.email.split('@')[0] ?? 'Usuário do Kyrub'
          : 'Usuário do Kyrub',
    email: typeof payload.email === 'string' ? payload.email : '',
    ...(typeof payload.email_verified === 'boolean'
      ? { emailVerified: payload.email_verified }
      : {}),
  };
};

export const authenticateConsultantRequest = async (
  authorization: string | null | undefined
): Promise<AuthenticatedConsultantUser> => {
  const token = readBearerToken(authorization);
  if (!token) {
    throw new ConsultantHttpError(
      401,
      'AUTH_REQUIRED',
      'Faça login para conversar com o Consultor Kyrub.'
    );
  }

  return verifyFirebaseIdToken(token);
};
