import type { SocialPost } from '../types';

/**
 * Praça is an opt-in public surface. The social hook also returns private
 * timeline posts and connection-scoped Status for profile/connected surfaces;
 * those must never be rendered as Praça cards, even for their own author.
 */
const STATUS_TTL_MS = 24 * 60 * 60 * 1000;

export const selectPublicSquarePosts = (
  posts: readonly SocialPost[],
  now: number = Date.now()
): SocialPost[] =>
  posts.filter(post => {
    if (post.visibility !== 'public') return false;
    if (post.publicationType !== 'status') return true;
    const createdAt = Date.parse(post.createdAt ?? '');
    return Number.isFinite(createdAt) &&
      createdAt > 0 &&
      now - createdAt < STATUS_TTL_MS;
  });
