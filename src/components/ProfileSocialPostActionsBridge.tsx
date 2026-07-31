import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  where,
  type Timestamp,
} from 'firebase/firestore';
import { auth, db } from '../utils/firebase';

const LEGACY_POSTS_KEY = 'kyrub_posts';
const getUserPostsKey = (uid: string) => `kyrub_posts_${uid}`;

const HEART_ICON = `
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"></path>
  </svg>
`;

const TRASH_ICON = `
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 6h18"></path>
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
    <path d="M19 6l-1 14c0 1-1 2-2 2H8c-1 0-2-1-2-2L5 6"></path>
    <path d="M10 11v6"></path>
    <path d="M14 11v6"></path>
  </svg>
`;

type OwnedSocialPost = {
  id: string;
  sourcePostId: string;
  authorName: string;
  content: string;
  publicationType: 'feed' | 'status';
  createdAtIso: string;
};

type LocalPost = {
  id?: string;
  [key: string]: unknown;
};

type ToastState = {
  message: string;
  type: 'success' | 'error';
};

const readString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const timestampToIso = (value: unknown): string => {
  if (value && typeof value === 'object' && 'toDate' in value) {
    try {
      return (value as Timestamp).toDate().toISOString();
    } catch {
      return '';
    }
  }
  return '';
};

const normalizeText = (value: string): string =>
  value
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');

const formatRelativeTime = (isoValue: string): string => {
  const timestamp = Date.parse(isoValue);
  if (!Number.isFinite(timestamp)) return 'Agora mesmo';

  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - timestamp) / 1000)
  );
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

const readLocalPosts = (rawValue: string | null): LocalPost[] => {
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? (parsed as LocalPost[]) : [];
  } catch {
    return [];
  }
};

const restoreStorageValue = (key: string, rawValue: string | null) => {
  if (rawValue === null) localStorage.removeItem(key);
  else localStorage.setItem(key, rawValue);
};

const getCardContent = (article: HTMLElement): string => {
  const directParagraph = Array.from(article.children).find(child => {
    if (child.tagName !== 'P') return false;
    return !normalizeText(child.textContent ?? '').startsWith('com @');
  });
  return directParagraph?.textContent ?? '';
};

const getCardTime = (article: HTMLElement): string => {
  const title = article.querySelector('header h4');
  return title?.parentElement?.querySelector('span')?.textContent ?? '';
};

const postMatchesCard = (
  post: OwnedSocialPost,
  article: HTMLElement,
  requireTime: boolean
): boolean => {
  const renderedName = article.querySelector('header h4')?.textContent ?? '';
  if (normalizeText(renderedName) !== normalizeText(post.authorName)) return false;
  if (normalizeText(getCardContent(article)) !== normalizeText(post.content)) {
    return false;
  }
  if (!requireTime) return true;
  return normalizeText(getCardTime(article)) === normalizeText(
    formatRelativeTime(post.createdAtIso)
  );
};

export function ProfileSocialPostActionsBridge() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const currentUserRef = useRef<User | null>(auth.currentUser);
  const ownedPostsRef = useRef<OwnedSocialPost[]>([]);
  const decorateRef = useRef<() => void>(() => undefined);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = (message: string, type: ToastState['type']) => {
    setToast({ message, type });
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToast(null), 4000);
  };

  const removeOwnedPost = async (post: OwnedSocialPost) => {
    const user = currentUserRef.current;
    if (!user) return;

    const userKey = getUserPostsKey(user.uid);
    const previousUserRaw = localStorage.getItem(userKey);
    const previousLegacyRaw = localStorage.getItem(LEGACY_POSTS_KEY);
    const sourcePostId = post.sourcePostId ||
      (post.id.startsWith(`${user.uid}__`)
        ? post.id.slice(user.uid.length + 2)
        : post.id);

    const shouldRemove = (item: LocalPost) => {
      const localId = readString(item.id);
      if (!localId) return false;
      const calculatedCloudId = `${user.uid}__${localId.replaceAll('/', '_')}`.slice(
        0,
        500
      );
      return (
        localId === sourcePostId ||
        localId === post.id ||
        calculatedCloudId === post.id
      );
    };

    const nextUserPosts = readLocalPosts(
      previousUserRaw ?? previousLegacyRaw
    ).filter(item => !shouldRemove(item));
    const nextLegacyPosts = readLocalPosts(
      previousLegacyRaw ?? previousUserRaw
    ).filter(item => !shouldRemove(item));

    try {
      localStorage.setItem(userKey, JSON.stringify(nextUserPosts));
      localStorage.setItem(LEGACY_POSTS_KEY, JSON.stringify(nextLegacyPosts));
      window.dispatchEvent(
        new CustomEvent('kyrub-social-posts-updated', {
          detail: {
            uid: user.uid,
            posts: nextUserPosts,
            source: 'local',
          },
        })
      );

      await deleteDoc(doc(db, 'social_posts', post.id));

      const likeId = `${post.id}__${user.uid}`;
      const favoriteId = `social_${post.id.replaceAll('/', '_')}`.slice(0, 500);
      await Promise.allSettled([
        deleteDoc(doc(db, 'social_post_likes', likeId)),
        deleteDoc(doc(db, `users/${user.uid}/favorites/${favoriteId}`)),
      ]);

      showToast(
        post.publicationType === 'status'
          ? 'Status excluído.'
          : 'Publicação excluída.',
        'success'
      );
    } catch (error) {
      restoreStorageValue(userKey, previousUserRaw);
      restoreStorageValue(LEGACY_POSTS_KEY, previousLegacyRaw);
      window.dispatchEvent(
        new CustomEvent('kyrub-social-posts-updated', {
          detail: {
            uid: user.uid,
            posts: readLocalPosts(previousUserRaw ?? previousLegacyRaw),
            source: 'local',
          },
        })
      );
      console.warn('Não foi possível excluir a publicação.', error);
      showToast('Não foi possível excluir a publicação agora.', 'error');
      throw error;
    }
  };

  useEffect(() => {
    let unsubscribePosts = () => undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribePosts();
      unsubscribePosts = () => undefined;
      currentUserRef.current = user;
      ownedPostsRef.current = [];
      decorateRef.current();

      if (!user) return;

      unsubscribePosts = onSnapshot(
        query(
          collection(db, 'social_posts'),
          where('authorId', '==', user.uid)
        ),
        snapshot => {
          ownedPostsRef.current = snapshot.docs
            .map(snapshotDocument => {
              const data = snapshotDocument.data() as Record<string, unknown>;
              return {
                id: snapshotDocument.id,
                sourcePostId: readString(data.sourcePostId),
                authorName: readString(data.authorName),
                content: readString(data.content),
                publicationType:
                  data.publicationType === 'status' ? 'status' : 'feed',
                createdAtIso:
                  readString(data.createdAtIso) || timestampToIso(data.createdAt),
              } as OwnedSocialPost;
            })
            .sort(
              (left, right) =>
                Date.parse(right.createdAtIso) - Date.parse(left.createdAtIso)
            );
          decorateRef.current();
        },
        error => {
          console.warn(
            'Não foi possível preparar a exclusão das publicações próprias.',
            error
          );
        }
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribePosts();
    };
  }, []);

  useEffect(() => {
    const updateLikeProxy = (
      proxy: HTMLButtonElement,
      originalLikeButton: HTMLButtonElement
    ) => {
      const rawLabel = originalLikeButton.textContent ?? '';
      const count = Number(rawLabel.match(/\d+/)?.[0] ?? '0');
      const liked =
        originalLikeButton.className.includes('border-rose-500') ||
        Boolean(originalLikeButton.querySelector('.fill-current'));

      proxy.className = `flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
        liked
          ? 'bg-rose-500/15 text-rose-300'
          : 'text-slate-500 hover:bg-slate-800 hover:text-rose-300'
      }`;
      proxy.innerHTML = HEART_ICON;
      const icon = proxy.querySelector('svg');
      if (icon) icon.setAttribute('fill', liked ? 'currentColor' : 'none');
      const description = `${liked ? 'Remover curtida' : 'Curtir publicação'} · ${count} ${
        count === 1 ? 'curtida' : 'curtidas'
      }`;
      proxy.setAttribute('aria-label', description);
      proxy.setAttribute('title', description);
    };

    const decorateLike = (
      article: HTMLElement,
      menuButton: HTMLButtonElement
    ) => {
      const originalLikeButton = Array.from(
        article.querySelectorAll<HTMLButtonElement>(':scope > button')
      ).find(button => /curtidas?/i.test(button.textContent ?? ''));
      if (!originalLikeButton) return;

      originalLikeButton.dataset.kyrubOriginalLike = 'true';
      const actionGroup = menuButton.parentElement;
      if (!actionGroup) return;

      let proxy = actionGroup.querySelector<HTMLButtonElement>(
        'button[data-kyrub-like-proxy]'
      );
      if (!proxy) {
        proxy = document.createElement('button');
        proxy.type = 'button';
        proxy.dataset.kyrubLikeProxy = 'true';
        proxy.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          originalLikeButton.click();
          window.setTimeout(() => decorateRef.current(), 0);
          window.setTimeout(() => decorateRef.current(), 300);
        });
      }

      const saveButton = actionGroup.querySelector<HTMLButtonElement>(
        'button[aria-label="Salvar publicação"], button[aria-label="Remover dos salvos"]'
      );
      const anchor = saveButton ?? menuButton;
      if (proxy.parentElement !== actionGroup || proxy.nextElementSibling !== anchor) {
        actionGroup.insertBefore(proxy, anchor);
      }
      updateLikeProxy(proxy, originalLikeButton);
    };

    const decorateDelete = (
      article: HTMLElement,
      menuButton: HTMLButtonElement
    ) => {
      const menu = menuButton
        .closest('header')
        ?.querySelector<HTMLElement>('.absolute.right-0.top-10');
      if (!menu) return;
      const ownPostNotice = Array.from(menu.children).find(child =>
        normalizeText(child.textContent ?? '').includes('esta publicação é sua')
      ) as HTMLElement | undefined;
      if (!ownPostNotice) return;

      const post =
        ownedPostsRef.current.find(item =>
          postMatchesCard(item, article, true)
        ) ??
        ownedPostsRef.current.find(item =>
          postMatchesCard(item, article, false)
        );
      if (!post) return;

      ownPostNotice.style.display = 'none';
      let deleteButton = menu.querySelector<HTMLButtonElement>(
        'button[data-kyrub-delete-post]'
      );
      if (deleteButton) return;

      deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.dataset.kyrubDeletePost = 'true';
      deleteButton.className =
        'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-black uppercase text-red-300 hover:bg-red-500/10';
      deleteButton.innerHTML = `${TRASH_ICON}<span>${
        post.publicationType === 'status'
          ? 'Excluir status'
          : 'Excluir publicação'
      }</span>`;
      deleteButton.setAttribute(
        'aria-label',
        post.publicationType === 'status'
          ? 'Excluir status'
          : 'Excluir publicação'
      );

      deleteButton.addEventListener('click', async event => {
        event.preventDefault();
        event.stopPropagation();

        if (deleteButton?.dataset.confirmDelete !== 'true') {
          if (!deleteButton) return;
          deleteButton.dataset.confirmDelete = 'true';
          deleteButton.classList.add('bg-red-500/15');
          const label = deleteButton.querySelector('span');
          if (label) label.textContent = 'Toque novamente para excluir';
          window.setTimeout(() => {
            if (!deleteButton?.isConnected) return;
            delete deleteButton.dataset.confirmDelete;
            deleteButton.classList.remove('bg-red-500/15');
            const currentLabel = deleteButton.querySelector('span');
            if (currentLabel) {
              currentLabel.textContent =
                post.publicationType === 'status'
                  ? 'Excluir status'
                  : 'Excluir publicação';
            }
          }, 4500);
          return;
        }

        deleteButton.disabled = true;
        deleteButton.classList.add('opacity-60');
        const label = deleteButton.querySelector('span');
        if (label) label.textContent = 'Excluindo...';
        try {
          await removeOwnedPost(post);
        } catch {
          if (!deleteButton.isConnected) return;
          deleteButton.disabled = false;
          deleteButton.classList.remove('opacity-60');
          delete deleteButton.dataset.confirmDelete;
          if (label) {
            label.textContent =
              post.publicationType === 'status'
                ? 'Excluir status'
                : 'Excluir publicação';
          }
        }
      });

      menu.appendChild(deleteButton);
    };

    const decorate = () => {
      document
        .querySelectorAll<HTMLButtonElement>(
          'button[aria-label="Mais opções da publicação"]'
        )
        .forEach(menuButton => {
          const article = menuButton.closest<HTMLElement>('article');
          if (!article) return;
          article.dataset.kyrubSocialCard = 'true';
          decorateLike(article, menuButton);
          decorateDelete(article, menuButton);
        });
    };

    decorateRef.current = decorate;
    decorate();
    const observer = new MutationObserver(decorate);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const timer = window.setInterval(decorate, 60_000);

    return () => {
      observer.disconnect();
      window.clearInterval(timer);
      decorateRef.current = () => undefined;
      document
        .querySelectorAll<HTMLElement>('[data-kyrub-original-like="true"]')
        .forEach(element => {
          element.style.display = '';
          delete element.dataset.kyrubOriginalLike;
        });
      document
        .querySelectorAll<HTMLElement>(
          '[data-kyrub-like-proxy], [data-kyrub-delete-post]'
        )
        .forEach(element => element.remove());
    };
  }, []);

  useEffect(
    () => () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    },
    []
  );

  return (
    <>
      <style>{`
        [data-kyrub-original-like="true"] {
          display: none !important;
        }
        [data-kyrub-like-proxy="true"] svg,
        [data-kyrub-delete-post="true"] svg {
          flex-shrink: 0;
        }
        [data-kyrub-delete-post="true"] {
          font-size: 0.8125rem !important;
          line-height: 1.125rem !important;
        }
      `}</style>

      {toast && (
        <div
          className={`fixed left-1/2 top-[max(16px,env(safe-area-inset-top))] z-[220] w-[calc(100%-32px)] max-w-sm -translate-x-1/2 rounded-2xl border px-4 py-3 text-sm font-bold shadow-2xl ${
            toast.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-950 text-emerald-100'
              : 'border-red-500/30 bg-red-950 text-red-100'
          }`}
          role="status"
        >
          {toast.message}
        </div>
      )}
    </>
  );
}
