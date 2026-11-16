import type { SocialPost } from '../types';

/**
 * Praça is an opt-in public surface. The social hook also returns private
 * timeline posts and connection-scoped Status for profile/connected surfaces;
 * those must never be rendered as Praça cards, even for their own author.
 */
export const selectPublicSquarePosts = (posts: readonly SocialPost[]): SocialPost[] =>
  posts.filter(post => post.visibility === 'public');
