import { adminDb } from '../firebaseAdmin.js';
import { projectPublicSquareCommunity } from './publicSquareDiscoveryService.js';

// Small, deterministic pages; never scan or return private community documents.
// A raw Firestore document ID is a cursor, not an authorization capability.
export const PUBLIC_COMMUNITY_PAGE_SIZE = 20;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export const parsePublicCommunityCursor = (cursor: unknown): string | null => {
  if (cursor === undefined || cursor === null || cursor === '') return null;
  if (typeof cursor !== 'string' || !CURSOR_PATTERN.test(cursor)) {
    throw new Error('INVALID_COMMUNITY_CURSOR');
  }
  return cursor;
};

export const listPublicCommunityPage = async (rawCursor?: string) => {
  const cursor = parsePublicCommunityCursor(rawCursor);
  let query = adminDb.collection('communities')
    .where('visibility', 'in', ['public', 'moderated'])
    .orderBy('__name__');
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.limit(PUBLIC_COMMUNITY_PAGE_SIZE + 1).get();
  const documents = snapshot.docs.slice(0, PUBLIC_COMMUNITY_PAGE_SIZE);
  const communities = documents
    .map(document => projectPublicSquareCommunity({
      ...document.data(), communityId: document.id,
    }))
    .filter((item): item is NonNullable<typeof item> => item !== null);
  return {
    communities,
    nextCursor: snapshot.docs.length > PUBLIC_COMMUNITY_PAGE_SIZE
      ? documents[documents.length - 1].id : null,
  };
};
