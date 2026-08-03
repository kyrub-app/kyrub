import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Heart,
  LoaderCircle,
  MessageCircle,
  Send,
  Share2,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
} from 'firebase/firestore';
import type { SocialPost } from '../types';
import {
  usePublicSocialFeed,
  type SocialPostComment,
} from '../hooks/usePublicSocialFeed';
import { auth, db } from '../utils/firebase';

type PostTarget = {
  key: string;
  target: HTMLElement;
  menuTarget: HTMLElement | null;
  post: SocialPost;
};

type SocialLikeRecord = {
  id: string;
  postId: string;
  userId: string;
};

type DirectoryUser = {
  id: string;
  name: string;
  photoUrl: string;
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
      item.target === next[index]?.target &&
      item.menuTarget === next[index]?.menuTarget &&
      item.post.id === next[index]?.post.id
  );

const postFromCard = (
  card: HTMLElement,
  posts: SocialPost[],
  usedPostIds: Set<string>
): SocialPost | null => {
  const author = card.querySelector<HTMLElement>('h4')?.textContent?.trim() ?? '';
  const content = [...card.querySelectorAll<HTMLElement>('p')]
    .find(item => item.className.includes('whitespace-pre-line'))
    ?.textContent?.trim() ?? '';
  const time = card.querySelector<HTMLElement>('span.font-mono')
    ?.textContent?.trim() ?? '';

  const candidates = posts.filter(
    post =>
      !usedPostIds.has(post.id) &&
      post.user.trim() === author &&
      post.content.trim() === content
  );

  return candidates.find(post => post.time.trim() === time) ?? candidates[0] ?? null;
};

function Avatar({
  src,
  name,
}: {
  src?: string;
  name: string;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className="h-10 w-10 rounded-full object-cover"
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-slate-500">
      <UserRound className="h-5 w-5" />
    </span>
  );
}

export function ProfilePostInteractionsBridge() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [targets, setTargets] = useState<PostTarget[]>([]);
  const [likes, setLikes] = useState<SocialLikeRecord[]>([]);
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([]);
  const [selectedPost, setSelectedPost] = useState<SocialPost | null>(null);
  const [selectedTab, setSelectedTab] = useState<'comments' | 'likes'>('comments');
  const [commentDraft, setCommentDraft] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<SocialPost | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const socialFeed = usePublicSocialFeed();

  useEffect(() => onAuthStateChanged(auth, nextUser => {
    setUser(nextUser);
    if (!nextUser) {
      setTargets([]);
      setSelectedPost(null);
      setDeleteCandidate(null);
    }
  }), []);

  useEffect(() => {
    if (!user) {
      setLikes([]);
      setDirectoryUsers([]);
      return;
    }

    const unsubscribeLikes = onSnapshot(
      collection(db, 'social_post_likes'),
      snapshot => {
        setLikes(
          snapshot.docs.flatMap(item => {
            const data = item.data() as Record<string, unknown>;
            const postId = readString(data.postId);
            const userId = readString(data.userId);
            return postId && userId
              ? [{ id: item.id, postId, userId }]
              : [];
          })
        );
      },
      () => setLikes([])
    );

    const unsubscribeUsers = onSnapshot(
      collection(db, 'users'),
      snapshot => {
        setDirectoryUsers(
          snapshot.docs.map(item => {
            const data = item.data() as Record<string, unknown>;
            return {
              id: item.id,
              name:
                readString(data.name) ||
                readString(data.displayName) ||
                readString(data.email).split('@')[0] ||
                'Usuário Kyrub',
              photoUrl: readString(data.photoUrl) || readString(data.avatar),
            };
          })
        );
      },
      () => setDirectoryUsers([])
    );

    return () => {
      unsubscribeLikes();
      unsubscribeUsers();
    };
  }, [user]);

  useEffect(() => {
    const synchronizeTargets = () => {
      const profileModal = document.getElementById('profile-social-hub-modal');
      if (!profileModal) {
        setTargets(current => current.length === 0 ? current : []);
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

        let target = card.querySelector<HTMLElement>(
          '[data-profile-post-interactions-slot="true"]'
        );
        if (!target) {
          target = document.createElement('div');
          target.dataset.profilePostInteractionsSlot = 'true';
          card.appendChild(target);
        }

        const menu = menuButton
          .closest('header')
          ?.querySelector<HTMLElement>('div.absolute.right-0.top-10');
        let menuTarget: HTMLElement | null = null;
        if (menu && post.authorId === user?.uid) {
          menuTarget = menu.querySelector<HTMLElement>(
            '[data-profile-post-delete-slot="true"]'
          );
          if (!menuTarget) {
            menuTarget = document.createElement('div');
            menuTarget.dataset.profilePostDeleteSlot = 'true';
            menu.appendChild(menuTarget);
          }
        }

        nextTargets.push({
          key: post.id,
          target,
          menuTarget,
          post,
        });
      });

      setTargets(current => sameTargets(current, nextTargets) ? current : nextTargets);
    };

    synchronizeTargets();
    const timer = window.setInterval(synchronizeTargets, 250);
    return () => {
      window.clearInterval(timer);
      document
        .querySelectorAll<HTMLElement>(
          '[data-profile-post-interactions-slot="true"], [data-profile-post-delete-slot="true"]'
        )
        .forEach(target => target.remove());
    };
  }, [socialFeed.posts, user?.uid]);

  const directoryById = useMemo(
    () => new Map(directoryUsers.map(item => [item.id, item])),
    [directoryUsers]
  );

  const commentsForSelectedPost: SocialPostComment[] = selectedPost
    ? socialFeed.commentsByPost.get(selectedPost.id) ?? []
    : [];

  const likesForSelectedPost = selectedPost
    ? likes.filter(like => like.postId === selectedPost.id)
    : [];

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3200);
  };

  const openDetails = (post: SocialPost, tab: 'comments' | 'likes') => {
    setSelectedPost(post);
    setSelectedTab(tab);
    setCommentDraft('');
  };

  const submitComment = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedPost || !commentDraft.trim()) return;
    setCommentBusy(true);
    try {
      await socialFeed.addComment(selectedPost.id, commentDraft);
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
        return;
      }
      await navigator.clipboard.writeText(`${text}\n${url}`);
      showNotice('Link da publicação copiado.');
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
      if (selectedPost?.id === deleteCandidate.id) setSelectedPost(null);
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

  const personForLike = (like: SocialLikeRecord): DirectoryUser => {
    if (like.userId === user?.uid) {
      return {
        id: like.userId,
        name:
          user.displayName ||
          user.email?.split('@')[0] ||
          'Você',
        photoUrl: user.photoURL || '',
      };
    }
    return directoryById.get(like.userId) ?? {
      id: like.userId,
      name: 'Usuário Kyrub',
      photoUrl: '',
    };
  };

  return (
    <>
      {targets.map(item =>
        createPortal(
          <div className="mt-2 grid grid-cols-3 gap-2 border-t border-slate-800 pt-3">
            <button
              type="button"
              onClick={() => openDetails(item.post, 'comments')}
              className="flex min-h-10 min-w-0 items-center justify-center gap-1 rounded-xl border border-slate-800 bg-slate-950 px-2 text-[8px] font-black uppercase text-slate-400"
            >
              <MessageCircle className="h-4 w-4 shrink-0" />
              <span className="truncate">Comentar {item.post.commentCount ?? 0}</span>
            </button>
            <button
              type="button"
              onClick={() => openDetails(item.post, 'likes')}
              className="flex min-h-10 min-w-0 items-center justify-center gap-1 rounded-xl border border-slate-800 bg-slate-950 px-2 text-[8px] font-black uppercase text-slate-400"
              aria-label={`Ver quem curtiu a publicação de ${item.post.user}`}
            >
              <Heart className="h-4 w-4 shrink-0" />
              <span className="truncate">Quem curtiu {item.post.likes}</span>
            </button>
            <button
              type="button"
              onClick={() => void sharePost(item.post)}
              className="flex min-h-10 min-w-0 items-center justify-center gap-1 rounded-xl border border-slate-800 bg-slate-950 px-2 text-[8px] font-black uppercase text-slate-400"
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
                <button
                  type="button"
                  onClick={() => setDeleteCandidate(item.post)}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[9px] font-black uppercase text-red-300 hover:bg-red-500/10"
                >
                  <Trash2 className="h-4 w-4" />
                  {item.post.publicationType === 'status'
                    ? 'Excluir Status'
                    : 'Excluir publicação'}
                </button>,
                item.menuTarget,
                `delete-${item.key}`
              ),
            ]
          : []
      )}

      {selectedPost && (
        <div className="fixed inset-0 z-[160] flex items-end justify-center bg-slate-950/95 backdrop-blur-md sm:items-center sm:p-4">
          <section className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-slate-800 bg-slate-950 sm:rounded-3xl">
            <header className="flex items-center justify-between border-b border-slate-900 px-4 py-3">
              <div>
                <span className="text-[9px] font-black uppercase tracking-wider text-orange-400">
                  Publicação
                </span>
                <h3 className="text-base font-black text-white">
                  Interações
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPost(null)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-slate-500"
                aria-label="Fechar interações"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <nav className="grid grid-cols-2 gap-2 border-b border-slate-900 p-3">
              <button
                type="button"
                onClick={() => setSelectedTab('comments')}
                className={`rounded-xl px-3 py-2 text-[9px] font-black uppercase ${
                  selectedTab === 'comments'
                    ? 'bg-orange-500 text-slate-950'
                    : 'border border-slate-800 bg-slate-900 text-slate-400'
                }`}
              >
                Comentários {commentsForSelectedPost.length}
              </button>
              <button
                type="button"
                onClick={() => setSelectedTab('likes')}
                className={`rounded-xl px-3 py-2 text-[9px] font-black uppercase ${
                  selectedTab === 'likes'
                    ? 'bg-rose-500 text-white'
                    : 'border border-slate-800 bg-slate-900 text-slate-400'
                }`}
              >
                Curtidas {likesForSelectedPost.length}
              </button>
            </nav>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {selectedTab === 'comments' && (
                <>
                  {commentsForSelectedPost.map(comment => (
                    <article
                      key={comment.id}
                      className="flex gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-3"
                    >
                      <Avatar src={comment.authorAvatar} name={comment.authorName} />
                      <div className="min-w-0 flex-1">
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
                      </div>
                    </article>
                  ))}

                  {commentsForSelectedPost.length === 0 && (
                    <p className="rounded-2xl border border-dashed border-slate-800 px-4 py-10 text-center text-[10px] text-slate-500">
                      Seja a primeira pessoa a comentar.
                    </p>
                  )}
                </>
              )}

              {selectedTab === 'likes' && (
                <>
                  {likesForSelectedPost.map(like => {
                    const person = personForLike(like);
                    return (
                      <article
                        key={like.id}
                        className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-3"
                      >
                        <Avatar src={person.photoUrl} name={person.name} />
                        <span className="min-w-0 flex-1 truncate text-[10px] font-black text-white">
                          {person.name}
                        </span>
                        <Heart className="h-4 w-4 fill-current text-rose-400" />
                      </article>
                    );
                  })}

                  {likesForSelectedPost.length === 0 && (
                    <p className="rounded-2xl border border-dashed border-slate-800 px-4 py-10 text-center text-[10px] text-slate-500">
                      Esta publicação ainda não recebeu curtidas.
                    </p>
                  )}
                </>
              )}
            </div>

            {selectedTab === 'comments' && (
              <form
                onSubmit={submitComment}
                className="flex gap-2 border-t border-slate-900 p-3"
              >
                <input
                  value={commentDraft}
                  onChange={event => setCommentDraft(event.target.value.slice(0, 1000))}
                  placeholder="Escreva um comentário..."
                  className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-900 px-3 text-xs text-white outline-none focus:border-orange-500/60"
                />
                <button
                  type="submit"
                  disabled={commentBusy || !commentDraft.trim()}
                  className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-500 text-slate-950 disabled:opacity-50"
                  aria-label="Enviar comentário"
                >
                  {commentBusy
                    ? <LoaderCircle className="h-4 w-4 animate-spin" />
                    : <Send className="h-4 w-4" />}
                </button>
              </form>
            )}
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
