/**
 * A publication's authorId is immutable. Names and avatars in saved posts are
 * fallbacks only: the current public profile controls what readers see.
 * No post ownership, engagement, notification or historical record is mutated.
 */
export interface AuthorDisplayIdentity {
  name: string;
  avatar?: string;
}

export const displayAuthorName = (
  authorId: string,
  savedName: string,
  current: Readonly<Record<string, AuthorDisplayIdentity>>,
): string => current[authorId]?.name || savedName;

export const displayAuthorAvatar = (
  authorId: string,
  savedAvatar: string,
  current: Readonly<Record<string, AuthorDisplayIdentity>>,
): string => current[authorId]?.avatar ?? savedAvatar;
