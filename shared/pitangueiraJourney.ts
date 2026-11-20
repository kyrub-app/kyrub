import { PITANGAS_PER_XP } from './pitangaXpConversion.js';

/**
 * Journey of the Pitangueira — canonical arithmetic, independent of a UI and
 * never a permission to mint credits. Only trusted, verified seed receipts
 * are eligible to change account balances.
 *
 * One post is closed forever after ONE bosque (100,000 accepted seeds).
 * A person's lifetime journey aggregates many posts, not one viral post.
 */
export const SEEDS_PER_BROTO = 10 as const;
export const BROTOS_PER_MUDA = 10 as const;
export const MUDAS_PER_PITANGUEIRA = 10 as const;
export const PITANGUEIRAS_PER_BOSQUE = 100 as const;
export const BOSQUES_PER_XP = 10 as const;
export const SEEDS_PER_MUDA = 100 as const;
export const SEEDS_PER_PITANGUEIRA = 1_000 as const;
export const SEEDS_PER_BOSQUE = 100_000 as const;
export const SEEDS_PER_XP_EQUIVALENT = 1_000_000 as const;

export type SemeaduraPostKind = 'community' | 'personal';

export interface PitangueiraJourney {
  /** Lifetime accepted seeds, derived from trustworthy receipts. */
  totalSeeds: number;
  /** Lifetime pitangueiras (one earns one Pitanga once settled). */
  pitangueiras: number;
  /** Public collective milestone; not a second wallet. */
  bosques: number;
  /** Visible remainder as grouped stages. */
  remainingSeeds: number;
  brotos: number;
  mudas: number;
  pitangueirasInCurrentBosque: number;
  /** Informational equivalence ONLY, not spendable balance or XP credited. */
  pitangasEquivalent: number;
  xpEquivalent: number;
}

const nonnegativeSafe = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('SEMEADURA_COUNT_INVALID');
  }
  return value;
};

export const calculatePitangueiraJourney = (acceptedSeeds: number): PitangueiraJourney => {
  const seeds = nonnegativeSafe(acceptedSeeds);
  const pitangueiras = Math.floor(seeds / SEEDS_PER_PITANGUEIRA);
  return {
    totalSeeds: seeds,
    pitangueiras,
    bosques: Math.floor(seeds / SEEDS_PER_BOSQUE),
    remainingSeeds: seeds % SEEDS_PER_BROTO,
    brotos: Math.floor(seeds / SEEDS_PER_BROTO) % BROTOS_PER_MUDA,
    mudas: Math.floor(seeds / SEEDS_PER_MUDA) % MUDAS_PER_PITANGUEIRA,
    pitangueirasInCurrentBosque: pitangueiras % PITANGUEIRAS_PER_BOSQUE,
    pitangasEquivalent: pitangueiras,
    xpEquivalent: Math.floor(pitangueiras / PITANGAS_PER_XP),
  };
};

export const planPostSemeadura = (input: {
  acceptedSeeds: number;
  closed: boolean;
  alreadySeeded: boolean;
  isAuthor: boolean;
}): { status: 'accepted' | 'already_seeded' | 'closed'; count: number; nowClosed: boolean } => {
  const count = nonnegativeSafe(input.acceptedSeeds);
  if (count > SEEDS_PER_BOSQUE) throw new Error('SEMEADURA_POST_COUNT_EXCEEDS_CAP');
  if (input.isAuthor) throw new Error('SEMEADURA_SELF_RECOGNITION_DENIED');
  if (input.alreadySeeded) {
    return { status: 'already_seeded', count, nowClosed: input.closed || count === SEEDS_PER_BOSQUE };
  }
  if (input.closed || count === SEEDS_PER_BOSQUE) {
    return { status: 'closed', count, nowClosed: true };
  }
  const next = count + 1;
  return { status: 'accepted', count: next, nowClosed: next === SEEDS_PER_BOSQUE };
};

export const sumVerifiedPersonalSeeds = (posts: readonly { postId: string; seeds: number }[]): PitangueiraJourney => {
  const seen = new Set<string>();
  let total = 0;
  for (const post of posts) {
    if (!post.postId || seen.has(post.postId)) throw new Error('SEMEADURA_DUPLICATE_POST');
    seen.add(post.postId);
    const seeds = nonnegativeSafe(post.seeds);
    if (seeds > SEEDS_PER_BOSQUE) throw new Error('SEMEADURA_POST_COUNT_EXCEEDS_CAP');
    total += seeds;
    if (!Number.isSafeInteger(total)) throw new Error('SEMEADURA_COUNT_INVALID');
  }
  return calculatePitangueiraJourney(total);
};
