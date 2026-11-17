import { useEffect, useMemo, useState } from 'react';
import {
  Bookmark,
  EllipsisVertical,
  Flag,
  MessageCircleMore,
  UserRoundPlus,
  CircleUserRound,
  Heart,
  Gift,
  ArrowRight,
  LoaderCircle,
  MessageCircle,
  Send,
  Trash2,
} from 'lucide-react';
import type { Friend, SocialPost } from '../types';
import type { SocialPostComment } from '../hooks/usePublicSocialFeed';
import { MediaCarousel } from './MediaCarousel';
import { removeSavedPublication, savePublication, subscribeSavedPublications } from '../utils/savedLibrary';
import { submitSocialPostReport, type SocialReportReason } from '../utils/socialReports';

interface PublicSocialFeedPanelProps {
  posts: SocialPost[];
  loading: boolean;
  currentUserId: string;
  likedPostIds: Set<string>;
  commentsByPost: Map<string, SocialPostComment[]>;
  friends: Friend[];
  suggestedUsers: Friend[];
  onConnectUser: (userId: string) => void | Promise<void>;
  onOpenChat: (friend: Friend) => void;
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

function CouponOfferCard({ storeId, promotionId }: { storeId: string; promotionId: string }) {
  const [offer, setOffer] = useState<{
    active: boolean;
    title: string;
    code: string;
    discountType: 'percentage' | 'fixed';
    discountValue: number;
    storeSlug: string;
    redemptionCount: number;
    maxRedemptions: number;
    remaining: number | null;
    restrictedToInvitee?: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch(
          `/api/store-promotions/public/${encodeURIComponent(storeId)}/${encodeURIComponent(promotionId)}`,
          { cache: 'no-store' }
        );
        if (!response.ok) throw new Error('Coupon unavailable');
        const payload = await response.json();
        if (!cancelled) setOffer(payload);
      } catch {
        if (!cancelled) setOffer(null);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [storeId, promotionId]);

  const discount = offer?.discountType === 'percentage'
    ? `${offer.discountValue}% OFF`
    : offer ? `R$ ${offer.discountValue.toFixed(2)} OFF` : '';

  return (
    <div className="space-y-3">
      <div className="space-y-4 rounded-3xl border border-slate-700 bg-neutral-800 px-5 py-8 text-center">
        <Gift className="mx-auto h-9 w-9 text-orange-300" aria-hidden="true" />
        <p className="text-sm font-semibold text-slate-300">Oferta especial da loja</p>
        <h5 className="text-xl font-black text-white">{offer?.title || 'Cupom de desconto'}</h5>
        {offer && <p className="text-sm font-bold text-orange-200">{discount}</p>}
        {offer?.restrictedToInvitee && (
          <p className="text-[11px] text-amber-200">
            Cupom exclusivo de um comprador convidado. O link é público, mas somente a conta autorizada poderá utilizá-lo após validação no servidor.
          </p>
        )}
        <div className="mx-auto w-fit rounded-2xl border border-slate-600 px-5 py-3 font-mono text-base font-black tracking-wide text-white">
          {offer?.code || 'Carregando cupom…'}
        </div>
        <p className="text-xs text-slate-300" aria-live="polite">
          {!offer ? 'Disponibilidade não confirmada no momento'
            : !offer.active ? 'Cupom indisponível'
            : offer.remaining === null ? `${offer.redemptionCount} utilizados · Sem limite total`
            : `${offer.redemptionCount} de ${offer.maxRedemptions} utilizados · ${offer.remaining} disponíveis`}
        </p>
      </div>
      {offer?.active && offer.storeSlug ? (
        <a
          href={`/@${encodeURIComponent(offer.storeSlug)}?coupon=${encodeURIComponent(offer.code)}`}
          className="flex min-h-12 items-center justify-center gap-3 rounded-full bg-white px-4 text-sm font-black text-slate-950 hover:bg-slate-200"
          aria-label={`Aproveitar cupom ${offer.code} na loja`}
        >
          Aproveitar cupom <ArrowRight className="h-4 w-4" />
        </a>
      ) : (
        <div className="rounded-full border border-slate-700 px-4 py-3 text-center text-xs text-slate-400">
          Oferta indisponível no momento
        </div>
      )}
    </div>
  );
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
  suggestedUsers,
  onConnectUser,
  onOpenChat,
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
  const [savedPostIds, setSavedPostIds] = useState<Set<string>>(new Set());
  const [openPostMenuId, setOpenPostMenuId] = useState<string | null>(null);
  const [reportPostId, setReportPostId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState<SocialReportReason>('spam');

  useEffect(() => subscribeSavedPublications(
    items => setSavedPostIds(new Set(items.filter(item => item.sourceKind === 'praca').map(item => item.sourceId))),
    error => console.warn('Falha ao acompanhar Salvos.', error)
  ), []);

  const visiblePosts = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLocaleLowerCase('pt-BR');
    return posts.filter(post => {
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
        const isStatus = post.publicationType === 'status';
        const connectedAuthor = friends.find(friend => friend.id === post.authorId && friend.added);
        const suggestedAuthor = suggestedUsers.find(friend => friend.id === post.authorId);
        const canReport = Boolean(post.authorId && post.authorId !== currentUserId);

        return (
          <article
            key={post.id}
            className={`space-y-3 rounded-3xl border p-4 shadow-lg ${
              isStatus
                ? 'border-teal-500/25 bg-gradient-to-br from-teal-950/80 to-slate-900'
                : 'border-slate-800/80 bg-slate-900'
            }`}
          >
            <header className="flex items-center gap-3">
              <Avatar
                src={post.avatar}
                name={post.user}
                className={`h-10 w-10 rounded-full border-2 object-cover ${
                  isStatus ? 'border-teal-400' : 'border-slate-800'
                }`}
              />
              <div className="min-w-0 flex-1">
                <h4 className="truncate text-xs font-black text-slate-100">
                  {post.user}
                </h4>
                <span className="font-mono text-[9px] text-slate-500">
                  {post.time}
                </span>
              </div>
              <span
                className={`rounded-full border px-2 py-1 text-[8px] font-black uppercase ${
                  isStatus
                    ? 'border-teal-500/30 bg-teal-500/10 text-teal-300'
                    : 'border-orange-500/20 bg-orange-500/10 text-orange-300'
                }`}
              >
                {isStatus ? 'Status' : 'Feed'}
              </span>
              {canReport && (
                <div className="relative">
                  <button
                    type="button"
                    aria-label={`Mais opções da publicação de ${post.user}`}
                    aria-expanded={openPostMenuId === post.id}
                    onClick={() => setOpenPostMenuId(current => current === post.id ? null : post.id)}
                    className="rounded-lg border border-slate-700 p-2 text-slate-300 hover:text-white"
                  >
                    <EllipsisVertical className="h-4 w-4" />
                  </button>
                  {openPostMenuId === post.id && (
                    <div className="absolute right-0 top-10 z-30 min-w-44 space-y-1 rounded-xl border border-slate-700 bg-slate-950 p-2 shadow-xl" role="menu">
                      {suggestedAuthor?.connectionStatus === 'none' && suggestedAuthor.isProfileVisible !== false && (
                        <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-lg p-2 text-left text-xs text-slate-200 hover:bg-slate-800"
                          onClick={() => {
                            setOpenPostMenuId(null);
                            void onConnectUser(post.authorId!);
                          }}
                        >
                          <UserRoundPlus className="h-4 w-4" /> Conectar
                        </button>
                      )}
                      {suggestedAuthor?.connectionStatus === 'pending_sent' && (
                        <p className="px-2 py-1 text-xs text-slate-400">Solicitação de conexão pendente</p>
                      )}
                      {connectedAuthor && (
                        <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-lg p-2 text-left text-xs text-slate-200 hover:bg-slate-800"
                          onClick={() => { setOpenPostMenuId(null); onOpenChat(connectedAuthor); }}
                        >
                          <MessageCircleMore className="h-4 w-4" /> Conversar
                        </button>
                      )}
                      <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-lg p-2 text-left text-xs text-amber-300 hover:bg-slate-800"
                        onClick={() => { setOpenPostMenuId(null); setReportReason('spam'); setReportPostId(post.id); }}
                      >
                        <Flag className="h-4 w-4" /> Denunciar publicação
                      </button>
                    </div>
                  )}
                </div>
              )}
            </header>
            {reportPostId === post.id && canReport && (
              <div className="space-y-2 rounded-xl border border-amber-500/30 bg-slate-950 p-3" role="group" aria-label="Denunciar publicação">
                <label className="block text-xs font-semibold text-slate-200" htmlFor={`report-reason-${post.id}`}>Qual é o motivo da denúncia?</label>
                <select id={`report-reason-${post.id}`} value={reportReason} onChange={event => setReportReason(event.target.value as SocialReportReason)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-xs text-slate-100">
                  <option value="spam">Spam ou publicidade abusiva</option>
                  <option value="abuse">Assédio ou ofensa</option>
                  <option value="fraud">Golpe ou fraude</option>
                  <option value="unsafe">Conteúdo perigoso ou inadequado</option>
                  <option value="other">Outro motivo</option>
                </select>
                <div className="flex gap-2">
                  <button type="button" disabled={pendingAction === `report-${post.id}`} className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-50"
                    onClick={async () => {
                      setPendingAction(`report-${post.id}`);
                      try {
                        const outcome = await submitSocialPostReport(post.id, reportReason);
                        triggerToast(outcome === 'already_reported' ? 'Você já denunciou esta publicação.' : 'Denúncia encaminhada à moderação.', 'success');
                        setReportPostId(null);
                      } catch (error) {
                        console.warn('Não foi possível enviar a denúncia.', error);
                        triggerToast('Denúncia não enviada. Tente novamente.', 'error');
                      } finally { setPendingAction(''); }
                    }}
                  >{pendingAction === `report-${post.id}` ? 'Enviando…' : 'Enviar denúncia'}</button>
                  <button type="button" className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300" onClick={() => setReportPostId(null)}>Cancelar</button>
                </div>
              </div>
            )}

            {post.storeReview && (
              <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs font-semibold text-amber-300">
                Avaliação da loja {post.storeReview.storeName} · {'★'.repeat(Math.max(0, Math.min(5, post.storeReview.rating)))}
              </p>
            )}

            {post.content && !post.storePromotion && (
              <p className="whitespace-pre-line text-xs leading-relaxed text-slate-300">
                {post.content}
              </p>
            )}

            {post.storePromotion && (
              <CouponOfferCard storeId={post.storePromotion.storeId} promotionId={post.storePromotion.promotionId} />
            )}

            {post.taggedUsers && post.taggedUsers.length > 0 && (
              <p className="text-[9px] font-mono text-teal-400">
                com {post.taggedUsers.map(name => `@${name}`).join(', ')}
              </p>
            )}

            {post.mediaUrls && post.mediaUrls.length > 0 && (
              <MediaCarousel mediaUrls={post.mediaUrls} />
            )}

            <div className="grid grid-cols-3 gap-2 border-t border-slate-800/70 pt-3">
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
                onClick={async () => {
                  const isSaved = savedPostIds.has(post.id);
                  setPendingAction(`save-${post.id}`);
                  try {
                    if (isSaved) await removeSavedPublication('praca', post.id);
                    else await savePublication('praca', post.id);
                    triggerToast(isSaved ? 'Publicação removida dos Salvos.' : 'Publicação salva.', 'success');
                  } catch (error) {
                    console.warn('Falha ao atualizar Salvos.', error);
                    triggerToast('Não foi possível atualizar seus Salvos.', 'error');
                  } finally {
                    setPendingAction('');
                  }
                }}
                disabled={pendingAction === `save-${post.id}`}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[9px] font-black uppercase transition-colors ${
                  savedPostIds.has(post.id)
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-amber-300'
                }`}
                aria-label={savedPostIds.has(post.id) ? 'Remover dos Salvos' : 'Salvar publicação'}
              >
                <Bookmark className={`h-4 w-4 ${savedPostIds.has(post.id) ? 'fill-current' : ''}`} />
                {savedPostIds.has(post.id) ? 'Salvo' : 'Salvar'}
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
