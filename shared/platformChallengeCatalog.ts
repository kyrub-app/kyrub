import { assertKyrubChallengeDefinition, type KyrubChallengeDefinition } from './gamification.js';
import { listVisibleGlobalChallenges } from './globalChallengeCatalog.js';

export type PlatformChallengeView = {
  id: string;
  title: string;
  description: string;
  rewardXp: number;
  /** Legacy persisted K-Coin field, displayed as Pitangas in Kyrub. */
  rewardPitangas: number;
  status: 'available' | 'completed';
  completionsConfirmed: number;
  maxCompletionsPerUser: number;
  endsAt?: string;
};

export type PlatformChallengeCatalog = {
  challenges: PlatformChallengeView[];
  availableCount: number;
  completedCount: number;
};

/** Pure read-only projection; no client progress, balance or reward claims. */
export const projectPlatformChallengeCatalog = (
  challenges: readonly KyrubChallengeDefinition[],
  receiptCounts: Readonly<Record<string, number>>,
  now: string,
): PlatformChallengeCatalog => {
  const seen = new Set<string>();
  const items: PlatformChallengeView[] = [];
  for (const candidate of challenges) {
    let challenge: KyrubChallengeDefinition;
    try { challenge = assertKyrubChallengeDefinition(candidate); } catch { continue; }
    if (seen.has(challenge.id) || challenge.sponsorType !== 'kyrub') continue;
    seen.add(challenge.id);
    if (challenge.status === 'cancelled' || challenge.status === 'draft') continue;
    const confirmed = Math.max(0, Math.min(challenge.maxCompletionsPerUser,
      Number.isSafeInteger(receiptCounts[challenge.id]) ? receiptCounts[challenge.id] : 0));
    const available = listVisibleGlobalChallenges([challenge], now).length > 0;
    // Completed challenges remain visible after their campaign ends. Otherwise
    // expired / scheduled / unpublished drafts never reach the user.
    if (!available && confirmed === 0) continue;
    items.push({
      id: challenge.id,
      title: challenge.title,
      description: challenge.description,
      rewardXp: challenge.rewardXp,
      rewardPitangas: challenge.rewardKCoins,
      status: confirmed > 0 ? 'completed' : 'available',
      completionsConfirmed: confirmed,
      maxCompletionsPerUser: challenge.maxCompletionsPerUser,
      ...(challenge.endsAt ? { endsAt: challenge.endsAt } : {}),
    });
  }
  items.sort((a, b) => (a.status === b.status ?
    a.title.localeCompare(b.title, 'pt-BR') || a.id.localeCompare(b.id) :
    a.status === 'available' ? -1 : 1));
  return {
    challenges: items,
    availableCount: items.filter(c => c.status === 'available').length,
    completedCount: items.filter(c => c.status === 'completed').length,
  };
};
