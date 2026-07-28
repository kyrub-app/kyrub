import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Timestamp,
} from 'firebase/firestore';
import type { SocialPost } from '../types';
import { auth, db } from '../utils/firebase';

export interface SocialPostComment {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  text: string;
  createdAt: string;
}

type SocialLikeRecord = {
  id: string;
  postId: string;
  userId: string;
};

const readString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const readStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];

const timestampToIso = (value: unknown, fallback = ''): string => {
  if (value && typeof value === 'object' && 'toDate' in value) {
    try {
      return (value as Timestamp).toDate().toISOString();
    } catch {
      return fallback;
    }
  }
  return fallback;
};

const formatRelativeTime = (isoValue: string): string => {
  const timestamp = Date.parse(isoValue);
  if (!Number.isFinite(timestamp)) return 'Agora mesmo';

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 60) return 'Agora mesmo';
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d`;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
  }).format(new Date(timestamp));
};

const mapPost = (
  id: string,
  data: Record<string, unknown>
): SocialPost | null => {
  const authorId = readString(data.authorId);
  const user = readString(data.authorName) || readString(data.user);
  const publicationType = data.publicationType === 'status' ? 'status' : 'feed';
  const visibility = data.visibility === 'connections'
    ? 'connections'
    : data.visibility === 'private'
      ? 'private'
      : 'public';
  if (!authorId || !user || visibility === 'private') return null;

  const createdAt =
    readString(data.createdAtIso) || timestampToIso(data.createdAt, new Date().toISOString());

  return {
    id,
    authorId,
    user,
    avatar: readString(data.authorAvatar),
    time: formatRelativeTime(createdAt),
    createdAt,
    content: readString(data.content),
    likes: 0,
    mediaUrls: readStringList(data.mediaUrls),
    taggedUsers: readStringList(data.taggedUsers),
    taggedUserIds: readStringList(data.taggedUserIds),
    publicationType,
    visibility,
    audienceIds: readStringList(data.audienceIds),
  };
};

const mapComment = (
  id: string,
  data: Record<string, unknown>
): SocialPostComment | null => {
  const postId = readString(data.postId);
  const authorId = readString(data.authorId);
  const text = readString(data.text);
  if (!postId || !authorId || !text) return null;

  return {
    id,
    postId,
    authorId,
    authorName: readString(data.authorName) || 'Usuário Kyrub',
    authorAvatar: readString(data.authorAvatar),
    text,
    createdAt:
      readString(data.createdAtIso) ||
      timestampToIso(data.createdAt, new Date().toISOString()),
  };
};

const mergePosts = (
  publicPosts: SocialPost[],
  connectionPosts: SocialPost[]
): SocialPost[] => {
  const byId = new Map<string, SocialPost>();
  for (const post of [...publicPosts, ...connectionPosts]) byId.set(post.id, post);
  return [...byId.values()].sort(
    (left, right) =>
      Date.parse(right.createdAt ?? '') - Date.parse(left.createdAt ?? '')
  );
};

export function usePublicSocialFeed() {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [likes, setLikes] = useState<SocialLikeRecord[]>([]);
  const [comments, setComments] = useState<SocialPostComment[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribePublicPosts = () => undefined;
    let unsubscribeConnectionPosts = () => undefined;
    let unsubscribeLikes = () => undefined;
    let unsubscribeComments = () => undefined;
    let publicPosts: SocialPost[] = [];
    let connectionPosts: SocialPost[] = [];
    let publicReady = false;
    let connectionsReady = false;

    const publishPosts = () => {
      setPosts(mergePosts(publicPosts, connectionPosts));
      setLoading(!(publicReady && connectionsReady));
    };

    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribePublicPosts();
      unsubscribeConnectionPosts();
      unsubscribeLikes();
      unsubscribeComments();
      setCurrentUserId(user?.uid ?? '');
      setPosts([]);
      setLikes([]);
      setComments([]);
      publicPosts = [];
      connectionPosts = [];
      publicReady = false;
      connectionsReady = false;
      setLoading(Boolean(user));

      if (!user) {
        setLoading(false);
        return;
      }

      unsubscribePublicPosts = onSnapshot(
        query(
          collection(db, 'social_posts'),
          where('visibility', '==', 'public')
        ),
        snapshot => {
          publicPosts = snapshot.docs.flatMap(snapshotDocument => {
            const post = mapPost(
              snapshotDocument.id,
              snapshotDocument.data() as Record<string, unknown>
            );
            return post ? [post] : [];
          });
          publicReady = true;
          publishPosts();
        },
        error => {
          console.warn('Não foi possível carregar o feed público.', error);
          publicReady = true;
          publishPosts();
        }
      );

      unsubscribeConnectionPosts = onSnapshot(
        query(
          collection(db, 'social_posts'),
          where('audienceIds', 'array-contains', user.uid)
        ),
        snapshot => {
          connectionPosts = snapshot.docs.flatMap(snapshotDocument => {
            const post = mapPost(
              snapshotDocument.id,
              snapshotDocument.data() as Record<string, unknown>
            );
            return post ? [post] : [];
          });
          connectionsReady = true;
          publishPosts();
        },
        error => {
          console.warn('Não foi possível carregar os status das conexões.', error);
          connectionsReady = true;
          publishPosts();
        }
      );

      unsubscribeLikes = onSnapshot(
        collection(db, 'social_post_likes'),
        snapshot => {
          setLikes(
            snapshot.docs.flatMap(snapshotDocument => {
              const data = snapshotDocument.data() as Record<string, unknown>;
              const postId = readString(data.postId);
              const userId = readString(data.userId);
              return postId && userId
                ? [{ id: snapshotDocument.id, postId, userId }]
                : [];
            })
          );
        },
        error => {
          console.warn('Não foi possível carregar as curtidas do feed.', error);
        }
      );

      unsubscribeComments = onSnapshot(
        collection(db, 'social_post_comments'),
        snapshot => {
          setComments(
            snapshot.docs
              .flatMap(snapshotDocument => {
                const comment = mapComment(
                  snapshotDocument.id,
                  snapshotDocument.data() as Record<string, unknown>
                );
                return comment ? [comment] : [];
              })
              .sort(
                (left, right) =>
                  Date.parse(left.createdAt) - Date.parse(right.createdAt)
              )
          );
        },
        error => {
          console.warn('Não foi possível carregar os comentários do feed.', error);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribePublicPosts();
      unsubscribeConnectionPosts();
      unsubscribeLikes();
      unsubscribeComments();
    };
  }, []);

  const likeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const like of likes) {
      counts.set(like.postId, (counts.get(like.postId) ?? 0) + 1);
    }
    return counts;
  }, [likes]);

  const likedPostIds = useMemo(
    () =>
      new Set(
        likes
          .filter(like => like.userId === currentUserId)
          .map(like => like.postId)
      ),
    [currentUserId, likes]
  );

  const commentsByPost = useMemo(() => {
    const grouped = new Map<string, SocialPostComment[]>();
    for (const comment of comments) {
      const current = grouped.get(comment.postId) ?? [];
      current.push(comment);
      grouped.set(comment.postId, current);
    }
    return grouped;
  }, [comments]);

  const postsWithInteractions = useMemo(
    () =>
      posts.map(post => ({
        ...post,
        likes: likeCounts.get(post.id) ?? 0,
        commentCount: commentsByPost.get(post.id)?.length ?? 0,
      })),
    [commentsByPost, likeCounts, posts]
  );

  const toggleLike = async (postId: string) => {
    const user = auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');

    const likeId = `${postId}__${user.uid}`;
    const likeReference = doc(db, 'social_post_likes', likeId);
    if (likedPostIds.has(postId)) {
      await deleteDoc(likeReference);
      return;
    }

    await setDoc(likeReference, {
      postId,
      userId: user.uid,
      createdAt: serverTimestamp(),
    });
  };

  const addComment = async (postId: string, text: string) => {
    const user = auth.currentUser;
    const normalizedText = text.trim();
    if (!user) throw new Error('Usuário não autenticado.');
    if (!normalizedText) throw new Error('O comentário está vazio.');

    const commentReference = doc(collection(db, 'social_post_comments'));
    await setDoc(commentReference, {
      postId,
      authorId: user.uid,
      authorName:
        user.displayName || user.email?.split('@')[0] || 'Usuário Kyrub',
      authorAvatar: user.photoURL || '',
      text: normalizedText.slice(0, 1000),
      createdAtIso: new Date().toISOString(),
      createdAt: serverTimestamp(),
    });
  };

  const deleteComment = async (commentId: string) => {
    await deleteDoc(doc(db, 'social_post_comments', commentId));
  };

  return {
    posts: postsWithInteractions,
    loading,
    currentUserId,
    likedPostIds,
    commentsByPost,
    toggleLike,
    addComment,
    deleteComment,
  };
}
