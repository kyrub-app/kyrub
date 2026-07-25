import { useMemo, useState } from 'react';
import {
  CircleUserRound,
  Heart,
  LoaderCircle,
  MessageCircle,
  Send,
  Trash2,
} from 'lucide-react';
import type { Friend, SocialPost } from '../types';
import type { SocialPostComment } from '../hooks/usePublicSocialFeed';
import { MediaCarousel } from './MediaCarousel';

interface PublicSocialFeedPanelProps {
  posts: SocialPost[];
  loading: boolean;
  currentUserId: string;
  likedPostIds: Set<string>;
  commentsByPost: Map<string, SocialPostComment[]>;
  friends: Friend[];
  searchQuery: string;
  filter: 'recentes' | 'favoritos';
  onToggleLike: (postId: string) => Promise<void>;
  onAddComment: (postId: string, text: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
  triggerToast: (
    message: string,
    type?: 'success' | 'error' | 'info'
  ) => void;
}

function Avatar({
  src,
  name,
  className,
}: {
  src?: string;
  name: string;
  className: string;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={className}
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <span
      className={`${className} flex items-center justify-center bg-slate-950 text-slate-500`}
      role="img"
      aria-label={`Foto de ${name} não informada`}
    >
      <CircleUserRound className="h-1/2 w-1/2" />
    </span>
  );
}

const matchesSearch = (value: string | undefined, query: string) =>
  Boolean(value?.toLocaleLowerCase('pt-BR').includes(query));

export function PublicSocialFeedPanel({
  posts,
  loading,
  currentUserId,
  likedPostIds,
  commentsByPost,
  friends,
  searchQuery,
  filter,
  onToggleLike,
  onAddComment,
  onDeleteComment,
  triggerToast,
}: PublicSocialFeedPanelProps) {
  const [expandedComments, setExpandedComments] = useState<Set<string>>(
    new Set()
  );
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [pendingAction, setPendingAction] = useState('');

  const visiblePosts = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLocaleLowerCase('pt-BR');
    return posts.filter(post => {
      if (post.publicationType === 'status') return false;
      if (normalizedSearch) {
        const matches =
          matchesSearch(post.user, normalizedSearch) ||
          matchesSearch(post.content, normalizedSearch) ||
          post.taggedUsers?.some(user => matchesSearch(user, normalizedSearch));
        if (!matches) return false;
      }

      if (filter === 'favoritos') {
        if (post.authorId === currentUserId) return true;
        const friend = friends.find(
          item => item.id === post.authorId || item.name === post.user
        );
        return Boolean(friend?.favorited);
      }

      return true;
    });
  }, [currentUserId, filter, friends, posts, searchQuery]);

  const toggleComments = (postId: string) => {
    setExpandedComments(current => {
      const next = new Set(current);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  };

  const submitComment = async (postId: string) => {
    const text = commentDrafts[postId]?.trim() ?? '';
    if (!text) return;

    setPendingAction(`comment-${postId}`);
    try {
      await onAddComment(postId, text);
      setCommentDrafts(current => ({ ...current, [postId]: '' }));
      setExpandedComments(current => new Set(current).add(postId));
    } catch (error) {
      console.warn('Falha ao comentar publicação.', error);
      triggerToast('Não foi possível enviar o comentário.', 'error');
    } finally {
      setPendingAction('');
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-48 items-center justify-center rounded-3xl border border-slate-800 bg-slate-900/60">
        <LoaderCircle className="h-6 w-6 animate-spin text-orange-400" />
      </div>
    );
  }

  return (
    <section className="space-y-4" id="public-social-feed-panel">
      {visiblePosts.map(post => {
        const comments = commentsByPost.get(post.id) ?? [];
        const isLiked = likedPostIds.has(post.id);
        const commentsOpen = expandedComments.has(post.id);

        return (
          <article
            key={post.id}
            className="space-y-3 rounded-3xl border border-slate-800/80 bg-slate-900 p-4 shadow-lg"
          >
            <header className="flex items-center gap-3">
              <Avatar
                src={post.avatar}
                name={post.user}
                className="h-10 w-10 rounded-full border border-slate-800 object-cover"
              />
              <div className="min-w-0 flex-1">
                <h4 className="truncate text-xs font-black text-slate-100">
                  {post.user}
                </h4>
                <span className="font-mono text-[9px] text-slate-500">
                  {post.time}
                </span>
              </div>
              <span className="rounded-full border border-orange-500/20 bg-orange-500/10 px-2 py-1 text-[8px] font-black uppercase text-orange-300">
                Feed
              </span>
            </header>

            {post.content && (
              <p className="whitespace-pre-line text-xs leading-relaxed text-slate-300">
                {post.content}
              </p>
            )}

            {post.taggedUsers && post.taggedUsers.length > 0 && (
              <p className="text-[9px] font-mono text-teal-400">
                com {post.taggedUsers.map(name => `@${name}`).join(', ')}
              </p>
            )}

            {post.mediaUrls && post.mediaUrls.length > 0 && (
              <MediaCarousel mediaUrls={post.mediaUrls} />
            )}

            <div className="grid grid-cols-2 gap-2 border-t border-slate-800/70 pt-3">
              <button
                type="button"
                onClick={async () => {
                  setPendingAction(`like-${post.id}`);
                  try {
                    await onToggleLike(post.id);
                  } catch (error) {
                    console.warn('Falha ao curtir publicação.', error);
                    triggerToast('Não foi possível atualizar a curtida.', 'error');
                  } finally {
                    setPendingAction('');
                  }
                }}
                disabled={pendingAction === `like-${post.id}`}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[9px] font-black uppercase transition-colors ${
                  isLiked
                    ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-rose-300'
                }`}
              >
                <Heart className={`h-4 w-4 ${isLiked ? 'fill-current' : ''}`} />
                {post.likes} {post.likes === 1 ? 'curtida' : 'curtidas'}
              </button>
              <button
                type="button"
                onClick={() => toggleComments(post.id)}
                className="flex items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[9px] font-black uppercase text-slate-400 hover:text-teal-300"
              >
                <MessageCircle className="h-4 w-4" />
                {comments.length} {comments.length === 1 ? 'comentário' : 'comentários'}
              </button>
            </div>

            {commentsOpen && (
              <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950 p-3">
                <div className="max-h-64 space-y-2 overflow-y-auto">
                  {comments.map(comment => (
                    <div
                      key={comment.id}
                      className="flex items-start gap-2 rounded-xl bg-slate-900 p-2.5"
                    >
                      <Avatar
                        src={comment.authorAvatar}
                        name={comment.authorName}
                        className="h-7 w-7 shrink-0 rounded-full border border-slate-800 object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <strong className="truncate text-[9px] text-slate-200">
                            {comment.authorName}
                          </strong>
                          {comment.authorId === currentUserId && (
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await onDeleteComment(comment.id);
                                } catch (error) {
                                  console.warn('Falha ao excluir comentário.', error);
                                  triggerToast(
                                    'Não foi possível excluir o comentário.',
                                    'error'
                                  );
                                }
                              }}
                              className="text-slate-600 hover:text-red-400"
                              aria-label="Excluir comentário"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                        <p className="mt-1 whitespace-pre-line text-[10px] leading-relaxed text-slate-400">
                          {comment.text}
                        </p>
                      </div>
                    </div>
                  ))}
                  {comments.length === 0 && (
                    <p className="py-3 text-center text-[10px] text-slate-600">
                      Seja a primeira pessoa a comentar.
                    </p>
                  )}
                </div>

                <div className="flex items-end gap-2">
                  <textarea
                    value={commentDrafts[post.id] ?? ''}
                    onChange={event =>
                      setCommentDrafts(current => ({
                        ...current,
                        [post.id]: event.target.value.slice(0, 1000),
                      }))
                    }
                    placeholder="Escreva um comentário..."
                    rows={2}
                    className="min-h-10 flex-1 resize-none rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[10px] text-white outline-none focus:border-teal-500/50"
                  />
                  <button
                    type="button"
                    onClick={() => submitComment(post.id)}
                    disabled={
                      pendingAction === `comment-${post.id}` ||
                      !(commentDrafts[post.id] ?? '').trim()
                    }
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-500 text-slate-950 disabled:opacity-40"
                    aria-label="Enviar comentário"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </article>
        );
      })}

      {visiblePosts.length === 0 && (
        <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/45 px-5 py-12 text-center">
          <CircleUserRound className="mx-auto h-8 w-8 text-slate-700" />
          <p className="mt-3 text-xs text-slate-500">
            Nenhuma publicação pública encontrada para este filtro.
          </p>
        </div>
      )}
    </section>
  );
}
