import type { KyrubChallengeDefinition } from './gamification.js';
import type { AgeStatus } from './ageEligibility.js';

/** Draft only. Catalog publication and canonical ledger writer are separate. */
export const PROFILE_COMPLETION_CHALLENGE = {
  id: 'profile_identity_completed',
  title: 'Minha identidade Kyrub',
  description: 'Defina seu nome de exibição, nome de usuário e apresentação.',
  status: 'draft',
  validationMode: 'deterministic',
  rewardKCoins: 100,
  rewardXp: 0,
  maxCompletionsPerUser: 1,
  sponsorType: 'kyrub',
} as const satisfies KyrubChallengeDefinition;

/** Accept only server-confirmed profile fields and handle ownership.
 * No photo, documents, CPF, publication flag or Tag-specific extra reward. */
export function evaluateProfileCompletion(input: {
  uid: string;
  ageStatus: AgeStatus;
  releaseApproved: boolean;
  challengeActive: boolean;
  receiptExists: boolean;
  displayName: unknown;
  handle: unknown;
  handleOwnerUid: unknown;
  bio: unknown;
}): { eligible: false } | { eligible: true; idempotencyKey: string; rewardPitangas: 100 } {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.uid) ||
      input.ageStatus !== 'verified_adult' || input.releaseApproved !== true ||
      input.challengeActive !== true || input.receiptExists !== false) return { eligible: false };
  if (typeof input.displayName !== 'string' || !input.displayName.trim() ||
      typeof input.handle !== 'string' || !input.handle.trim() ||
      input.handleOwnerUid !== input.uid ||
      typeof input.bio !== 'string' || !input.bio.trim()) return { eligible: false };
  return { eligible: true, idempotencyKey: PROFILE_COMPLETION_CHALLENGE.id + ':' + input.uid,
    rewardPitangas: 100 };
}
