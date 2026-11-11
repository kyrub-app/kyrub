/**
 * Public product terminology: Pitangas. Persisted reward ledger units remain K-Coins.
 * This module plans a voluntary conversion only; it does not mutate ledgers.
 * The trusted server must atomically debit reward balance and credit XP, using
 * one idempotency key and a durable transaction/outbox before exposing this action.
 */
export const PITANGAS_PER_XP = 100 as const;

export interface PitangaXpConversionPlan {
  pitangasToDebit: number;
  xpToCredit: number;
  remainingPitangas: number;
}

export const planVoluntaryPitangaXpConversion = (
  availablePitangas: number,
  requestedXp: number,
): PitangaXpConversionPlan => {
  if (!Number.isSafeInteger(availablePitangas) || availablePitangas < 0) {
    throw new Error('PITANGA_BALANCE_INVALID');
  }
  if (!Number.isSafeInteger(requestedXp) || requestedXp < 1) {
    throw new Error('XP_CONVERSION_AMOUNT_INVALID');
  }
  const pitangasToDebit = requestedXp * PITANGAS_PER_XP;
  if (!Number.isSafeInteger(pitangasToDebit)) {
    throw new Error('XP_CONVERSION_OVERFLOW');
  }
  if (pitangasToDebit > availablePitangas) {
    throw new Error('PITANGA_BALANCE_INSUFFICIENT');
  }
  return {
    pitangasToDebit,
    xpToCredit: requestedXp,
    remainingPitangas: availablePitangas - pitangasToDebit,
  };
};
