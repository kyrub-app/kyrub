import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock3 } from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../utils/firebase';

type LocalSocialPost = {
  id: string;
  authorId?: string;
  user: string;
  avatar: string;
  time: string;
  createdAt?: string;
  content: string;
  likes: number;
  mediaUrls?: string[];
  publicationType?: 'feed' | 'status';
  taggedUsers?: string[];
  taggedUserIds?: string[];
  visibility?: 'public' | 'private' | 'connections';
  audienceIds?: string[];
};

type SocialPostsUpdatedDetail = {
  uid?: string;
  posts?: LocalSocialPost[];
  source?: 'local' | 'cloud';
};

type PendingStatusShare = {
  beforeFeedIds: Set<string>;
  sendToSquare: boolean;
  timeoutId: number;
};

const STATUS_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ACTIVE_STATUSES = 9;
const LEGACY_POSTS_KEY = 'kyrub_posts';
const getUserPostsKey = (uid: string) => `kyrub_posts_${uid}`;

const findButtonByText = (
  root: ParentNode,
  label: string
): HTMLButtonElement | null =>
  Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(button =>
    button.textContent?.trim().startsWith(label)
  ) ?? null;

const readStoredPosts = (rawValue: string | null): LocalSocialPost[] => {
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? (parsed as LocalSocialPost[]) : [];
  } catch {
    return [];
  }
};

const isActiveStatus = (post: LocalSocialPost, now = Date.now()): boolean => {
  if (post.publicationType !== 'status') return false;
  const createdAt = Date.parse(post.createdAt ?? '');
  return Number.isFinite(createdAt) && now - createdAt < STATUS_TTL_MS;
};

const countActiveStatuses = (
  posts: LocalSocialPost[],
  userId: string
): number =>
  posts.filter(
    post => post.authorId === userId && isActiveStatus(post)
  ).length;

export function ProfileStatusCheckboxBridge() {
  const [userId, setUserId] = useState(auth.currentUser?.uid ?? '');
  const [checkboxHost, setCheckboxHost] = useState<HTMLElement | null>(null);
  const [shareToStatus, setShareToStatus] = useState(false);
  const [activeStatusCount, setActiveStatusCount] = useState(0);
  const [feedback, setFeedback] = useState('');

  const shareToStatusRef = useRef(false);
  const activeStatusCountRef = useRef(0);
  const pendingStatusShareRef = useRef<PendingStatusShare | null>(null);
  const boundPublishButtonsRef = useRef(
    new Map<HTMLButtonElement, EventListener>()
  );

  useEffect(() => {
    shareToStatusRef.current = shareToStatus;
  }, [shareToStatus]);

  useEffect(() => {
    activeStatusCountRef.current = activeStatusCount;
    if (activeStatusCount >= MAX_ACTIVE_STATUSES) {
      setShareToStatus(false);
    }
  }, [activeStatusCount]);

  useEffect(
    () =>
      onAuthStateChanged(auth, user => {
        const nextUserId = user?.uid ?? '';
        setUserId(nextUserId);
        setShareToStatus(false);
        setFeedback('');

        if (!nextUserId) {
          setActiveStatusCount(0);
          return;
        }

        const cachedPosts = readStoredPosts(
          localStorage.getItem(getUserPostsKey(nextUserId)) ??
            localStorage.getItem(LEGACY_POSTS_KEY)
        );
        setActiveStatusCount(
          countActiveStatuses(cachedPosts, nextUserId)
        );
      }),
    []
  );

  useEffect(() => {
    const handlePostsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<SocialPostsUpdatedDetail>).detail;
      if (
        !userId ||
        detail?.uid !== userId ||
        !Array.isArray(detail.posts)
      ) {
        return;
      }

      setActiveStatusCount(countActiveStatuses(detail.posts, userId));

      const pending = pendingStatusShareRef.current;
      if (!pending || detail.source === 'cloud') return;

      const sourcePost = detail.posts.find(
        post =>
          post.authorId === userId &&
          post.publicationType !== 'status' &&
          Boolean(post.id) &&
          !pending.beforeFeedIds.has(post.id)
      );
      if (!sourcePost) return;

      window.clearTimeout(pending.timeoutId);
      pendingStatusShareRef.current = null;

      const createdAt = new Date().toISOString();
      const statusPost: LocalSocialPost = {
        ...sourcePost,
        id: `status-${Date.now()}`,
        time: 'Agora mesmo',
        createdAt,
        publicationType: 'status',
        visibility: pending.sendToSquare ? 'public' : 'connections',
      };
      const nextPosts = [statusPost, ...detail.posts];

      localStorage.setItem(getUserPostsKey(userId), JSON.stringify(nextPosts));
      localStorage.setItem(LEGACY_POSTS_KEY, JSON.stringify(nextPosts));
      setActiveStatusCount(countActiveStatuses(nextPosts, userId));
      setShareToStatus(false);
      setFeedback('Também publicado nos seus Status por 24 horas.');

      window.dispatchEvent(
        new CustomEvent<SocialPostsUpdatedDetail>(
          'kyrub-social-posts-updated',
          {
            detail: {
              uid: userId,
              posts: nextPosts,
              source: 'local',
            },
          }
        )
      );
    };

    window.addEventListener(
      'kyrub-social-posts-updated',
      handlePostsUpdated as EventListener
    );
    return () =>
      window.removeEventListener(
        'kyrub-social-posts-updated',
        handlePostsUpdated as EventListener
      );
  }, [userId]);

  useEffect(() => {
    const bind = () => {
      for (const [button, handler] of boundPublishButtonsRef.current) {
        if (!button.isConnected) {
          button.removeEventListener('click', handler, true);
          boundPublishButtonsRef.current.delete(button);
        }
      }

      const modal = document.getElementById('profile-social-hub-modal');
      if (!modal) {
        setCheckboxHost(current => (current ? null : current));
        return;
      }

      const navigation = modal.querySelector<HTMLElement>(
        'nav[aria-label="Seções do perfil"]'
      );
      const statusButton = navigation
        ? findButtonByText(navigation, 'Status')
        : null;
      const publicationsButton = navigation
        ? findButtonByText(navigation, 'Publicações')
        : null;

      if (statusButton) {
        if (statusButton.className.includes('bg-orange-500')) {
          publicationsButton?.click();
        }
        statusButton.setAttribute('data-kyrub-status-tab-hidden', 'true');
        statusButton.setAttribute('aria-hidden', 'true');
        statusButton.tabIndex = -1;
      }

      const textarea = modal.querySelector<HTMLTextAreaElement>(
        'textarea[placeholder="O que você quer publicar na sua linha do tempo?"]'
      );
      const composer = textarea?.closest<HTMLElement>('section');
      if (!composer) {
        setCheckboxHost(current => (current ? null : current));
        return;
      }

      const squareLabel = Array.from(
        composer.querySelectorAll<HTMLLabelElement>('label')
      ).find(label => label.textContent?.includes('Enviar para a Praça'));

      let host = composer.querySelector<HTMLElement>(
        '[data-kyrub-status-checkbox-host]'
      );
      if (!host) {
        host = document.createElement('div');
        host.setAttribute('data-kyrub-status-checkbox-host', 'true');
        if (squareLabel?.nextSibling) {
          composer.insertBefore(host, squareLabel.nextSibling);
        } else if (squareLabel) {
          composer.appendChild(host);
        } else {
          composer.insertBefore(host, composer.lastElementChild);
        }
      }
      setCheckboxHost(current => (current === host ? current : host));

      const publishButton = Array.from(
        composer.querySelectorAll<HTMLButtonElement>('button')
      ).find(button => button.textContent?.trim() === 'Publicar');

      if (
        publishButton &&
        !boundPublishButtonsRef.current.has(publishButton)
      ) {
        const handler: EventListener = event => {
          const previousPending = pendingStatusShareRef.current;
          if (previousPending) {
            window.clearTimeout(previousPending.timeoutId);
            pendingStatusShareRef.current = null;
          }

          if (!shareToStatusRef.current) return;

          if (activeStatusCountRef.current >= MAX_ACTIVE_STATUSES) {
            event.preventDefault();
            event.stopPropagation();
            if ('stopImmediatePropagation' in event) {
              event.stopImmediatePropagation();
            }
            setFeedback(
              'Você já possui 9 Status ativos. Aguarde um deles completar 24 horas.'
            );
            return;
          }

          const cachedPosts = readStoredPosts(
            localStorage.getItem(getUserPostsKey(userId)) ??
              localStorage.getItem(LEGACY_POSTS_KEY)
          );
          const squareCheckbox = squareLabel?.querySelector<HTMLInputElement>(
            'input[type="checkbox"]'
          );
          const timeoutId = window.setTimeout(() => {
            pendingStatusShareRef.current = null;
          }, 2500);

          pendingStatusShareRef.current = {
            beforeFeedIds: new Set(
              cachedPosts
                .filter(
                  post =>
                    post.authorId === userId &&
                    post.publicationType !== 'status'
                )
                .map(post => post.id)
            ),
            sendToSquare: squareCheckbox?.checked === true,
            timeoutId,
          };
          setFeedback('');
        };

        publishButton.addEventListener('click', handler, true);
        boundPublishButtonsRef.current.set(publishButton, handler);
      }
    };

    bind();
    const observer = new MutationObserver(bind);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      for (const [button, handler] of boundPublishButtonsRef.current) {
        button.removeEventListener('click', handler, true);
      }
      boundPublishButtonsRef.current.clear();
      const pending = pendingStatusShareRef.current;
      if (pending) window.clearTimeout(pending.timeoutId);
      pendingStatusShareRef.current = null;
    };
  }, [userId]);

  return (
    <>
      <style>{`
        [data-kyrub-status-tab-hidden="true"] {
          display: none !important;
        }
      `}</style>

      {checkboxHost &&
        createPortal(
          <div className="space-y-2">
            <label
              className={`flex items-start gap-3 rounded-2xl border bg-slate-950 p-3 ${
                activeStatusCount >= MAX_ACTIVE_STATUSES
                  ? 'cursor-not-allowed border-slate-800 opacity-65'
                  : 'cursor-pointer border-teal-500/25'
              }`}
            >
              <input
                type="checkbox"
                checked={shareToStatus}
                disabled={activeStatusCount >= MAX_ACTIVE_STATUSES}
                onChange={event => {
                  setShareToStatus(event.target.checked);
                  setFeedback('');
                }}
                className="mt-0.5 h-4 w-4 accent-teal-500"
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-[9px] font-black uppercase text-slate-200">
                    Publicar no Status
                  </strong>
                  <span className="inline-flex items-center gap-1 rounded-full border border-teal-500/25 bg-teal-500/10 px-2 py-1 text-[8px] font-black text-teal-300">
                    <Clock3 className="h-3 w-3" />
                    {activeStatusCount}/{MAX_ACTIVE_STATUSES} ativos
                  </span>
                </span>
                <span className="mt-1 block text-[8px] leading-relaxed text-slate-500">
                  Quando selecionado, esta publicação também ficará visível nos seus Status por 24 horas.
                </span>
              </span>
            </label>

            {feedback && (
              <p
                className={`px-1 text-[9px] leading-relaxed ${
                  feedback.startsWith('Também')
                    ? 'text-teal-300'
                    : 'text-amber-300'
                }`}
                role="status"
              >
                {feedback}
              </p>
            )}
          </div>,
          checkboxHost
        )}
    </>
  );
}
