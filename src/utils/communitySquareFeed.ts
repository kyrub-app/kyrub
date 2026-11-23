import {
  collection, deleteDoc, doc, getDoc, limit, onSnapshot, orderBy, query,
  setDoc, Timestamp, where, type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import type { CloudCommunityPost } from './communityCloud';

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
export const subscribeCommunitySquareFeed = (
  onChange: (items: CommunitySquareEntry[]) => void,
  onError: (error: Error) => void,
): Unsubscribe => {
  const pointers = new Map<string, SquarePointer>();
  const posts = new Map<string, CloudCommunityPost>();
  const communities = new Map<string, { name: string; ownerId: string; visibility: string }>();
  let stopDetails: Unsubscribe[] = [];
  let active = true;
  let originals: SquarePointer[] = [];
  let forwards: SquarePointer[] = [];

  const publish = () => {
    if (!active) return;
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

  const rebuild = () => {
    if (!active) return;
    stopDetails.forEach(stop => stop());
    stopDetails = [];
    pointers.clear();
    posts.clear();
    communities.clear();

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
      selected.forEach((value, id) => pointers.set(id, value));
      for (const pointer of pointers.values()) {
        stopDetails.push(onSnapshot(doc(db, 'community_posts', pointer.postId),
          snapshotPost => {
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
          () => { posts.delete(pointer.postId); publish(); },
        ));
        if (!communities.has(pointer.communityId)) {
          // Sentinel avoids subscribing twice while preserving last snapshot authority.
          communities.set(pointer.communityId, { name: '', ownerId: '', visibility: 'unverified' });
          stopDetails.push(onSnapshot(doc(db, 'communities', pointer.communityId),
            snap => {
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
              // Revoked membership or newly private community: never use cached content.
              communities.delete(pointer.communityId);
              publish();
            },
          ));
        }
      }

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
      rebuild();
    },
    error => { originals = []; rebuild(); onError(error); },
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
      rebuild();
    },
    error => { forwards = []; rebuild(); onError(error); },
  );

  // Evict expired posts even without a fresh Firestore event.
  const timer = window.setInterval(publish, 60_000);
  return () => {
    active = false;
    window.clearInterval(timer);
    stopOriginals();
    stopForwards();
    stopDetails.forEach(stop => stop());
  };
};

export const subscribeCommunitySquareIds = (
  communityId: string,
  onChange: (ids: Set<string>) => void,
  onError: (error: Error) => void,
): Unsubscribe => onSnapshot(
  query(collection(db, 'community_square_posts'), where('communityId', '==', communityId)),
  snapshot => onChange(new Set(snapshot.docs.map(item => item.id))),
  onError,
);
