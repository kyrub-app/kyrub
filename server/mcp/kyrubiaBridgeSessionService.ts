import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type { AuthenticatedConsultantUser } from '../ai/types.js';
import { KyrubMcpAuthError, assertKyrubMcpEnabled, type KyrubMcpPrincipal } from './kyrubiaMcpAuth.js';

const TOKEN_PREFIX = 'kbv0';
const DEFAULT_TTL_MINUTES = 120;
const MAX_TTL_MINUTES = 24 * 60;
const MIN_TTL_MINUTES = 15;
const BRIDGE_SCOPE = ['kyrub:read', 'kyrubia:chat'] as const;

const clean = (value: unknown, maximum: number): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maximum) : '';

const ttlMinutesFrom = (value: unknown): number => {
  const numeric = typeof value === 'number' ? Math.floor(value) : DEFAULT_TTL_MINUTES;
  if (!Number.isFinite(numeric)) return DEFAULT_TTL_MINUTES;
  return Math.max(MIN_TTL_MINUTES, Math.min(MAX_TTL_MINUTES, numeric));
};

const tokenHash = (secret: string): string =>
  createHash('sha256')
    .update(`kyrubia-bridge-v0:${secret}`)
    .digest('hex');

const encodedUid = (uid: string): string => Buffer.from(uid, 'utf8').toString('base64url');

const decodedUid = (value: string): string => {
  try {
    const uid = Buffer.from(value, 'base64url').toString('utf8').trim();
    return /^[A-Za-z0-9:_-]{1,128}$/.test(uid) ? uid : '';
  } catch {
    return '';
  }
};

const parseToken = (token: string): { uid: string; sessionId: string; secret: string } | null => {
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== TOKEN_PREFIX) return null;
  const uid = decodedUid(parts[1]);
  const sessionId = parts[2];
  const secret = parts[3];
  if (!uid || !/^[0-9a-f-]{36}$/i.test(sessionId) || !/^[A-Za-z0-9_-]{32,96}$/.test(secret)) return null;
  return { uid, sessionId, secret };
};

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const safeHashMatches = (expectedHex: string, actualHex: string): boolean => {
  if (!/^[0-9a-f]{64}$/i.test(expectedHex) || !/^[0-9a-f]{64}$/i.test(actualHex)) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = Buffer.from(actualHex, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

export type KyrubiaBridgeSessionSummary = {
  id: string;
  label: string;
  mode: 'proposal_only';
  scope: Array<(typeof BRIDGE_SCOPE)[number]>;
  createdAt: string;
  expiresAt: string;
  expiresAtMillis: number;
  revoked: boolean;
};

export type KyrubiaBridgeSessionCreated = KyrubiaBridgeSessionSummary & {
  token: string;
  tokenType: 'Bearer';
  mcpPath: '/api/mcp';
};

type StoredBridgeSession = {
  schemaVersion: 1;
  id: string;
  ownerUid: string;
  ownerEmail: string;
  ownerName: string;
  label: string;
  mode: 'proposal_only';
  scope: string[];
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  expiresAtMillis: number;
  revokedAt: string | null;
  revokedAtMillis: number | null;
};

const summaryFrom = (session: StoredBridgeSession): KyrubiaBridgeSessionSummary => ({
  id: session.id,
  label: session.label,
  mode: 'proposal_only',
  scope: session.scope.filter((scope): scope is (typeof BRIDGE_SCOPE)[number] =>
    BRIDGE_SCOPE.includes(scope as (typeof BRIDGE_SCOPE)[number])
  ),
  createdAt: session.createdAt,
  expiresAt: session.expiresAt,
  expiresAtMillis: session.expiresAtMillis,
  revoked: Boolean(session.revokedAt || session.revokedAtMillis),
});

const sessionRef = (uid: string, sessionId: string) =>
  adminDb.doc(`users/${uid}/kyrubiaBridgeSessions/${sessionId}`);

const assertStoredSession = (value: unknown, uid: string, sessionId: string): StoredBridgeSession => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new KyrubMcpAuthError(401, 'BRIDGE_SESSION_INVALID', 'A sessão de integração não é válida.');
  }
  const session = value as Record<string, unknown>;
  if (
    session.schemaVersion !== 1 ||
    clean(session.id, 80) !== sessionId ||
    clean(session.ownerUid, 128) !== uid ||
    session.mode !== 'proposal_only' ||
    !Array.isArray(session.scope) ||
    clean(session.tokenHash, 80).length !== 64 ||
    typeof session.expiresAtMillis !== 'number' ||
    !Number.isFinite(session.expiresAtMillis)
  ) {
    throw new KyrubMcpAuthError(401, 'BRIDGE_SESSION_INVALID', 'A sessão de integração não é válida.');
  }
  return session as unknown as StoredBridgeSession;
};

export const isKyrubiaBridgeToken = (token: string): boolean => token.startsWith(`${TOKEN_PREFIX}.`);

export const createKyrubiaBridgeSession = async (input: {
  user: AuthenticatedConsultantUser;
  ttlMinutes?: unknown;
  label?: unknown;
}): Promise<KyrubiaBridgeSessionCreated> => {
  assertKyrubMcpEnabled();
  const uid = clean(input.user.uid, 128);
  if (!uid) throw new KyrubMcpAuthError(401, 'AUTH_REQUIRED', 'Autenticação obrigatória.');

  const ttlMinutes = ttlMinutesFrom(input.ttlMinutes);
  const now = Date.now();
  const expiresAtMillis = now + ttlMinutes * 60_000;
  const sessionId = randomUUID();
  const secret = randomBytes(32).toString('base64url');
  const token = `${TOKEN_PREFIX}.${encodedUid(uid)}.${sessionId}.${secret}`;
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(expiresAtMillis).toISOString();
  const label = clean(input.label, 80) || 'ChatGPT bridge';

  const stored: StoredBridgeSession = {
    schemaVersion: 1,
    id: sessionId,
    ownerUid: uid,
    ownerEmail: clean(input.user.email, 254),
    ownerName: clean(input.user.name, 160) || 'Usuário do Kyrub',
    label,
    mode: 'proposal_only',
    scope: [...BRIDGE_SCOPE],
    tokenHash: tokenHash(secret),
    createdAt,
    expiresAt,
    expiresAtMillis,
    revokedAt: null,
    revokedAtMillis: null,
  };

  await sessionRef(uid, sessionId).set({
    ...stored,
    serverCreatedAt: FieldValue.serverTimestamp(),
  });

  return {
    ...summaryFrom(stored),
    token,
    tokenType: 'Bearer',
    mcpPath: '/api/mcp',
  };
};

export const verifyKyrubiaBridgeAuthorization = async (
  authorization: string
): Promise<KyrubMcpPrincipal> => {
  assertKyrubMcpEnabled();
  const token = bearerToken(authorization);
  const parsed = parseToken(token);
  if (!parsed) throw new KyrubMcpAuthError(401, 'BRIDGE_TOKEN_INVALID', 'A credencial da integração é inválida.');

  const snapshot = await sessionRef(parsed.uid, parsed.sessionId).get();
  if (!snapshot.exists) throw new KyrubMcpAuthError(401, 'BRIDGE_SESSION_INVALID', 'A sessão de integração não existe mais.');
  const session = assertStoredSession(snapshot.data(), parsed.uid, parsed.sessionId);
  if (session.revokedAt || session.revokedAtMillis) {
    throw new KyrubMcpAuthError(401, 'BRIDGE_SESSION_REVOKED', 'A sessão de integração foi revogada.');
  }
  if (session.expiresAtMillis <= Date.now()) {
    throw new KyrubMcpAuthError(401, 'BRIDGE_SESSION_EXPIRED', 'A sessão de integração expirou.');
  }
  if (!safeHashMatches(session.tokenHash, tokenHash(parsed.secret))) {
    throw new KyrubMcpAuthError(401, 'BRIDGE_TOKEN_INVALID', 'A credencial da integração é inválida.');
  }
  if (!session.scope.includes('kyrub:read') || !session.scope.includes('kyrubia:chat')) {
    throw new KyrubMcpAuthError(403, 'BRIDGE_SCOPE_INVALID', 'A sessão não possui o escopo necessário.');
  }

  return {
    uid: session.ownerUid,
    email: session.ownerEmail || null,
    name: session.ownerName || 'Usuário do Kyrub',
    authType: 'bridge_session',
    bridgeSessionId: session.id,
    bridgeMode: 'proposal_only',
  };
};

export const getKyrubiaBridgeSessionStatus = async (
  authorization: string
): Promise<KyrubiaBridgeSessionSummary> => {
  const principal = await verifyKyrubiaBridgeAuthorization(authorization);
  const sessionId = principal.bridgeSessionId;
  if (!sessionId) throw new KyrubMcpAuthError(401, 'BRIDGE_SESSION_INVALID', 'A sessão de integração não é válida.');
  const snapshot = await sessionRef(principal.uid, sessionId).get();
  const session = assertStoredSession(snapshot.data(), principal.uid, sessionId);
  return summaryFrom(session);
};

export const revokeKyrubiaBridgeSession = async (
  authorization: string
): Promise<KyrubiaBridgeSessionSummary> => {
  const principal = await verifyKyrubiaBridgeAuthorization(authorization);
  const sessionId = principal.bridgeSessionId;
  if (!sessionId) throw new KyrubMcpAuthError(401, 'BRIDGE_SESSION_INVALID', 'A sessão de integração não é válida.');
  const reference = sessionRef(principal.uid, sessionId);
  const now = Date.now();
  const revokedAt = new Date(now).toISOString();
  await reference.update({
    revokedAt,
    revokedAtMillis: now,
    serverRevokedAt: FieldValue.serverTimestamp(),
  });
  const snapshot = await reference.get();
  return summaryFrom(assertStoredSession(snapshot.data(), principal.uid, sessionId));
};
