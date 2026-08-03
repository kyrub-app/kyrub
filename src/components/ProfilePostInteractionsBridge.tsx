import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  BarChart3,
  Bookmark,
  Eye,
  Heart,
  LoaderCircle,
  MessageCircle,
  Rocket,
  Send,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import type { SocialPost } from '../types';
import {
  usePublicSocialFeed,
  type SocialPostComment,
} from '../hooks/usePublicSocialFeed';
import { auth, db } from '../utils/firebase';

type PostTarget = {
  key: string;
  card: HTMLElement;
  target: HTMLElement;
  menuTarget: HTMLElement | null;
  nativeLikeButton: HTMLButtonElement | null;
  post: SocialPost;
};

type EngagementType = 'view' | 'save' | 'share';

type SocialPostEngagement = {
  id: string;
  postId: string;
  postAuthorId: string;
  actorId: string;
  type: EngagementType;
};

const LEGACY_POSTS_KEY = 'kyrub_posts';
const getUserPostsKey = (uid: string) => `kyrub_posts_${uid}`;

const readString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const readStoredPosts = (rawValue: string | null): SocialPost[] => {
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? (parsed as SocialPost[]) : [];
  } catch {
    return [];
  }
};

const sameTargets = (current: PostTarget[], next: PostTarget[]): boolean =>
  current.length === next.length &&
  current.every(
    (item, index) =>
      item.card === next[index]?.card &&
      item.target === next[index]?.target &&
      item.menuTarget === next[index]?.menuTarget &&
      item.post.id === next[index]?.post.id
  );

const postFromCard = (
  card: HTMLElement,
  posts: SocialPost[],
  usedPostIds: Set<string>
): SocialPost | null => {
  const knownPostId = card.dataset.profilePostId;
  if (knownPostId) {
    const knownPost = posts.find(post => post.id === knownPostId);
    if (knownPost && !usedPostIds.has(knownPost.id)) return knownPost;
  }

  const author = card.querySelector<HTMLElement>('h4')?.textContent?.trim() ?? '';
  const content =
    [...card.querySelectorAll<HTMLElement>('p')].find(item =>
      item.className.includes('whitespace-pre-line')
    )?.textContent?.trim() ?? '';
  const time =
    card.querySelector<HTMLElement>('span.font-mono')?.textContent?.trim() ?? '';

  const candidates = posts.filter(
    post =>
      !usedPostIds.has(post.id) &&
      post.user.trim() === author &&
      post.content.trim() === content
  );

  return candidates.find(post => post.time.trim() === time) ?? candidates[0] ?? null;
};

const engagementDocumentId = (
  postId: string,
  type: Exclude<EngagementType, 'share'>,
  actorId: string
): string =>
  `${postId.replaceAll('/', '_')}__${type}__${actorId}`.slice(0, 1000);

export function ProfilePostInteractionsBridge() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [targets, setTargets] = useState<PostTarget[]>([]);
  const [engagements, setEngagements] = useState<SocialPostEngagement[]>([]);
  const [commentsPost, setCommentsPost] = useState<SocialPost | null>(null);
  const [metricsPost, setMetricsPost] = useState<SocialPost | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<SocialPost | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const socialFeed = usePublicSocialFeed();

  useEffect(
    () =>
      onAuthStateChanged(auth, nextUser => {
        setUser(nextUser);
        if (!nextUser) {
          setTargets([]);
          setEngagements([]);
          setCommentsPost(null);
          setMetricsPost(null);
          setDeleteCandidate(null);
        }
      }),
    []
  );

  useEffect(() => {
    if (!user) {
      setEngagements([]);
      return;
    }

    return onSnapshot(
      query(
        collection(db, 'social_post_engagements'),
        where('postAuthorId', '==', user.uid)
      ),
      snapshot => {
        setEngagements(
          snapshot.docs.flatMap(item => {
            const data = item.data() as Record<string, unknown>;
            const type = data.type;
            const postId = readString(data.postId);
            const postAuthorId = readString(data.postAuthorId);
            const actorId = readString(data.actorId);
            return postId &&
              postAuthorId &&
              actorId &&
              (type === 'view' || type === 'save' || type === 'share')
              ? [
                  {
                    id: item.id,
                    postId,
                    postAuthorId,
                    actorId,
                    type,
                  } satisfies SocialPostEngagement,
                ]
              : [];
          })
        );
      },
      () => setEngagements([])
    );
  }, [user]);

  useEffect(() => {
    const synchronizeTargets = () => {
      const profileModal = document.getElementById('profile-social-hub-modal');
      if (!profileModal) {
        setTargets(current => (current.length === 0 ? current : []));
        return;
      }

      const usedPostIds = new Set<string>();
      const nextTargets: PostTarget[] = [];
      const menuButtons = profileModal.querySelectorAll<HTMLButtonElement>(
        'button[aria-label="Mais opções da publicação"]'
      );

      menuButtons.forEach(menuButton => {
        const card = menuButton.closest<HTMLElement>('article');
        if (!card) return;
        const post = postFromCard(card, socialFeed.posts, usedPostIds);
        if (!post) return;
        usedPostIds.add(post.id);
        card.dataset.profilePostId = post.id;

        const nativeLikeButton =
          [...card.querySelectorAll<HTMLButtonElement>('button')].find(button =>
            /\bcurtida(?:s)?\b/i.test(button.textContent ?? '')
          ) ?? null;

        if (nativeLikeButton) {
          if (!nativeLikeButton.dataset.profileNativeLikeDisplay) {
            nativeLikeButton.dataset.profileNativeLikeDisplay =
              nativeLikeButton.style.display || '__empty__';
          }
          nativeLikeButton.style.display = 'none';
        }

        let target = card.querySelector<HTMLElement>(
          '[data-profile-post-interactions-slot="true"]'
        );
        if (!target) {
          target = document.createElement('div');
          target.dataset.profilePostInteractionsSlot = 'true';
          if (nativeLikeButton) {
            nativeLikeButton.insertAdjacentElement('afterend', target);
          } else {
            card.appendChild(target);
          }
        }

        const menu = menuButton
          .closest('header')
          ?.querySelector<HTMLElement>('div.absolute.right-0.top-10');
        let menuTarget: HTMLElement | null = null;
        if (menu && post.authorId === user?.uid) {
          const ownerNote = [...menu.children].find(
            item => item.textContent?.trim() === 'Esta publicação é sua.'
          ) as HTMLElement | undefined;
          if (ownerNote) {
            if (!ownerNote.dataset.profileOwnerNoteDisplay) {
              ownerNote.dataset.profileOwnerNoteDisplay =
                ownerNote.style.display || '__empty__';
            }
            ownerNote.style.display = 'none';
          }

          menuTarget = menu.querySelector<HTMLElement>(
            '[data-profile-post-menu-slot="true"]'
          );
          if (!menuTarget) {
            menuTarget = document.createElement('div');
            menuTarget.dataset.profilePostMenuSlot = 'true';
            menu.appendChild(menuTarget);
          }
        }

        nextTargets.push({
          key: post.id,
          card,
          target,
          menuTarget,
          nativeLikeButton,
          post,
        });
      });

      setTargets(current =>
        sameTargets(current, nextTargets) ? current : nextTargets
      );
    };

    synchronizeTargets();
    const timer = window.setInterval(synchronizeTargets, 300);
    return () => {
      window.clearInterval(timer);
      document
        .querySelectorAll<HTMLElement>(
          '[data-profile-post-interactions-slot="true"], [data-profile-post-menu-slot="true"]'
        )
        .forEach(target => target.remove());
      document
        .querySelectorAll<HTMLButtonElement>(
          'button[data-profile-native-like-display]'
        )
        .forEach(button => {
          const previous = button.dataset.profileNativeLikeDisplay;
          button.style.display = previous === '__empty__' ? '' : previous || '';
          delete button.dataset.profileNativeLikeDisplay;
        });
      document
        .querySelectorAll<HTMLElement>('[data-profile-owner-note-display]')
        .forEach(note => {
          const previous = note.dataset.profileOwnerNoteDisplay;
          note.style.display = previous === '__empty__' ? '' : previous || '';
          delete note.dataset.profileOwnerNoteDisplay;
        });
      document
        .querySelectorAll<HTMLElement>('[data-profile-post-id]')
        .forEach(card => delete card.dataset.profilePostId);
    };
  }, [socialFeed.posts, user?.uid]);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3200);
  };

  const recordEngagement = async (
    post: SocialPost,
    type: EngagementType,
    unique: boolean
  ) => {
    if (!user || !post.authorId) return;
    try {
      const reference =
        unique && type !== 'share'
          ? doc(
              db,
              'social_post_engagements',
              engagementDocumentId(post.id, type, user.uid)
            )
          : doc(collection(db, 'social_post_engagements'));

      if (unique) {
        const existing = await getDoc(reference);
        if (existing.exists()) return;
      }

      await setDoc(reference, {
        engagementId: reference.id,
        postId: post.id,
        postAuthorId: post.authorId,
        actorId: user.uid,
        type,
        createdAt: serverTimestamp(),
      });
    } catch {
      // Metrics start recording after the matching Firestore rules are published.
    }
  };

  const removeSavedEngagement = async (post: SocialPost) => {
    if (!user) return;
    try {
      await deleteDoc(
        doc(
          db,
          'social_post_engagements',
          engagementDocumentId(post.id, 'save', user.uid)
        )
      );
    } catch {
      // Keep the save action usable even before analytics rules are published.
    }
  };

  useEffect(() => {
    if (!user || targets.length === 0) return;
    if (!('IntersectionObserver' in window)) {
      targets.forEach(item => void recordEngagement(item.post, 'view', true));
      return;
    }

    const postByCard = new Map(targets.map(item => [item.card, item.post]));
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.55) continue;
          const post = postByCard.get(entry.target as HTMLElement);
          if (!post) continue;
          observer.unobserve(entry.target);
          void recordEngagement(post, 'view', true);
        }
      },
      { threshold: [0.55] }
    );

    targets.forEach(item => observer.observe(item.card));
    return () => observer.disconnect();
  }, [targets, user]);

  useEffect(() => {
    const handleSaveClick = (event: Event) => {
      const target = event.target as Element | null;
      const button = target?.closest<HTMLButtonElement>(
        'button[aria-label="Salvar publicação"], button[aria-label="Remover dos salvos"]'
      );
      if (!button || !button.closest('#profile-social-hub-modal')) return;
      const card = button.closest<HTMLElement>('article');
      const postId = card?.dataset.profilePostId;
      const post = socialFeed.posts.find(item => item.id === postId);
      if (!post) return;

      window.setTimeout(() => {
        const savedNow = button.getAttribute('aria-label') === 'Remover dos salvos';
        if (savedNow) void recordEngagement(post, 'save', true);
        else void removeSavedEngagement(post);
      }, 650);
    };

    document.addEventListener('click', handleSaveClick, true);
    return () => document.removeEventListener('click', handleSaveClick, true);
  }, [socialFeed.posts, user]);

  const commentsForSelectedPost: SocialPostComment[] = commentsPost
    ? socialFeed.commentsByPost.get(commentsPost.id) ?? []
    : [];

  const selectedMetrics = useMemo(() => {
    if (!metricsPost) {
      return {
        views: 0,
        likes: 0,
        saves: 0,
        shares: 0,
        comments: 0,
      };
    }
    const postEngagements = engagements.filter(
      item => item.postId === metricsPost.id
    );
    return {
      views: postEngagements.filter(item => item.type === 'view').length,
      likes: metricsPost.likes,
      saves: postEngagements.filter(item => item.type === 'save').length,
      shares: postEngagements.filter(item => item.type === 'share').length,
      comments: socialFeed.commentsByPost.get(metricsPost.id)?.length ?? 0,
    };
  }, [engagements, metricsPost, socialFeed.commentsByPost]);

  const openComments = (post: SocialPost) => {
    setCommentsPost(post);
    setCommentDraft('');
  };

  const submitComment = async (event: FormEvent) => {
    event.preventDefault();
    if (!commentsPost || !commentDraft.trim()) return;
    setCommentBusy(true);
    try {
      await socialFeed.addComment(commentsPost.id, commentDraft);
      setCommentDraft('');
    } catch {
      showNotice('Não foi possível enviar o comentário.');
    } finally {
      setCommentBusy(false);
    }
  };

  const deleteComment = async (commentId: string) => {
    try {
      await socialFeed.deleteComment(commentId);
    } catch {
      showNotice('Não foi possível excluir o comentário.');
    }
  };

  const sharePost = async (post: SocialPost) => {
    const url = `${window.location.origin}${window.location.pathname}#publicacao=${encodeURIComponent(post.id)}`;
    const text = post.content.trim()
      ? `${post.user}: ${post.content.trim().slice(0, 220)}`
      : `Veja esta publicação de ${post.user} no Kyrub.`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: `Publicação de ${post.user}`,
          text,
          url,
        });
      } else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        showNotice('Link da publicação copiado.');
      }
      await recordEngagement(post, 'share', false);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      showNotice('Não foi possível compartilhar a publicação.');
    }
  };

  const removeLocalPost = (post: SocialPost) => {
    if (!user) return;
    const cloudPrefix = `${user.uid}__`;
    const sourcePostId = post.id.startsWith(cloudPrefix)
      ? post.id.slice(cloudPrefix.length)
      : post.id;
    const key = getUserPostsKey(user.uid);
    const current = readStoredPosts(
      localStorage.getItem(key) ?? localStorage.getItem(LEGACY_POSTS_KEY)
    );
    const next = current.filter(
      item => item.id !== sourcePostId && item.id !== post.id
    );
    localStorage.setItem(key, JSON.stringify(next));
    localStorage.setItem(LEGACY_POSTS_KEY, JSON.stringify(next));
    window.dispatchEvent(
      new CustomEvent('kyrub-social-posts-updated', {
        detail: { uid: user.uid, posts: next, source: 'local' },
      })
    );
  };

  const deletePost = async () => {
    if (!user || !deleteCandidate || deleteCandidate.authorId !== user.uid) return;
    setDeleteBusy(true);
    try {
      await deleteDoc(doc(db, 'social_posts', deleteCandidate.id));
      removeLocalPost(deleteCandidate);
      if (commentsPost?.id === deleteCandidate.id) setCommentsPost(null);
      if (metricsPost?.id === deleteCandidate.id) setMetricsPost(null);
      setDeleteCandidate(null);
      showNotice(
        deleteCandidate.publicationType === 'status'
          ? 'Status excluído.'
          : 'Publicação excluída.'
      );
    } catch {
      showNotice('Não foi possível excluir a publicação.');
    } finally {
      setDeleteBusy(false);
    }
  };

  const requestSponsorship = (post: SocialPost) => {
    window.dispatchEvent(
      new CustomEvent('kyrub-sponsor-post-requested', {
        detail: { postId: post.id, authorId: post.authorId },
      })
    );
    showNotice('O fluxo de patrocínio será conectado na próxima etapa.');
  };

  return (
    <>
      {targets.map(item =>
        createPortal(
          <div
            className="mt-2 grid grid-cols-3 gap-1.5 border-t border-slate-800 pt-3"
            aria-label="Ações da publicação"
          >
            <button
              type="button"
              onClick={() =>
                void socialFeed.toggleLike(item.post.id).catch(() =>
                  showNotice('Não foi possível atualizar a curtida.')
                )
              }
              className={`flex min-h-10 min-w-0 items-center justify-center gap-1 rounded-xl border px-1.5 text-[8px] font-black uppercase ${
                socialFeed.likedPostIds.has(item.post.id)
                  ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                  : 'border-slate-800 bg-slate-950 text-slate-400'
              }`}
              aria-label={
                socialFeed.likedPostIds.has(item.post.id)
                  ? 'Remover curtida'
                  : 'Curtir publicação'
              }
            >
              <Heart
                className={`h-4 w-4 shrink-0 ${
                  socialFeed.likedPostIds.has(item.post.id) ? 'fill-current' : ''
                }`}
              />
              <span className="truncate">Curtir {item.post.likes}</span>
            </button>
            <button
              type="button"
              onClick={() => openComments(item.post)}
              className="flex min-h-10 min-w-0 items-center justify-center gap-1 rounded-xl border border-slate-800 bg-slate-950 px-1.5 text-[8px] font-black uppercase text-slate-400"
            >
              <MessageCircle className="h-4 w-4 shrink-0" />
              <span className="truncate">
                Comentar {item.post.commentCount ?? 0}
              </span>
            </button>
            <button
              type="button"
              onClick={() => void sharePost(item.post)}
              className="flex min-h-10 min-w-0 items-center justify-center gap-1 rounded-xl border border-slate-800 bg-slate-950 px-1.5 text-[8px] font-black uppercase text-slate-400"
            >
              <Share2 className="h-4 w-4 shrink-0" />
              <span className="truncate">Compartilhar</span>
            </button>
          </div>,
          item.target,
          `actions-${item.key}`
        )
      )}

      {targets.flatMap(item =>
        item.menuTarget
          ? [
              createPortal(
                <div>
                  <button
                    type="button"
                    onClick={() => setMetricsPost(item.post)}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[9px] font-black uppercase text-sky-300 hover:bg-sky-500/10"
                  >
                    <BarChart3 className="h-4 w-4" />
                    Métricas da publicação
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteCandidate(item.post)}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[9px] font-black uppercase text-red-300 hover:bg-red-500/10"
                  >
                    <Trash2 className="h-4 w-4" />
                    {item.post.publicationType === 'status'
                      ? 'Excluir Status'
                      : 'Excluir publicação'}
                  </button>
                </div>,
                item.menuTarget,
                `menu-${item.key}`
              ),
            ]
          : []
      )}

      {commentsPost && (
        <div className="fixed inset-0 z-[160] flex items-end justify-center bg-slate-950/95 backdrop-blur-md sm:items-center sm:p-4">
          <section className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-slate-800 bg-slate-950 sm:rounded-3xl">
            <header className="flex items-center justify-between border-b border-slate-900 px-4 py-3">
              <div>
                <span className="text-[9px] font-black uppercase tracking-wider text-orange-400">
                  Publicação
                </span>
                <h3 className="text-base font-black text-white">
                  Comentários {commentsForSelectedPost.length}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCommentsPost(null)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-slate-500"
                aria-label="Fechar comentários"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {commentsForSelectedPost.map(comment => (
                <article
                  key={comment.id}
                  className="rounded-2xl border border-slate-800 bg-slate-900 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="text-[10px] font-black text-white">
                        {comment.authorName}
                      </h4>
                      <span className="text-[8px] text-slate-600">
                        {new Date(comment.createdAt).toLocaleString('pt-BR')}
                      </span>
                    </div>
                    {comment.authorId === user?.uid && (
                      <button
                        type="button"
                        onClick={() => void deleteComment(comment.id)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-red-300 hover:bg-red-500/10"
                        aria-label="Excluir comentário"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <p className="mt-2 whitespace-pre-line text-[10px] leading-relaxed text-slate-300">
                    {comment.text}
                  </p>
                </article>
              ))}

              {commentsForSelectedPost.length === 0 && (
                <p className="rounded-2xl border border-dashed border-slate-800 px-4 py-10 text-center text-[10px] text-slate-500">
                  Seja a primeira pessoa a comentar.
                </p>
              )}
            </div>

            <form
              onSubmit={submitComment}
              className="flex gap-2 border-t border-slate-900 p-3"
            >
              <input
                value={commentDraft}
                onChange={event =>
                  setCommentDraft(event.target.value.slice(0, 1000))
                }
                placeholder="Escreva um comentário..."
                className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-900 px-3 text-xs text-white outline-none focus:border-orange-500/60"
              />
              <button
                type="submit"
                disabled={commentBusy || !commentDraft.trim()}
                className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-500 text-slate-950 disabled:opacity-50"
                aria-label="Enviar comentário"
              >
                {commentBusy ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </form>
          </section>
        </div>
      )}

      {metricsPost && (
        <div className="fixed inset-0 z-[165] flex items-end justify-center bg-slate-950/95 backdrop-blur-md sm:items-center sm:p-4">
          <section className="w-full max-w-md overflow-hidden rounded-t-3xl border border-slate-800 bg-slate-950 sm:rounded-3xl">
            <header className="flex items-center justify-between border-b border-slate-900 px-4 py-3">
              <div>
                <span className="text-[9px] font-black uppercase tracking-wider text-sky-300">
                  Desempenho
                </span>
                <h3 className="text-base font-black text-white">
                  Métricas da publicação
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setMetricsPost(null)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-slate-500"
                aria-label="Fechar métricas"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="grid grid-cols-2 gap-2 p-4">
              {[
                [Eye, 'Visualizações', selectedMetrics.views],
                [Heart, 'Curtidas', selectedMetrics.likes],
                [Bookmark, 'Salvamentos', selectedMetrics.saves],
                [Share2, 'Compartilhamentos', selectedMetrics.shares],
                [MessageCircle, 'Comentários', selectedMetrics.comments],
              ].map(([Icon, label, value]) => {
                const MetricIcon = Icon as typeof Eye;
                return (
                  <article
                    key={String(label)}
                    className="rounded-2xl border border-slate-800 bg-slate-900 p-3"
                  >
                    <MetricIcon className="h-4 w-4 text-sky-300" />
                    <strong className="mt-3 block text-xl text-white">
                      {String(value)}
                    </strong>
                    <span className="text-[8px] font-black uppercase text-slate-500">
                      {String(label)}
                    </span>
                  </article>
                );
              })}
            </div>

            <div className="border-t border-slate-900 p-4">
              <p className="mb-3 text-[9px] leading-relaxed text-slate-500">
                Visualizações são contabilizadas uma vez por usuário autenticado.
                Os dados começam a ser registrados a partir da ativação desta
                atualização.
              </p>
              {metricsPost.publicationType !== 'status' && (
                <button
                  type="button"
                  onClick={() => requestSponsorship(metricsPost)}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 text-[10px] font-black uppercase text-slate-950"
                >
                  <Rocket className="h-4 w-4" />
                  Patrocinar publicação
                </button>
              )}
            </div>
          </section>
        </div>
      )}

      {deleteCandidate && (
        <div className="fixed inset-0 z-[170] flex items-center justify-center bg-slate-950/95 p-4 backdrop-blur-md">
          <section className="w-full max-w-sm rounded-3xl border border-red-500/25 bg-slate-950 p-5 shadow-2xl">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-500/10 text-red-300">
              <Trash2 className="h-5 w-5" />
            </div>
            <h3 className="mt-4 text-base font-black text-white">
              {deleteCandidate.publicationType === 'status'
                ? 'Excluir este Status?'
                : 'Excluir esta publicação?'}
            </h3>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
              A remoção é permanente e retira o conteúdo do seu perfil e da Praça.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDeleteCandidate(null)}
                disabled={deleteBusy}
                className="h-11 rounded-xl border border-slate-800 bg-slate-900 text-[9px] font-black uppercase text-slate-400"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void deletePost()}
                disabled={deleteBusy}
                className="flex h-11 items-center justify-center gap-2 rounded-xl bg-red-500 text-[9px] font-black uppercase text-white disabled:opacity-50"
              >
                {deleteBusy && <LoaderCircle className="h-4 w-4 animate-spin" />}
                Excluir
              </button>
            </div>
          </section>
        </div>
      )}

      {notice && (
        <div className="fixed bottom-5 left-1/2 z-[180] -translate-x-1/2 rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-[9px] font-black text-white shadow-2xl">
          {notice}
        </div>
      )}
    </>
  );
}
