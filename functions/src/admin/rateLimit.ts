import {
  FieldValue,
  Timestamp,
  type Firestore,
} from 'firebase-admin/firestore';

export interface RateLimitDecision {
  allowed: boolean;
  nextCount: number;
  remaining: number;
}

export class AdminRateLimitError extends Error {
  constructor() {
    super('Limite temporário de operações administrativas excedido.');
    this.name = 'AdminRateLimitError';
  }
}

export const calculateRateLimitDecision = (
  currentCount: number,
  maximum: number
): RateLimitDecision => {
  const safeCount = Number.isFinite(currentCount)
    ? Math.max(0, Math.floor(currentCount))
    : 0;
  const safeMaximum = Number.isFinite(maximum)
    ? Math.max(1, Math.floor(maximum))
    : 1;
  const allowed = safeCount < safeMaximum;
  const nextCount = allowed ? safeCount + 1 : safeCount;

  return {
    allowed,
    nextCount,
    remaining: Math.max(0, safeMaximum - nextCount),
  };
};

const safeRateLimitSegment = (value: string): string =>
  value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96);

export const enforceAdminRateLimit = async (
  firestore: Firestore,
  actorId: string,
  action: string,
  options: {
    maximum?: number;
    windowMs?: number;
    nowMs?: number;
  } = {}
): Promise<RateLimitDecision> => {
  const maximum = options.maximum ?? 30;
  const windowMs = options.windowMs ?? 60_000;
  const nowMs = options.nowMs ?? Date.now();
  const bucket = Math.floor(nowMs / windowMs);
  const documentId = [
    safeRateLimitSegment(actorId),
    safeRateLimitSegment(action),
    String(bucket),
  ].join('_');
  const reference = firestore.doc(
    `kyrub_admin/control_plane/rate_limits/${documentId}`
  );

  return firestore.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    const currentCount = snapshot.exists
      ? Number(snapshot.data()?.count ?? 0)
      : 0;
    const decision = calculateRateLimitDecision(currentCount, maximum);

    if (!decision.allowed) throw new AdminRateLimitError();

    transaction.set(
      reference,
      {
        actorId,
        action,
        bucket,
        count: decision.nextCount,
        windowMs,
        updatedAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(nowMs + 24 * 60 * 60 * 1000),
      },
      { merge: true }
    );

    return decision;
  });
};
