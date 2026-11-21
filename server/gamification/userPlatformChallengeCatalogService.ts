import type { Firestore } from 'firebase-admin/firestore';
import { type KyrubChallengeDefinition } from '../../shared/gamification.js';
import { projectPlatformChallengeCatalog } from '../../shared/platformChallengeCatalog.js';

const validUid = (uid: string): boolean => /^[A-Za-z0-9_-]{1,128}$/.test(uid);

/**
 * User-scoped, read-only view of campaigns published in the existing Admin
 * workspace. No gamification activation flag, grant, ledger write or mutation.
 */
export async function readUserPlatformChallengeCatalog(db: Firestore, uid: string, now = new Date().toISOString()) {
  if (!validUid(uid)) throw Error('CHALLENGE_USER_INVALID');

  // Bounded queries: only published/active or ended campaigns are candidates;
  // completed campaigns are retained for history when their term has ended.
  const [definitions, rewards] = await Promise.all([
    db.collection('global_challenges')
      .where('status', 'in', ['published', 'active', 'ended'])
      .limit(60).get(),
    db.collection('users').doc(uid).collection('challengeRewards')
      .limit(200).get(),
  ]);

  const receiptCounts: Record<string, number> = Object.create(null);
  for (const receipt of rewards.docs) {
    const data = receipt.data();
    const challengeId = data?.challengeId;
    if (data?.userId !== uid || typeof challengeId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(challengeId) ||
        typeof data?.idempotencyKey !== 'string' || !data.idempotencyKey ||
        typeof data?.occurredAt !== 'string' || !Number.isFinite(Date.parse(data.occurredAt)) ||
        !Number.isSafeInteger(data.xp) || data.xp < 0 ||
        !Number.isSafeInteger(data.pitangas) || data.pitangas < 0) continue;
    receiptCounts[challengeId] = (receiptCounts[challengeId] ?? 0) + 1;
  }

  const challenges = definitions.docs.flatMap(snapshot => {
    const data = snapshot.data();
    return data.id === snapshot.id ? [data as KyrubChallengeDefinition] : [];
  });
  return projectPlatformChallengeCatalog(challenges, receiptCounts, now);
}
