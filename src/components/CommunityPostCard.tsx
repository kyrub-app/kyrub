import { useEffect, useRef, useState } from 'react';
import {
  BarChart3, Bookmark, EllipsisVertical, Eye, Flag, Heart, Megaphone, MessageCircle, MessageCircleMore, Share2,
  Trash2, UserRound, UserRoundPlus, UsersRound, X,
} from 'lucide-react';
import type { CloudCommunityPost } from '../utils/communityCloud';
import type { CommunityPostComment, CommunityPostLike } from '../utils/communityPostInteractions';
import type { CommunityPostConnection, CommunityPublicProfile } from '../utils/communityPostConnections';
import { readCommunityPostPublicProfile, requestCommunityPostConnection } from '../utils/communityPostConnections';
import { ChatModal } from './modals/ChatModal';
import { MediaCarousel } from './MediaCarousel';
import { KyrubAdsCommunityPromotionPreview } from './ads/KyrubAdsCommunityPromotionPreview';
import {
  recordCommunityPostView, shareCommunityPostWithMetrics, subscribeCommunityOrganicMetrics,
  type CommunityOrganicEngagement,
} from '../utils/communityOrganicMetrics';
import type { SocialReportReason, SocialReportOutcome } from '../utils/socialReports';

interface CommunityPostCardProps {
  post: CloudCommunityPost;
  viewerId: string;
  canParticipate: boolean;
  communityOwnerId: string;
  likes: CommunityPostLike[];
  comments: CommunityPostComment[];
  connection?: CommunityPostConnection;
  saved: boolean;
  onToggleSave: () => Promise<void>;
  onToggleLike: (liked: boolean) => Promise<void>;
  onComment: (value: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
  onReport: (reason: SocialReportReason) => Promise<SocialReportOutcome>;
  onRemove: () => Promise<void>;
  squarePublished?: boolean;
  onToggleSquare?: () => Promise<void>;
}

const displayDate = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Agora' : new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(date);
};

export function CommunityPostCard({
  post, viewerId, canParticipate, communityOwnerId, likes, comments, connection,
  saved, onToggleSave, onToggleLike, onComment, onDeleteComment, onReport, onRemove,
  squarePublished, onToggleSquare,
}: CommunityPostCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<SocialReportReason>('spam');
  const [profile, setProfile] = useState<CommunityPublicProfile | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [promotionPreviewOpen, setPromotionPreviewOpen] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [engagements, setEngagements] = useState<CommunityOrganicEngagement[]>([]);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState('');
  const cardRef = useRef<HTMLElement | null>(null);
  const [chatDraft, setChatDraft] = useState('');
  const [pending, setPending] = useState('');
  const [notice, setNotice] = useState('');

  const isMine = viewerId === post.authorId;
  const isLiked = likes.some(item => item.postId === post.id && item.userId === viewerId);
  const postComments = comments.filter(item => item.postId === post.id);
  const connected = connection?.status === 'accepted';
  const connectionPending = connection?.status === 'pending';

  // Same view semantics as Praça: observe at least 55% of the actual post
  // once per authenticated viewer. No mount-based synthetic impressions.
  useEffect(() => {
    if (!viewerId || !cardRef.current) return;
    const element = cardRef.current;
    if (!('IntersectionObserver' in window)) return;
    const postHeight = Math.max(1, element.getBoundingClientRect().height);
    const visibleReference = Math.min(postHeight, window.innerHeight);
    const threshold = Math.min(0.55, (0.55 * visibleReference) / postHeight);
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.intersectionRect.height < 0.55 * visibleReference) continue;
        observer.unobserve(entry.target);
        void recordCommunityPostView(post).catch(error =>
          console.warn('Não foi possível registrar visualização orgânica.', error)
        );
      }
    }, { threshold: [threshold] });
    observer.observe(element);
    return () => observer.disconnect();
  }, [post, viewerId]);

  useEffect(() => {
    if (!metricsOpen || !isMine || !viewerId) return;
    setMetricsLoading(true);
    setMetricsError('');
    return subscribeCommunityOrganicMetrics(
      viewerId,
      values => {
        setEngagements(values.filter(item => item.postId === post.id));
        setMetricsLoading(false);
      },
      () => {
        setMetricsError('Não foi possível consultar as métricas agora.');
        setMetricsLoading(false);
      },
    );
  }, [metricsOpen, isMine, post.id, viewerId]);

  const organicCounts = {
    views: engagements.filter(item => item.type === 'view').length,
    likes: likes.filter(item => item.postId === post.id).length,
    saves: engagements.filter(item => item.type === 'save').length,
    shares: engagements.filter(item => item.type === 'share').length,
    comments: postComments.length,
  };

  const run = async (key: string, action: () => Promise<void>) => {
    setPending(key);
    setNotice('');
    try { await action(); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível concluir esta ação.'); }
    finally { setPending(''); }
  };

  return (
    <article ref={cardRef} className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
      <header className="flex items-center gap-3">
        {post.authorAvatar
          ? <img src={post.authorAvatar} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" />
          : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-800 text-white"><UserRound className="h-5 w-5" /></span>}
        <div className="min-w-0 flex-1">
          <strong className="block truncate text-sm text-white">{post.authorName}</strong>
          <span className="text-xs text-slate-400">{displayDate(post.createdAt)}</span>
        </div>
        <div className="relative">
          <button type="button" aria-label={`Mais opções da publicação de ${post.authorName}`}
            aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 text-slate-300">
            <EllipsisVertical className="h-5 w-5" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-11 z-30 min-w-48 space-y-1 rounded-xl border border-slate-700 bg-slate-950 p-2 shadow-2xl" role="menu">
              {!isMine && !connection && (
                <button type="button" role="menuitem"
                  onClick={() => { setMenuOpen(false); void run('connect', async () => {
                    await requestCommunityPostConnection(post.authorId);
                    setNotice('Solicitação de conexão enviada.');
                  }); }}
                  className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-xs text-white hover:bg-slate-800">
                  <UserRoundPlus className="h-4 w-4" /> Conectar
                </button>
              )}
              {!isMine && connectionPending && <p className="px-2 py-2 text-xs text-slate-400">Conexão pendente</p>}
              {!isMine && connected && (
                <button type="button" role="menuitem"
                  onClick={() => { setMenuOpen(false); setChatOpen(true); }}
                  className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-xs text-white hover:bg-slate-800">
                  <MessageCircleMore className="h-4 w-4" /> Conversar
                </button>
              )}
              <button type="button" role="menuitem"
                onClick={() => { setMenuOpen(false); void run('profile', async () => {
                  const person = await readCommunityPostPublicProfile(post.authorId);
                  if (!person.visible && !isMine) throw new Error('Este perfil não está público.');
                  setProfile(person);
                }); }}
                className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-xs text-white hover:bg-slate-800">
                <UserRound className="h-4 w-4" /> {isMine ? 'Meu perfil' : 'Ver perfil'}
              </button>
              {isMine && (
                <button type="button" role="menuitem"
                  onClick={() => { setMenuOpen(false); setMetricsOpen(true); }}
                  className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-xs text-sky-300 hover:bg-slate-800">
                  <BarChart3 className="h-4 w-4" /> Métricas da publicação
                </button>
              )}
              <button type="button" role="menuitem" disabled={Boolean(pending)}
                onClick={() => { setMenuOpen(false); void run('share', async () => {
                  const result = await shareCommunityPostWithMetrics(post);
                  setNotice(result === 'copied' ? 'Conteúdo e endereço do Kyrub copiados.' : 'Compartilhamento concluído.');
                }); }}
                className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40">
                <Share2 className="h-4 w-4" /> Compartilhar
              </button>
              {isMine && onToggleSquare && (
                <button type="button" role="menuitem" disabled={Boolean(pending)}
                  onClick={() => { setMenuOpen(false); void run('square', onToggleSquare); }}
                  className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-xs text-sky-200 hover:bg-slate-800 disabled:opacity-40">
                  <UsersRound className="h-4 w-4" /> {squarePublished ? 'Retirar da Praça' : 'Mostrar na Praça'}
                </button>
              )}
              {isMine && (
                <button type="button" role="menuitem"
                  onClick={() => { setMenuOpen(false); setPromotionPreviewOpen(true); }}
                  className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-xs text-sky-300 hover:bg-slate-800">
                  <Megaphone className="h-4 w-4" /> Promover
                </button>
              )}
              {isMine && (
                <button type="button" role="menuitem" disabled={Boolean(pending)}
                  onClick={() => {
                    setMenuOpen(false);
                    if (!window.confirm('Remover esta publicação definitivamente? O texto, as fotos, os vídeos, as curtidas e os comentários serão excluídos. Essa ação não pode ser desfeita.')) return;
                    void run('remove', onRemove);
                  }}
                  className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-xs text-red-300 hover:bg-slate-800 disabled:opacity-40">
                  <Trash2 className="h-4 w-4" /> Remover publicação
                </button>
              )}
              {!isMine && (
                <button type="button" role="menuitem"
                  onClick={() => { setMenuOpen(false); setReportOpen(true); }}
                  className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-xs text-amber-300 hover:bg-slate-800">
                  <Flag className="h-4 w-4" /> Denunciar publicação
                </button>
              )}
            </div>
          )}
        </div>
      </header>
      {post.content && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-300">{post.content}</p>}
      {post.mediaUrls.length > 0 && <div className="mt-3"><MediaCarousel mediaUrls={post.mediaUrls} /></div>}
      {notice && <p role="status" className="mt-3 rounded-xl border border-sky-600/30 p-2 text-xs text-sky-200">{notice}</p>}
      {reportOpen && !isMine && (
        <section className="mt-3 space-y-2 rounded-xl border border-amber-700/40 bg-slate-950 p-3" aria-label="Denunciar publicação da comunidade">
          <label htmlFor={`community-report-${post.id}`} className="block text-xs text-slate-200">Motivo da denúncia</label>
          <select id={`community-report-${post.id}`} value={reportReason}
            onChange={event => setReportReason(event.target.value as SocialReportReason)}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-xs text-white">
            <option value="spam">Spam ou publicidade abusiva</option>
            <option value="abuse">Assédio ou ofensa</option>
            <option value="fraud">Golpe ou fraude</option>
            <option value="unsafe">Conteúdo perigoso ou inadequado</option>
            <option value="other">Outro motivo</option>
          </select>
          <div className="flex gap-2">
            <button type="button" disabled={Boolean(pending)} onClick={() => void run('report', async () => {
              const result = await onReport(reportReason);
              setReportOpen(false);
              setNotice(result === 'already_reported' ? 'Você já denunciou esta publicação.' : 'Denúncia enviada à moderação.');
            })} className="min-h-10 rounded-lg bg-amber-600 px-3 text-xs font-bold text-slate-950 disabled:opacity-40">Enviar denúncia</button>
            <button type="button" onClick={() => setReportOpen(false)} className="min-h-10 rounded-lg border border-slate-700 px-3 text-xs text-slate-300">Cancelar</button>
          </div>
        </section>
      )}
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-800 pt-3">
        <button type="button" aria-label={isLiked ? 'Remover curtida' : 'Curtir publicação'}
          disabled={!canParticipate || Boolean(pending)}
          onClick={() => void run('like', () => onToggleLike(isLiked))}
          className={`flex min-h-11 items-center justify-center gap-1 rounded-xl border px-2 text-xs font-bold disabled:opacity-40 ${isLiked ? 'border-rose-500/40 bg-rose-500/10 text-rose-300' : 'border-slate-700 bg-slate-950 text-slate-300'}`}>
          <Heart className={`h-4 w-4 ${isLiked ? 'fill-current' : ''}`} /> {isLiked ? 'Curtido' : 'Curtir'} · {likes.filter(item => item.postId === post.id).length}
        </button>
        <button type="button" aria-expanded={commentsOpen} onClick={() => setCommentsOpen(open => !open)}
          className="flex min-h-11 items-center justify-center gap-1 rounded-xl border border-slate-700 bg-slate-950 px-2 text-xs font-bold text-slate-300">
          <MessageCircle className="h-4 w-4" /> Comentar · {postComments.length}
        </button>
        <button type="button" aria-label={saved ? 'Remover dos Salvos' : 'Salvar publicação'}
          disabled={Boolean(pending)}
          onClick={() => void run('save', onToggleSave)}
          className={`flex min-h-11 items-center justify-center gap-1 rounded-xl border px-2 text-xs font-bold disabled:opacity-40 ${saved ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-slate-700 bg-slate-950 text-slate-300'}`}>
          <Bookmark className={`h-4 w-4 ${saved ? 'fill-current' : ''}`} /> {saved ? 'Salvo' : 'Salvar'}
        </button>
      </div>
      {commentsOpen && (
        <section className="mt-3 space-y-3 rounded-xl border border-slate-800 bg-slate-950 p-3" aria-label="Comentários da publicação">
          {postComments.map(comment => (
            <div key={comment.id} className="rounded-xl bg-slate-900 p-3">
              <div className="flex items-start justify-between gap-2">
                <strong className="text-xs text-slate-200">{comment.authorName}</strong>
                {(comment.authorId === viewerId || communityOwnerId === viewerId) && (
                  <button type="button" aria-label="Excluir comentário" disabled={Boolean(pending)}
                    onClick={() => void run('delete-comment', () => onDeleteComment(comment.id))}
                    className="rounded-md p-1 text-red-300 disabled:opacity-40"><Trash2 className="h-4 w-4"/></button>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-300">{comment.text}</p>
              <span className="mt-1 block text-[11px] text-slate-500">{displayDate(comment.createdAt)}</span>
            </div>
          ))}
          {postComments.length === 0 && <p className="text-xs text-slate-400">Seja o primeiro a comentar.</p>}
          {canParticipate ? (
            <div className="flex flex-col gap-2">
              <textarea rows={2} maxLength={1000} value={commentDraft}
                onChange={event => setCommentDraft(event.target.value)}
                placeholder="Escreva um comentário..." aria-label="Escrever comentário"
                className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-white"/>
              <button type="button" disabled={Boolean(pending) || !commentDraft.trim()}
                onClick={() => void run('comment', async () => {
                  await onComment(commentDraft);
                  setCommentDraft('');
                })}
                className="min-h-10 self-end rounded-xl bg-sky-500 px-4 text-xs font-bold text-slate-950 disabled:opacity-40">Comentar</button>
            </div>
          ) : <p className="text-xs text-amber-300">Entre na comunidade para comentar.</p>}
        </section>
      )}
      {profile && (
        <div className="fixed inset-0 z-[190] flex items-center justify-center bg-slate-950/95 p-4" role="dialog" aria-modal="true" aria-label={`Perfil público de ${profile.name}`}>
          <section className="w-full max-w-sm rounded-3xl border border-slate-700 bg-slate-900 p-5">
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-bold uppercase text-sky-300">Perfil público</span>
              <button type="button" aria-label="Fechar perfil" onClick={() => setProfile(null)} className="rounded-lg border border-slate-700 p-2 text-white"><X className="h-4 w-4"/></button>
            </div>
            {profile.avatar ? <img src={profile.avatar} alt="" className="mt-4 h-20 w-20 rounded-full object-cover" referrerPolicy="no-referrer"/> : <UserRound className="mt-4 h-16 w-16 text-slate-400"/>}
            <h3 className="mt-3 text-lg font-bold text-white">{profile.name}</h3>
            <p className="text-sm text-sky-300">{profile.role}</p>
            <p className="mt-3 whitespace-pre-wrap text-sm text-slate-300">{profile.bio || 'Este Kairubido ainda não adicionou uma apresentação pública.'}</p>
          </section>
        </div>
      )}
      {metricsOpen && isMine && (
        <div className="fixed inset-0 z-[205] flex items-end justify-center bg-slate-950/95 p-0 backdrop-blur-md sm:items-center sm:p-4"
          role="dialog" aria-modal="true" aria-label="Métricas orgânicas da publicação">
          <section className="w-full max-w-md overflow-hidden rounded-t-3xl border border-slate-800 bg-slate-950 sm:rounded-3xl">
            <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-sky-300">Desempenho orgânico</span>
                <h3 className="text-base font-bold text-white">Métricas da publicação</h3>
              </div>
              <button type="button" aria-label="Fechar métricas" onClick={() => setMetricsOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 text-slate-300">
                <X className="h-5 w-5"/>
              </button>
            </header>
            <div className="grid grid-cols-2 gap-2 p-4">
              {([
                [Eye, 'Visualizações', organicCounts.views],
                [Heart, 'Curtidas', organicCounts.likes],
                [Bookmark, 'Salvamentos', organicCounts.saves],
                [Share2, 'Compartilhamentos', organicCounts.shares],
                [MessageCircle, 'Comentários', organicCounts.comments],
              ] as const).map(([MetricIcon, label, count]) => (
                <article key={label} className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
                  <MetricIcon className="h-5 w-5 text-sky-300"/>
                  <strong className="mt-2 block text-xl text-white">
                    {label !== 'Curtidas' && label !== 'Comentários' && (metricsError || metricsLoading) ? '—' : count}
                  </strong>
                  <span className="text-xs text-slate-400">{label}</span>
                </article>
              ))}
            </div>
            {metricsError && <p role="alert" className="mx-4 rounded-xl border border-rose-500/25 p-3 text-xs text-rose-300">{metricsError}</p>}
            <div className="border-t border-slate-800 p-4">
              <p className="text-xs leading-relaxed text-slate-400">
                Visualizações são únicas por usuário autenticado. Salvamentos contam apenas enquanto ativos
                e compartilhamentos somente após a ação concluída. Esses três indicadores começam na ativação
                da coleta; dados antigos não são reconstruídos.
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Campanhas do Kyrub Ads possuem resultados patrocinados separados das métricas orgânicas.
              </p>
              <button type="button" onClick={() => { setMetricsOpen(false); setPromotionPreviewOpen(true); }}
                className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-3 text-sm font-bold text-slate-950">
                <Megaphone className="h-4 w-4"/> Promover no Kyrub Ads
              </button>
            </div>
          </section>
        </div>
      )}
      {promotionPreviewOpen && isMine && (
        <KyrubAdsCommunityPromotionPreview post={post} onClose={() => setPromotionPreviewOpen(false)} />
      )}
      <ChatModal isOpen={chatOpen && connected} onClose={() => setChatOpen(false)}
        selectedChatUser={chatOpen && connected ? {
          id: post.authorId, name: post.authorName, avatar: post.authorAvatar,
          role: 'Kairubido', connectionStatus: 'accepted', connectionId: connection?.id,
        } : null}
        setSelectedChatUser={() => setChatOpen(false)}
        chatMessageText={chatDraft} setChatMessageText={setChatDraft}/>
    </article>
  );
}
