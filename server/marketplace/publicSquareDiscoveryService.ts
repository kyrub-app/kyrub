import { adminDb } from '../firebaseAdmin.js';

/**
 * Read-only Praça discovery for visitors. Firestore client permissions remain
 * unchanged: every document is filtered and projected on the server.
 * No account IDs, private member lists, purchase data or contact details leave
 * this endpoint. Limits also bound anonymous Firestore usage.
 */
const str = (value: unknown, max = 300): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const publicImage = (value: unknown): string => {
  const image = str(value, 2048);
  return /^https:\/\//i.test(image) ? image : '';
};

const images = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(publicImage).filter(Boolean).slice(0, 4) : [];

const readDate = (data: Record<string, unknown>): string => {
  const iso = str(data.createdAtIso, 64);
  if (Number.isFinite(Date.parse(iso))) return iso;
  const value = data.createdAt;
  if (value && typeof value === 'object' && 'toDate' in value) {
    const toDate = (value as { toDate: () => Date }).toDate;
    if (typeof toDate === 'function') {
      const date = toDate.call(value);
      if (date instanceof Date && Number.isFinite(date.getTime())) return date.toISOString();
    }
  }
  return '';
};

export function projectPublicSquareStore(data: Record<string, unknown>) {
  if (data.publicationStatus !== 'published' ||
      (data.listingType !== 'store' && data.listingType !== undefined)) return null;
  const id = str(data.storeId || data.id, 128);
  const name = str(data.name, 160);
  const slug = str(data.slug, 160);
  if (!id || !name || !slug || !/^[a-z0-9-]+$/.test(slug)) return null;
  return {
    id, name, slug,
    description: str(data.description, 500),
    logo: publicImage(data.logo),
    banner: publicImage(data.banner),
    keywords: Array.isArray(data.keywords)
      ? data.keywords.filter((value): value is string => typeof value === 'string').map(value => value.slice(0, 80)).slice(0, 6)
      : [],
  };
}

export function projectPublicSquareCommunity(data: Record<string, unknown>) {
  if (data.visibility !== 'public' && data.visibility !== 'moderated') return null;
  const id = str(data.communityId, 128);
  const name = str(data.name, 80);
  if (!id || !name) return null;
  return {
    id, name,
    description: str(data.description, 500),
    category: str(data.category, 80),
    coverImage: publicImage(data.coverImage),
    visibility: data.visibility as 'public' | 'moderated',
    memberCount: typeof data.memberCount === 'number' && Number.isInteger(data.memberCount)
      ? Math.max(0, data.memberCount) : 0,
  };
}

export function projectPublicSquareSocialPost(id: string, data: Record<string, unknown>) {
  if (data.visibility !== 'public') return null;
  const authorName = str(data.authorName || data.user, 160);
  if (!id || !authorName) return null;
  const createdAt = readDate(data);
  if (!createdAt) return null;
  const publicationType = data.publicationType === 'status' ? 'status' : 'feed';
  if (publicationType === 'status' && Date.now() - Date.parse(createdAt) > 86_400_000) return null;
  return {
    id, authorName,
    authorAvatar: publicImage(data.authorAvatar),
    content: str(data.content, 3000),
    mediaUrls: images(data.mediaUrls),
    createdAt,
    publicationType,
    kind: 'social' as const,
  };
}

export function projectPublicSquareCommunityPost(
  id: string,
  pointer: Record<string, unknown>,
  community: Record<string, unknown>,
  post: Record<string, unknown>,
) {
  if (community.visibility !== 'public' ||
      str(pointer.communityId, 128) !== str(post.communityId, 128) ||
      str(pointer.postId, 128) !== id) return null;
  const communityName = str(community.name, 80);
  const authorName = str(post.authorName, 160);
  const createdAt = readDate(pointer);
  if (!communityName || !authorName || !createdAt ||
      Date.now() - Date.parse(createdAt) > 86_400_000) return null;
  return {
    id: 'community_' + id,
    authorName,
    authorAvatar: publicImage(post.authorAvatar),
    content: str(post.content, 3000),
    mediaUrls: images(post.mediaUrls),
    createdAt,
    publicationType: 'feed' as const,
    kind: 'community' as const,
    communityName,
  };
}

export const listPublicSquareDiscovery = async () => {
  const [listings, tenants, communities, socialPosts, pointers] = await Promise.all([
    adminDb.collection('marketplace_listings').where('publicationStatus', '==', 'published').limit(90).get(),
    adminDb.collection('tenants').where('publicationStatus', '==', 'published').limit(50).get(),
    adminDb.collection('communities').where('visibility', 'in', ['public', 'moderated']).limit(50).get(),
    adminDb.collection('social_posts').where('visibility', '==', 'public').limit(60).get(),
    adminDb.collection('community_square_posts').orderBy('createdAt', 'desc').limit(20).get(),
  ]);

  const storesById = new Map<string, NonNullable<ReturnType<typeof projectPublicSquareStore>>>();
  for (const document of tenants.docs) {
    const store = projectPublicSquareStore({ ...document.data(), id: document.id });
    if (store) storesById.set(store.id, store);
  }
  for (const document of listings.docs) {
    const store = projectPublicSquareStore(document.data());
    if (store) storesById.set(store.id, store);
  }

  const offerStoreIds = listings.docs
    .filter(document => document.data().listingType === 'offer')
    .map(document => str(document.data().storeId, 128))
    .filter(Boolean);

  const communityCards = communities.docs
    .map(document => projectPublicSquareCommunity({ ...document.data(), communityId: document.id }))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => b.memberCount - a.memberCount || a.name.localeCompare(b.name, 'pt-BR'))
    .slice(0, 30);

  // Preserve a stable internal link from each public post to its author.
  // The API response never exposes user IDs or account documents.
  const authorUidByCardId = new Map<string, string>();
  const socialCards = socialPosts.docs
    .map(document => {
      const data = document.data();
      authorUidByCardId.set(document.id, str(data.authorId, 128));
      return projectPublicSquareSocialPost(document.id, data);
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  // Recheck the canonical community and post before disclosing a forwarded
  // publication: the community may have become private after publication.
  const recentPointers = pointers.docs.filter(document => {
    const data = document.data();
    const createdAt = readDate(data);
    return createdAt && Date.now() - Date.parse(createdAt) <= 86_400_000;
  }).slice(0, 12);
  const forwardedCards = await Promise.all(recentPointers.map(async document => {
    const data = document.data();
    const communityId = str(data.communityId, 128);
    const postId = str(data.postId, 128);
    if (!communityId || !postId || postId !== document.id) return null;
    const [community, post] = await Promise.all([
      adminDb.collection('communities').doc(communityId).get(),
      adminDb.collection('community_posts').doc(postId).get(),
    ]);
    if (!community.exists || !post.exists) return null;
    const card = projectPublicSquareCommunityPost(postId, data, community.data() ?? {}, post.data() ?? {});
    if (card) authorUidByCardId.set(card.id, str(post.data()?.authorId, 128));
    return card;
  }));

  const publicPosts = [...socialCards, ...forwardedCards.filter((entry): entry is NonNullable<typeof entry> => entry !== null)]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 40);

  // Only hydrate authors whose publications passed all public visibility
  // checks. A name change updates historical public cards without rewriting
  // immutable posts or exposing private account fields. Reads are capped by
  // the 40-item response and failure falls back to the existing post snapshot.
  const authorUids = [...new Set(publicPosts.map(post => authorUidByCardId.get(post.id) || '')
    .filter(uid => /^[A-Za-z0-9_-]{1,128}$/.test(uid)))];
  const names = new Map<string, { name: string; avatar?: string }>();
  await Promise.all(authorUids.map(async uid => {
    try {
      const profile = await adminDb.collection('users').doc(uid).get();
      const data = profile.data();
      const name = str(data?.name, 80);
      if (name) names.set(uid, { name, avatar: publicImage(data?.photoUrl) });
    } catch {
      // A public feed still works when author metadata is temporarily missing.
    }
  }));

  return {
    stores: [...storesById.values()].slice(0, 40),
    offerStoreIds: [...new Set(offerStoreIds)].slice(0, 60),
    communities: communityCards,
    posts: publicPosts.map(post => {
      const current = names.get(authorUidByCardId.get(post.id) || '');
      return current ? { ...post, authorName: current.name, authorAvatar: current.avatar } : post;
    }),
  };
};
