import type { SocialPost } from '../types';

/**
 * Praça is an opt-in public discovery surface with a rolling 24-hour window.
 * Expiry removes a publication only from the main Praça feed: the canonical
 * post remains available in its original profile, store or community surface,
 * subject to visibility, deletion and moderation rules.
 *
 * Connection-only and private posts must never enter the public Praça feed.
 */
export const SQUARE_FEED_WINDOW_MS = 24 * 60 * 60 * 1000;

export const selectPublicSquarePosts = (
  posts: readonly SocialPost[],
  now: number = Date.now()
): SocialPost[] =>
  posts.filter(post => {
    if (post.visibility !== 'public') return false;
    const createdAt = Date.parse(post.createdAt ?? '');
    return Number.isFinite(createdAt) &&
      createdAt > 0 &&
      createdAt <= now &&
      now - createdAt < SQUARE_FEED_WINDOW_MS;
  }).sort((left, right) =>
    Date.parse(right.createdAt ?? '') - Date.parse(left.createdAt ?? '')
  );
