import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AtSign, Clock3, RefreshCw, X } from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  onSnapshot,
  query,
  where,
  type Timestamp,
} from 'firebase/firestore';
import { auth, db } from '../utils/firebase';
import { MediaCarousel } from './MediaCarousel';

type MarkedSocialPost = {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  content: string;
  publicationType: 'feed' | 'status';
  taggedUsers: string[];
  taggedUserIds: string[];
  mediaUrls: string[];
  createdAtIso: string;
};

type SocialPublishResultDetail = {
  uid?: string;
  sourcePostId?: string;
  status?: 'success' | 'error';
  code?: string;
  message?: string;
};

const STATUS_TTL_MS = 24 * 60 * 60 * 1000;

const readString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const readStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];

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

const formatRelativeTime = (isoValue: string): string => {
  const timestamp = Date.parse(isoValue);
  if (!Number.isFinite(timestamp)) return 'Agora mesmo';
  const elapsedMinutes = Math.max(
    0,
    Math.floor((Date.now() - timestamp) / (60 * 1000))
  );
  if (elapsedMinutes < 1) return 'Agora mesmo';
  if (elapsedMinutes < 60) return `${elapsedMinutes} min`;
  const hours = Math.floor(elapsedMinutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} d`;
};

const mapMarkedPost = (
  id: string,
  data: Record<string, unknown>,
  currentUserId: string
): MarkedSocialPost | null => {
  const taggedUserIds = readStringList(data.taggedUserIds);
  if (!taggedUserIds.includes(currentUserId)) return null;

  const authorId = readString(data.authorId);
  const authorName = readString(data.authorName);
  if (!authorId || !authorName) return null;

  return {
    id,
    authorId,
    authorName,
    authorAvatar: readString(data.authorAvatar),
    content: readString(data.content),
    publicationType: data.publicationType === 'status' ? 'status' : 'feed',
    taggedUsers: readStringList(data.taggedUsers),
    taggedUserIds,
    mediaUrls: readStringList(data.mediaUrls),
    createdAtIso:
      readString(data.createdAtIso) || timestampToIso(data.createdAt),
  };
};

const findButtonByText = (
  root: ParentNode,
  label: string
): HTMLButtonElement | null =>
  Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
    button => button.textContent?.trim().startsWith(label)
  ) ?? null;

const tagPortraitPhoto = (modal: HTMLElement) => {
  const cameraButton = modal.querySelector<HTMLButtonElement>(
    'button[aria-label="Alterar foto do perfil"]'
  );
  const mainPhoto = cameraButton?.parentElement?.querySelector<HTMLElement>(
    'img, [role="img"]'
  );
  mainPhoto?.setAttribute('data-kyrub-profile-portrait', 'true');

  const galleryButton = findButtonByText(modal, 'Galeria');
  const editPhoto = galleryButton?.parentElement?.parentElement?.querySelector<HTMLElement>(
    'img, [role="img"]'
  );
  editPhoto?.setAttribute('data-kyrub-profile-portrait', 'true');
};

export function ProfileSocialPolishBridge() {
  const [currentUserId, setCurrentUserId] = useState(auth.currentUser?.uid ?? '');
  const [markedPosts, setMarkedPosts] = useState<MarkedSocialPost[]>([]);
  const [markedLoadError, setMarkedLoadError] = useState('');
  const [markedActive, setMarkedActive] = useState(false);
  const [tabHost, setTabHost] = useState<HTMLElement | null>(null);
  const [contentHost, setContentHost] = useState<HTMLElement | null>(null);
  const [now, setNow] = useState(Date.now());
  const [publishError, setPublishError] = useState<SocialPublishResultDetail | null>(
    null
  );
  const originalContentRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let unsubscribeMarked = () => undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeMarked();
      unsubscribeMarked = () => undefined;
      setCurrentUserId(user?.uid ?? '');
      setMarkedPosts([]);
      setMarkedLoadError('');

      if (!user) return;

      unsubscribeMarked = onSnapshot(
        query(
          collection(db, 'social_posts'),
          where('audienceIds', 'array-contains', user.uid)
        ),
        snapshot => {
          const posts = snapshot.docs
            .flatMap(item => {
              const post = mapMarkedPost(
                item.id,
                item.data() as Record<string, unknown>,
                user.uid
              );
              return post ? [post] : [];
            })
            .sort(
              (left, right) =>
                Date.parse(right.createdAtIso) - Date.parse(left.createdAtIso)
            );
          setMarkedPosts(posts);
          setMarkedLoadError('');
        },
        error => {
          console.warn('Não foi possível carregar publicações marcadas.', error);
          setMarkedLoadError(
            'Não foi possível carregar os conteúdos em que marcaram você.'
          );
        }
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribeMarked();
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleResult = (event: Event) => {
      const detail = (event as CustomEvent<SocialPublishResultDetail>).detail;
      if (!detail || detail.uid !== auth.currentUser?.uid) return;
      if (detail.status === 'error') {
        setPublishError(detail);
        return;
      }
      if (
        detail.status === 'success' &&
        detail.sourcePostId === publishError?.sourcePostId
      ) {
        setPublishError(null);
      }
    };

    window.addEventListener(
      'kyrub-social-publish-result',
      handleResult as EventListener
    );
    return () =>
      window.removeEventListener(
        'kyrub-social-publish-result',
        handleResult as EventListener
      );
  }, [publishError?.sourcePostId]);

  useEffect(() => {
    const handleNavigationClick = (event: Event) => {
      const target = event.target as Element | null;
      const button = target?.closest('button');
      const navigation = button?.closest('nav[aria-label="Seções do perfil"]');
      if (navigation && !button?.hasAttribute('data-kyrub-marked-tab')) {
        setMarkedActive(false);
      }
    };

    document.addEventListener('click', handleNavigationClick, true);
    return () => document.removeEventListener('click', handleNavigationClick, true);
  }, []);

  useEffect(() => {
    const bind = () => {
      const modal = document.getElementById('profile-social-hub-modal');
      if (!modal) {
        originalContentRef.current = null;
        setTabHost(current => (current ? null : current));
        setContentHost(current => (current ? null : current));
        setMarkedActive(false);
        return;
      }

      tagPortraitPhoto(modal);
      const navigation = modal.querySelector<HTMLElement>(
        'nav[aria-label="Seções do perfil"]'
      );
      if (!navigation || !navigation.parentElement) return;

      let nextTabHost = navigation.querySelector<HTMLElement>(
        '[data-kyrub-marked-tab-host]'
      );
      if (!nextTabHost) {
        nextTabHost = document.createElement('span');
        nextTabHost.setAttribute('data-kyrub-marked-tab-host', 'true');
        nextTabHost.style.display = 'contents';
        const statusButton = findButtonByText(navigation, 'Status');
        if (statusButton?.nextSibling) {
          navigation.insertBefore(nextTabHost, statusButton.nextSibling);
        } else {
          navigation.appendChild(nextTabHost);
        }
      }

      let nextContentHost = navigation.parentElement.querySelector<HTMLElement>(
        ':scope > [data-kyrub-marked-content-host]'
      );
      let originalContent = navigation.nextElementSibling as HTMLElement | null;
      if (originalContent?.hasAttribute('data-kyrub-marked-content-host')) {
        originalContent = originalContent.nextElementSibling as HTMLElement | null;
      }
      if (!nextContentHost) {
        nextContentHost = document.createElement('div');
        nextContentHost.setAttribute('data-kyrub-marked-content-host', 'true');
        nextContentHost.className = 'space-y-4 p-4 sm:p-5';
        nextContentHost.style.display = 'none';
        navigation.parentElement.insertBefore(nextContentHost, originalContent);
      }

      originalContentRef.current = originalContent;
      setTabHost(current => (current === nextTabHost ? current : nextTabHost));
      setContentHost(current =>
        current === nextContentHost ? current : nextContentHost
      );
    };

    bind();
    const observer = new MutationObserver(bind);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const originalContent = originalContentRef.current;
    if (originalContent) originalContent.style.display = markedActive ? 'none' : '';
    if (contentHost) contentHost.style.display = markedActive ? 'block' : 'none';
    return () => {
      if (originalContent) originalContent.style.display = '';
    };
  }, [contentHost, markedActive]);

  const visibleMarkedPosts = useMemo(
    () =>
      markedPosts.filter(post => {
        if (post.publicationType !== 'status') return true;
        const createdAt = Date.parse(post.createdAtIso);
        return Number.isFinite(createdAt) && now - createdAt < STATUS_TTL_MS;
      }),
    [markedPosts, now]
  );

  const retryPendingPublication = () => {
    window.dispatchEvent(
      new CustomEvent('kyrub-social-publish-retry', {
        detail: {
          uid: currentUserId,
          sourcePostId: publishError?.sourcePostId,
        },
      })
    );
  };

  return (
    <>
      <style>{`
        [data-kyrub-profile-portrait="true"] {
          width: 72px !important;
          height: 96px !important;
          min-width: 72px !important;
          border-radius: 16px !important;
          object-fit: cover !important;
        }
        @media (min-width: 640px) {
          [data-kyrub-profile-portrait="true"] {
            width: 84px !important;
            height: 112px !important;
            min-width: 84px !important;
          }
        }
      `}</style>

      {tabHost &&
        createPortal(
          <button
            type="button"
            data-kyrub-marked-tab
            onClick={() => setMarkedActive(true)}
            className={`shrink-0 rounded-xl px-3 py-2 text-[9px] font-black uppercase ${
              markedActive
                ? 'bg-orange-500 text-slate-950'
                : 'border border-slate-800 bg-slate-900 text-slate-400'
            }`}
            aria-pressed={markedActive}
          >
            Marcados {visibleMarkedPosts.length}
          </button>,
          tabHost
        )}

      {contentHost &&
        createPortal(
          <div className="space-y-4">
            <div className="rounded-2xl border border-teal-500/20 bg-teal-500/5 p-3">
              <div className="flex items-center gap-2 text-[9px] font-black uppercase text-teal-300">
                <AtSign className="h-4 w-4" />
                Marcaram você
              </div>
              <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
                Publicações e Status em que usuários conectados incluíram seu perfil.
              </p>
            </div>

            {markedLoadError && (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-[10px] text-red-200">
                {markedLoadError}
              </div>
            )}

            {visibleMarkedPosts.map(post => (
              <article
                key={post.id}
                className="space-y-3 rounded-3xl border border-slate-800 bg-slate-900 p-4 shadow-lg"
              >
                <header className="flex items-center gap-3">
                  {post.authorAvatar ? (
                    <img
                      src={post.authorAvatar}
                      alt={post.authorName}
                      className="h-10 w-10 rounded-full border border-slate-800 object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-800 bg-slate-950 text-slate-500">
                      <AtSign className="h-4 w-4" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <h4 className="truncate text-xs font-black text-white">
                      {post.authorName}
                    </h4>
                    <span className="font-mono text-[9px] text-slate-500">
                      {formatRelativeTime(post.createdAtIso)}
                    </span>
                  </div>
                  {post.publicationType === 'status' && (
                    <span className="flex items-center gap-1 rounded-full border border-teal-500/25 bg-teal-500/10 px-2 py-1 text-[8px] font-black uppercase text-teal-300">
                      <Clock3 className="h-3 w-3" /> Status
                    </span>
                  )}
                </header>

                {post.content && (
                  <p className="whitespace-pre-line text-xs leading-relaxed text-slate-300">
                    {post.content}
                  </p>
                )}

                {post.taggedUsers.length > 0 && (
                  <p className="text-[9px] font-mono text-teal-400">
                    com {post.taggedUsers.map(name => `@${name}`).join(', ')}
                  </p>
                )}

                {post.mediaUrls.length > 0 && (
                  <MediaCarousel mediaUrls={post.mediaUrls} />
                )}
              </article>
            ))}

            {!markedLoadError && visibleMarkedPosts.length === 0 && (
              <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/45 px-5 py-12 text-center">
                <AtSign className="mx-auto h-8 w-8 text-slate-700" />
                <h4 className="mt-3 text-xs font-black uppercase text-slate-300">
                  Nenhuma marcação
                </h4>
                <p className="mx-auto mt-2 max-w-sm text-[10px] leading-relaxed text-slate-500">
                  Quando alguém conectado marcar você, o conteúdo aparecerá aqui.
                </p>
              </div>
            )}
          </div>,
          contentHost
        )}

      {publishError && (
        <div className="fixed bottom-5 left-1/2 z-[190] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl border border-red-500/30 bg-red-950 p-4 text-red-100 shadow-2xl">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <strong className="block text-[10px] font-black uppercase">
                Publicação pendente
              </strong>
              <p className="mt-1 text-[10px] leading-relaxed text-red-200/80">
                {publishError.message ||
                  'Não foi possível sincronizar a publicação com o Firebase.'}
              </p>
              <button
                type="button"
                onClick={retryPendingPublication}
                className="mt-3 flex items-center gap-2 rounded-xl bg-red-200 px-3 py-2 text-[9px] font-black uppercase text-red-950"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Tentar sincronizar
              </button>
            </div>
            <button
              type="button"
              onClick={() => setPublishError(null)}
              className="text-red-300/70"
              aria-label="Fechar aviso de publicação"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
