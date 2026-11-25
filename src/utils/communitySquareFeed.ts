import {
  collection, deleteDoc, doc, getDoc, limit, onSnapshot, orderBy, query,
  setDoc, Timestamp, where, type Unsubscribe,
} from 'firebase/firestore';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, db } from './firebase';
import { createSessionFeedRegistry } from './sessionFeedRegistry';
import type { CloudCommunityPost } from './communityCloud';
import { createDetailSubscriptionRegistry } from './squareDetailSubscriptionRegistry';

export const COMMUNITY_SQUARE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const COMMUNITY_SQUARE_MAX_CANDIDATES = 90;
export const COMMUNITY_SQUARE_MAX_VISIBLE = 30;
export const COMMUNITY_SQUARE_MAX_PER_COMMUNITY = 3;

export const OPEN_COMMUNITY_FROM_SQUARE_EVENT = 'kyrub-open-community-from-square';

export interface CommunitySquareEntry {
  post: CloudCommunityPost;
  communityName: string;
  communityOwnerId: string;
  communityId: string;
  distributedAt: string;
  forwardedByName?: string;
  forwardedById?: string;
}

type SquarePointer = {
  postId: string;
  communityId: string;
  createdAt: Timestamp;
  forwardedByName?: string;
  forwardedById?: string;
};

const read = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const asTimestamp = (value: unknown): Timestamp | null =>
  value instanceof Timestamp ? value : null;

export const withinCommunitySquareWindow = (createdAt: number, now: number): boolean =>
  Number.isFinite(createdAt) && createdAt <= now && createdAt >= now - COMMUNITY_SQUARE_WINDOW_MS;

/** One immutable pointer to a canonical post, not a second publication.
 * Firestore rules require a genuine public community and the original author. */
export const publishCommunityPostToSquare = async (post: CloudCommunityPost): Promise<void> => {
  const user = auth.currentUser;
  if (!user || user.uid !== post.authorId) throw new Error('Somente o autor pode divulgar a publicação.');
  if (!withinCommunitySquareWindow(Date.parse(post.createdAt), Date.now())) {
    throw new Error('Esta publicação não está mais na janela de 24 horas da Praça.');
  }
  const original = await getDoc(doc(db, 'community_posts', post.id));
  if (!original.exists() || original.data().authorId !== user.uid) throw new Error('Publicação não encontrada.');
  const createdAt = asTimestamp(original.data().createdAt);
  if (!createdAt) throw new Error('Publicação sem data válida.');
  await setDoc(doc(db, 'community_square_posts', post.id), {
    postId: post.id,
    communityId: post.communityId,
    createdAt,
  });
};

export const removeCommunityPostFromSquare = async (post: CloudCommunityPost): Promise<void> => {
  if (!auth.currentUser || auth.currentUser.uid !== post.authorId) {
    throw new Error('Somente o autor pode retirar a publicação da Praça.');
  }
  await deleteDoc(doc(db, 'community_square_posts', post.id));
};

/** The community itself remains the authority for whether a pointer is public.
 * In particular, switching the community to private immediately hides content.
 * Capped listeners and a per-community cap prevent a single group from filling the Praça. */
const startCommunitySquareFeed = (
  onChange: (items: CommunitySquareEntry[]) => void,
  onError: (error: Error) => void,
): Unsubscribe => {
  const pointers = new Map<string, SquarePointer>();
  const posts = new Map<string, CloudCommunityPost>();
  const communities = new Map<string, { name: string; ownerId: string; visibility: string }>();
  const viewerId = auth.currentUser?.uid;
  let active = true;
  let originals: SquarePointer[] = [];
  let forwards: SquarePointer[] = [];

  const publish = () => {
    if (!active) return;
    if (!viewerId || auth.currentUser?.uid !== viewerId) { onChange([]); return; }
    const now = Date.now();
    const perCommunity = new Map<string, number>();
    const result: CommunitySquareEntry[] = [];
    const sorted = [...pointers.values()].sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
    for (const pointer of sorted) {
      if (result.length >= COMMUNITY_SQUARE_MAX_VISIBLE) break;
      if (!withinCommunitySquareWindow(pointer.createdAt.toMillis(), now)) continue;
      const post = posts.get(pointer.postId);
      const community = communities.get(pointer.communityId);
      if (!post || !community || community.visibility !== 'public'
        || post.communityId !== pointer.communityId
        || (!pointer.forwardedById
          && Math.abs(Date.parse(post.createdAt) - pointer.createdAt.toMillis()) > 2000)) continue;
      const count = perCommunity.get(pointer.communityId) || 0;
      if (count >= COMMUNITY_SQUARE_MAX_PER_COMMUNITY) continue;
      perCommunity.set(pointer.communityId, count + 1);
      result.push({
        post,
        communityId: pointer.communityId,
        communityName: community.name,
        communityOwnerId: community.ownerId,
        distributedAt: pointer.createdAt.toDate().toISOString(),
        forwardedByName: pointer.forwardedByName,
        forwardedById: pointer.forwardedById,
      });
    }
    onChange(result);
  };

  const postDetails = createDetailSubscriptionRegistry<SquarePointer>(
    (pointer, isCurrent, fail) => onSnapshot(doc(db, 'community_posts', pointer.postId),
      snapshotPost => {
        if (!isCurrent()) return;
        if (!snapshotPost.exists()) posts.delete(pointer.postId);
        else {
          const source = snapshotPost.data();
          if (source.communityId === pointer.communityId && typeof source.authorId === 'string' && source.authorId) {
            posts.set(pointer.postId, {
              id: pointer.postId, communityId: pointer.communityId, authorId: source.authorId,
              authorName: read(source.authorName) || 'Kairubido', authorAvatar: read(source.authorAvatar),
              content: read(source.content),
              mediaUrls: Array.isArray(source.mediaUrls) ? source.mediaUrls.filter((x): x is string => typeof x === 'string') : [],
              allowComments: source.allowComments !== false,
              pinnedCommentId: read(source.pinnedCommentId),
              createdAt: read(source.createdAtIso), updatedAt: read(source.updatedAtIso),
            });
          } else posts.delete(pointer.postId);
        }
        publish();
      },
      () => { if (!isCurrent()) return; fail(); publish(); },
    ),
    pointer => { posts.delete(pointer.postId); },
  );
  const communityDetails = createDetailSubscriptionRegistry<SquarePointer>(
    (pointer, isCurrent, fail) => onSnapshot(doc(db, 'communities', pointer.communityId),
      snap => {
        if (!isCurrent()) return;
        if (!snap.exists()) communities.delete(pointer.communityId);
        else {
          const data = snap.data();
          communities.set(pointer.communityId, {
            name: read(data.name), ownerId: read(data.ownerId), visibility: read(data.visibility),
          });
        }
        publish();
      },
      () => {
        if (!isCurrent()) return;
        // Permission loss or terminal error must retract cached details.
        fail();
        publish();
      },
    ),
    pointer => { communities.delete(pointer.communityId); },
  );

  const rebuild = (retryFailed = false) => {
    if (!active) return;
    if (!viewerId || auth.currentUser?.uid !== viewerId) {
      pointers.clear();
      postDetails.close();
      communityDetails.close();
      publish();
      return;
    }
    const selected = new Map<string, SquarePointer>();
    const perCommunity = new Map<string, number>();
    const sorted = [...originals, ...forwards]
      .filter(pointer => withinCommunitySquareWindow(pointer.createdAt.toMillis(), Date.now()))
      .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());

    for (const pointer of sorted) {
      if (selected.has(pointer.postId)) continue;
      if ((perCommunity.get(pointer.communityId) || 0) >= COMMUNITY_SQUARE_MAX_PER_COMMUNITY) continue;
      perCommunity.set(pointer.communityId, (perCommunity.get(pointer.communityId) || 0) + 1);
      selected.set(pointer.postId, pointer);
      if (selected.size >= COMMUNITY_SQUARE_MAX_VISIBLE) break;
    }

    pointers.clear();
    selected.forEach((value, id) => pointers.set(id, value));
    const desiredPosts = new Map<string, SquarePointer>();
    const desiredCommunities = new Map<string, SquarePointer>();
    for (const pointer of selected.values()) {
      // A changed distribution timestamp does not change canonical identity.
      // A different community for the same post requires a fresh listener.
      desiredPosts.set(JSON.stringify([pointer.postId, pointer.communityId]), pointer);
      desiredCommunities.set(pointer.communityId, pointer);
    }
    postDetails.reconcile(desiredPosts, retryFailed);
    communityDetails.reconcile(desiredCommunities, retryFailed);
    publish();
  };

  const stopOriginals = onSnapshot(
    query(
      collection(db, 'community_square_posts'),
      where('createdAt', '>=', Timestamp.fromMillis(Date.now() - COMMUNITY_SQUARE_WINDOW_MS)),
      orderBy('createdAt', 'desc'),
      limit(COMMUNITY_SQUARE_MAX_CANDIDATES),
    ),
    snapshot => {
      originals = snapshot.docs.flatMap(document => {
        const data = document.data();
        const postId = read(data.postId);
        const communityId = read(data.communityId);
        const createdAt = asTimestamp(data.createdAt);
        return postId && postId === document.id && communityId && createdAt
          ? [{ postId, communityId, createdAt }] : [];
      });
      rebuild(true);
    },
    error => { originals = []; rebuild(true); onError(error); },
  );

  const stopForwards = onSnapshot(
    query(
      collection(db, 'community_square_forwards'),
      where('forwardedAt', '>=', Timestamp.fromMillis(Date.now() - COMMUNITY_SQUARE_WINDOW_MS)),
      orderBy('forwardedAt', 'desc'),
      limit(COMMUNITY_SQUARE_MAX_CANDIDATES),
    ),
    snapshot => {
      forwards = snapshot.docs.flatMap(document => {
        const data = document.data();
        const postId = read(data.postId);
        const communityId = read(data.communityId);
        const actorId = read(data.actorId);
        const createdAt = asTimestamp(data.forwardedAt);
        if (!postId || !communityId || !actorId || !createdAt ||
          document.id !== `${postId}__${actorId}`) return [];
        return [{
          postId, communityId, createdAt,
          forwardedById: actorId,
          forwardedByName: read(data.actorName) || 'Kairubido',
        }];
      });
      rebuild(true);
    },
    error => { forwards = []; rebuild(true); onError(error); },
  );

  // Evict expired posts even without a fresh Firestore event.
  const timer = window.setInterval(() => rebuild(), 60_000);
  return () => {
    active = false;
    window.clearInterval(timer);
    stopOriginals();
    stopForwards();
    postDetails.close();
    communityDetails.close();
  };
};

// This registry is used only for the community feed, not the consumer's
// separate membership, saved items, connections or personal social data.
const sharedSquareFeed = createSessionFeedRegistry<CommunitySquareEntry[], User>(
  () => auth.currentUser,
  (viewer, change, error) => {
    if (auth.currentUser !== viewer) { change([]); return () => {}; }
    const stopFeed = startCommunitySquareFeed(change, error);
    const stopAuth = onAuthStateChanged(auth, () => sharedSquareFeed.invalidate());
    return () => { stopAuth(); stopFeed(); };
  },
  () => [],
  items => items.filter(item => withinCommunitySquareWindow(Date.parse(item.distributedAt), Date.now()))
    .map(item => ({ ...item, post: { ...item.post, mediaUrls: [...item.post.mediaUrls] } })),
);

export const subscribeCommunitySquareFeed = (
  onChange: (items: CommunitySquareEntry[]) => void,
  onError: (error: Error) => void,
): Unsubscribe => sharedSquareFeed.subscribe(onChange, onError);

export const subscribeCommunitySquareIds = (
  communityId: string,
  onChange: (ids: Set<string>) => void,
  onError: (error: Error) => void,
): Unsubscribe => onSnapshot(
  query(collection(db, 'community_square_posts'), where('communityId', '==', communityId)),
  snapshot => onChange(new Set(snapshot.docs.map(item => item.id))),
  onError,
);
