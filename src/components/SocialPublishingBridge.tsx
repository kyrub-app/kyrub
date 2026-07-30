import { useEffect } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadString } from 'firebase/storage';
import type { SocialPost } from '../types';
import { auth, db, storage } from '../utils/firebase';

type LocalSocialPost = SocialPost & {
  authorId?: string;
  publicationType?: 'feed' | 'status';
  taggedUsers?: string[];
  taggedUserIds?: string[];
  createdAt?: string;
  visibility?: 'public' | 'private' | 'connections';
  audienceIds?: string[];
};

type SocialPostsUpdatedDetail = {
  uid?: string;
  posts?: LocalSocialPost[];
  source?: 'local' | 'cloud';
};

type SocialPublishRetryDetail = {
  uid?: string;
  sourcePostId?: string;
};

type SocialPublishResultDetail = {
  uid: string;
  sourcePostId: string;
  status: 'success' | 'error';
  code?: string;
  message: string;
};

const LEGACY_POSTS_KEY = 'kyrub_posts';
const getUserPostsKey = (uid: string) => `kyrub_posts_${uid}`;

const readStoredPosts = (rawValue: string | null): LocalSocialPost[] => {
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? (parsed as LocalSocialPost[]) : [];
  } catch (error) {
    console.warn('Não foi possível ler publicações locais para sincronização.', error);
    return [];
  }
};

const readString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const readStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];

const cloudPostId = (uid: string, localPostId: string) =>
  `${uid}__${localPostId.replaceAll('/', '_')}`.slice(0, 500);

const readErrorCode = (error: unknown): string => {
  if (!error || typeof error !== 'object' || !('code' in error)) return 'unknown';
  return typeof error.code === 'string' ? error.code : 'unknown';
};

const publicationErrorMessage = (error: unknown): string => {
  const code = readErrorCode(error);
  if (code.includes('permission-denied')) {
    return 'O Firebase recusou a publicação. Atualize as regras sociais e tente sincronizar novamente.';
  }
  if (code.startsWith('storage/')) {
    return 'A publicação contém imagem, mas o Firebase Storage ainda não está ativo. O conteúdo ficou pendente.';
  }
  if (code === 'unavailable' || code.includes('network')) {
    return 'A conexão com o Firebase está indisponível. A publicação ficou pendente para nova tentativa.';
  }
  return 'Não foi possível sincronizar a publicação com o Firebase. O conteúdo permaneceu pendente.';
};

const dispatchPublishResult = (detail: SocialPublishResultDetail) => {
  window.dispatchEvent(
    new CustomEvent<SocialPublishResultDetail>('kyrub-social-publish-result', {
      detail,
    })
  );
};

const uploadPostMedia = async (
  userId: string,
  postId: string,
  mediaUrls: string[]
): Promise<string[]> => {
  const uploadedUrls: string[] = [];

  for (const [index, mediaUrl] of mediaUrls.slice(0, 9).entries()) {
    if (/^https?:\/\//i.test(mediaUrl)) {
      uploadedUrls.push(mediaUrl);
      continue;
    }
    if (!mediaUrl.startsWith('data:image/')) continue;

    const contentType = mediaUrl.match(/^data:([^;,]+)/)?.[1] || 'image/jpeg';
    const extension = contentType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
    const mediaReference = ref(
      storage,
      `social-posts/${userId}/${postId}/${index}.${extension}`
    );
    await uploadString(mediaReference, mediaUrl, 'data_url', { contentType });
    uploadedUrls.push(await getDownloadURL(mediaReference));
  }

  return uploadedUrls;
};

const cloudDocumentToLocalPost = (
  id: string,
  data: Record<string, unknown>
): LocalSocialPost | null => {
  const authorId = readString(data.authorId);
  const user = readString(data.authorName);
  if (!authorId || !user) return null;

  const visibility =
    data.visibility === 'connections'
      ? 'connections'
      : data.visibility === 'private'
        ? 'private'
        : 'public';

  return {
    id: readString(data.sourcePostId) || id,
    authorId,
    user,
    avatar: readString(data.authorAvatar),
    time: 'Sincronizado',
    createdAt: readString(data.createdAtIso),
    content: readString(data.content),
    likes: 0,
    mediaUrls: readStringList(data.mediaUrls),
    taggedUsers: readStringList(data.taggedUsers),
    taggedUserIds: readStringList(data.taggedUserIds),
    publicationType: data.publicationType === 'status' ? 'status' : 'feed',
    visibility,
    audienceIds: readStringList(data.audienceIds),
  };
};

const writeCloudPost = async (
  user: User,
  post: LocalSocialPost,
  connectedAudienceIds: string[]
): Promise<string> => {
  const sourcePostId =
    post.id || `${post.publicationType ?? 'feed'}-${Date.now()}`;
  const postId = cloudPostId(user.uid, sourcePostId);
  const createdAtIso = post.createdAt || new Date().toISOString();
  const mediaUrls = await uploadPostMedia(
    user.uid,
    postId,
    Array.isArray(post.mediaUrls) ? post.mediaUrls : []
  );
  const isStatus = post.publicationType === 'status';
  const taggedUserIds = Array.isArray(post.taggedUserIds)
    ? post.taggedUserIds.slice(0, 30)
    : [];
  const visibility = isStatus
    ? post.visibility === 'public'
      ? 'public'
      : 'connections'
    : post.visibility === 'private'
      ? 'private'
      : 'public';
  const audienceIds = isStatus
    ? [...new Set([user.uid, ...connectedAudienceIds])].slice(0, 500)
    : visibility === 'private'
      ? [...new Set([user.uid, ...taggedUserIds])].slice(0, 500)
      : [...new Set(taggedUserIds)].slice(0, 30);

  await setDoc(doc(db, 'social_posts', postId), {
    postId,
    sourcePostId,
    authorId: user.uid,
    authorName:
      post.user ||
      user.displayName ||
      user.email?.split('@')[0] ||
      'Usuário Kyrub',
    authorAvatar: post.avatar || user.photoURL || '',
    content: post.content || '',
    publicationType: isStatus ? 'status' : 'feed',
    taggedUsers: Array.isArray(post.taggedUsers)
      ? post.taggedUsers.slice(0, 30)
      : [],
    taggedUserIds,
    mediaUrls,
    visibility,
    audienceIds,
    createdAtIso,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return sourcePostId;
};

export function SocialPublishingBridge() {
  useEffect(() => {
    let cancelled = false;
    let unsubscribePosts = () => undefined;
    let unsubscribeConnections = () => undefined;
    let activeUser: User | null = null;
    let cloudReadyFromServer = false;
    let connectionsReadyFromServer = false;
    let connectedAudienceIds: string[] = [];
    let queuedLocalPosts: LocalSocialPost[] = [];
    let ownCloudPosts: LocalSocialPost[] = [];
    let lastPublishedCloudSignature = '';
    const knownCloudPostIds = new Set<string>();
    const pendingCloudPostIds = new Set<string>();
    const failedCloudPostIds = new Set<string>();

    const hasUnsyncedLocalPosts = () => {
      const user = activeUser;
      if (!user) return false;
      return queuedLocalPosts.some(post => {
        if (post.authorId && post.authorId !== user.uid) return false;
        if (!post.id) return false;
        return !knownCloudPostIds.has(cloudPostId(user.uid, post.id));
      });
    };

    const publishOwnCloudState = () => {
      const user = activeUser;
      if (
        !user ||
        cancelled ||
        pendingCloudPostIds.size > 0 ||
        hasUnsyncedLocalPosts()
      ) {
        return;
      }

      const sortedPosts = [...ownCloudPosts].sort(
        (left, right) =>
          Date.parse(right.createdAt ?? '') - Date.parse(left.createdAt ?? '')
      );
      const cloudSignature = JSON.stringify(sortedPosts);
      if (cloudSignature === lastPublishedCloudSignature) return;

      try {
        localStorage.setItem(getUserPostsKey(user.uid), cloudSignature);
        localStorage.setItem(LEGACY_POSTS_KEY, cloudSignature);
      } catch (error) {
        console.warn('Não foi possível atualizar o cache social local.', error);
      }

      lastPublishedCloudSignature = cloudSignature;
      window.dispatchEvent(
        new CustomEvent('kyrub-social-posts-updated', {
          detail: {
            uid: user.uid,
            posts: sortedPosts,
            source: 'cloud',
          },
        })
      );
    };

    const reconcileLocalPosts = () => {
      const user = activeUser;
      if (!user || cancelled || !cloudReadyFromServer) return;

      for (const post of queuedLocalPosts) {
        if (post.authorId && post.authorId !== user.uid) continue;
        if (post.publicationType === 'status' && !connectionsReadyFromServer) {
          continue;
        }
        const sourcePostId = post.id || '';
        if (!sourcePostId) continue;
        const postId = cloudPostId(user.uid, sourcePostId);
        if (
          knownCloudPostIds.has(postId) ||
          pendingCloudPostIds.has(postId) ||
          failedCloudPostIds.has(postId)
        ) {
          continue;
        }

        pendingCloudPostIds.add(postId);
        void writeCloudPost(user, post, connectedAudienceIds)
          .then(syncedSourcePostId => {
            failedCloudPostIds.delete(postId);
            dispatchPublishResult({
              uid: user.uid,
              sourcePostId: syncedSourcePostId,
              status: 'success',
              message: 'Publicação sincronizada com o Firebase.',
            });
          })
          .catch(error => {
            failedCloudPostIds.add(postId);
            const code = readErrorCode(error);
            console.warn('Não foi possível publicar conteúdo social na nuvem.', {
              code,
              sourcePostId,
              error,
            });
            dispatchPublishResult({
              uid: user.uid,
              sourcePostId,
              status: 'error',
              code,
              message: publicationErrorMessage(error),
            });
          })
          .finally(() => {
            pendingCloudPostIds.delete(postId);
            publishOwnCloudState();
          });
      }

      publishOwnCloudState();
    };

    const handlePostsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<SocialPostsUpdatedDetail>).detail;
      if (
        detail?.source === 'cloud' ||
        !activeUser ||
        detail?.uid !== activeUser.uid ||
        !Array.isArray(detail.posts)
      ) {
        return;
      }
      queuedLocalPosts = detail.posts;
      reconcileLocalPosts();
    };

    const handleRetry = (event: Event) => {
      const detail = (event as CustomEvent<SocialPublishRetryDetail>).detail;
      const user = activeUser;
      if (!user || detail?.uid !== user.uid) return;

      if (detail.sourcePostId) {
        failedCloudPostIds.delete(cloudPostId(user.uid, detail.sourcePostId));
      } else {
        failedCloudPostIds.clear();
      }
      reconcileLocalPosts();
    };

    window.addEventListener(
      'kyrub-social-posts-updated',
      handlePostsUpdated as EventListener
    );
    window.addEventListener(
      'kyrub-social-publish-retry',
      handleRetry as EventListener
    );

    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribePosts();
      unsubscribeConnections();
      unsubscribePosts = () => undefined;
      unsubscribeConnections = () => undefined;
      activeUser = user;
      cloudReadyFromServer = false;
      connectionsReadyFromServer = false;
      connectedAudienceIds = [];
      queuedLocalPosts = [];
      ownCloudPosts = [];
      lastPublishedCloudSignature = '';
      knownCloudPostIds.clear();
      pendingCloudPostIds.clear();
      failedCloudPostIds.clear();

      if (!user) return;

      queuedLocalPosts = readStoredPosts(
        localStorage.getItem(getUserPostsKey(user.uid)) ??
          localStorage.getItem(LEGACY_POSTS_KEY)
      );

      unsubscribeConnections = onSnapshot(
        query(
          collection(db, 'connections'),
          where('participantIds', 'array-contains', user.uid)
        ),
        { includeMetadataChanges: true },
        snapshot => {
          connectedAudienceIds = snapshot.docs.flatMap(snapshotDocument => {
            const data = snapshotDocument.data() as Record<string, unknown>;
            if (data.status !== 'accepted') return [];
            const senderId = readString(data.senderId);
            const receiverId = readString(data.receiverId);
            const otherId = senderId === user.uid ? receiverId : senderId;
            return otherId && otherId !== user.uid ? [otherId] : [];
          });
          if (!snapshot.metadata.fromCache) connectionsReadyFromServer = true;
          reconcileLocalPosts();
        },
        error => {
          console.warn('Não foi possível carregar a audiência dos status.', error);
          connectionsReadyFromServer = true;
          connectedAudienceIds = [];
          reconcileLocalPosts();
        }
      );

      unsubscribePosts = onSnapshot(
        query(
          collection(db, 'social_posts'),
          where('authorId', '==', user.uid)
        ),
        { includeMetadataChanges: true },
        snapshot => {
          knownCloudPostIds.clear();
          const nextOwnPosts: LocalSocialPost[] = [];

          for (const snapshotDocument of snapshot.docs) {
            knownCloudPostIds.add(snapshotDocument.id);
            failedCloudPostIds.delete(snapshotDocument.id);
            const data = snapshotDocument.data() as Record<string, unknown>;
            const post = cloudDocumentToLocalPost(snapshotDocument.id, data);
            if (post) nextOwnPosts.push(post);
          }

          ownCloudPosts = nextOwnPosts;
          if (!snapshot.metadata.fromCache) cloudReadyFromServer = true;
          reconcileLocalPosts();
          publishOwnCloudState();
        },
        error => {
          console.warn('Sincronização das publicações sociais indisponível.', error);
        }
      );
    });

    return () => {
      cancelled = true;
      window.removeEventListener(
        'kyrub-social-posts-updated',
        handlePostsUpdated as EventListener
      );
      window.removeEventListener(
        'kyrub-social-publish-retry',
        handleRetry as EventListener
      );
      unsubscribeAuth();
      unsubscribePosts();
      unsubscribeConnections();
    };
  }, []);

  return null;
}
