import { buildPublicDestinationPath } from '../../shared/publicDestinationRoutes.js';

export type SocialDestinationKind = 'profile' | 'community';
export type PublicSocialDestination = {
  kind: SocialDestinationKind; identifier: string; name: string;
  description: string; image: string;
};
export type SocialAddressRecord = { kind: SocialDestinationKind; identifier: string; targetId: string };
const clean = (v: unknown, n: number) => typeof v === 'string' ? v.trim().slice(0,n) : '';
export const isDocumentId = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
export function isSocialAddress(kind: unknown, identifier: unknown): kind is SocialDestinationKind {
  return (kind === 'profile' || kind === 'community') && typeof identifier === 'string'
    && Boolean(buildPublicDestinationPath(kind, identifier)) && identifier.length >= 3;
}
export function canReserveSocialAddress(kind: SocialDestinationKind, actor: string, targetId: string, source: Record<string, unknown> | undefined): boolean {
  if (!source || !isDocumentId(actor) || !isDocumentId(targetId)) return false;
  // Reserving a personal identity does not publish the profile.
  // Public projection independently requires explicit visibility.
  return kind === 'profile' ? actor === targetId
    : source.ownerId === actor && (source.visibility === 'public' || source.visibility === 'moderated');
}
export function projectSocialAddress(record: SocialAddressRecord, source: Record<string, unknown> | undefined, profile?: Record<string, unknown>): PublicSocialDestination | null {
  if (!source || !isSocialAddress(record.kind,record.identifier) || !isDocumentId(record.targetId)) return null;
  if (record.kind === 'profile' ? source.isProfileVisible !== true :
      source.visibility !== 'public' && source.visibility !== 'moderated') return null;
  // Explicit public projection only; never fall back to email or private account fields.
  const name = record.kind === 'profile' ? clean(profile?.name,160) || clean(source.name,160) : clean(source.name,80);
  if (!name) return null;
  const photo = clean(record.kind === 'profile' ? profile?.photoUrl || source.photoUrl : source.coverImage,2048);
  return {kind:record.kind, identifier:record.identifier, name,
    description: record.kind === 'profile' ? clean(profile?.bio,280) : clean(source.description,500),
    image: /^https:\/\//i.test(photo) ? photo : ''};
}

/** Both indices must attest the same identity; neither alone proves ownership. */
export function matchesSocialAddressRecord(record: Record<string, unknown> | undefined, kind: SocialDestinationKind, identifier: string, targetId: string): boolean {
  return isSocialAddress(kind, identifier) && isDocumentId(targetId) &&
    record?.kind === kind && record.identifier === identifier && record.targetId === targetId;
}
