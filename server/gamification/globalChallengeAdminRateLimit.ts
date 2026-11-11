import { createHash } from 'node:crypto';
import { MemoryStore, type Options } from 'express-rate-limit';
import { adminDb } from '../firebaseAdmin.js';

export const GLOBAL_CHALLENGE_WINDOW_MS = 60_000;
export const GLOBAL_CHALLENGE_INGRESS_LIMIT = 300;
export const GLOBAL_CHALLENGE_ACTOR_LIMIT = 30;
const ingress = new MemoryStore();
ingress.init({ windowMs: GLOBAL_CHALLENGE_WINDOW_MS } as Options);

export class GlobalChallengeRateLimitError extends Error {
  constructor(readonly retryAfter: number) { super('GLOBAL_CHALLENGE_RATE_LIMITED'); }
}

// Bounded, constant-key protection before authentication; forwarded headers and
// unverified token claims cannot choose keys or allocate unbounded memory.
export const consumeGlobalChallengeIngress = async () => {
  const usage = await ingress.increment('global-challenge-admin');
  if (usage.totalHits > GLOBAL_CHALLENGE_INGRESS_LIMIT) {
    throw new GlobalChallengeRateLimitError(Math.max(1, Math.ceil(((usage.resetTime?.getTime() ?? Date.now() + GLOBAL_CHALLENGE_WINDOW_MS) - Date.now()) / 1000)));
  }
};

// MemoryStore alone resets on cold starts and does not coordinate instances.
// Keep the authenticated actor's quota in the existing Control Plane namespace.
export const consumeGlobalChallengeActorLimit = async (uid: string) => {
  const key = createHash('sha256').update(uid).digest('hex');
  const ref = adminDb.doc(`kyrub_admin/control_plane/rate_limits/global-challenges-${key}`);
  await adminDb.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const data = snapshot.data();
    if (snapshot.exists && (!Number.isSafeInteger(data?.resetAt) || data!.resetAt <= 0 ||
        !Number.isSafeInteger(data?.count) || data!.count < 0)) throw new Error('RATE_LIMIT_STATE_INVALID');
    const now = Date.now();
    const active = typeof data?.resetAt === 'number' && data.resetAt > now;
    if (active && data!.count >= GLOBAL_CHALLENGE_ACTOR_LIMIT) {
      throw new GlobalChallengeRateLimitError(Math.max(1, Math.ceil((data!.resetAt - now) / 1000)));
    }
    tx.set(ref, { count: active ? data!.count + 1 : 1, resetAt: active ? data!.resetAt : now + GLOBAL_CHALLENGE_WINDOW_MS });
  });
};
