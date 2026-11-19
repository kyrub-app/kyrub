import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldAlert, Trash2, Flag, CheckCircle2 } from 'lucide-react';
import type { User } from 'firebase/auth';
import type { AdminProfile } from '../../utils/adminControlPlane';
import { MediaCarousel } from '../MediaCarousel';

interface ModerationPost {
  id: string; authorId: string; authorName: string; content: string;
  publicationType: 'feed' | 'status' | 'community'; visibility: string; communityId?: string; createdAtIso: string; mediaUrls: string[];
}
interface ModerationReview {
  id: string; storeId: string; authorId: string; authorName: string;
  content: string; rating: number; postId: string;
}
interface ModerationReport {
  id: string; kind: 'post' | 'community_post' | 'user' | 'review'; postId: string; targetUserId: string;
  reporterId: string; reason: string; createdAtIso: string; post: ModerationPost | null;
  storeId?: string; reviewId?: string; review?: ModerationReview | null;
}
const request = async (user: User, transport: string, init?: RequestInit) => {
  const token = await user.getIdToken();
  const response = await fetch(`/api/admin/operations/health?transport=${transport}`, {
    ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Operação administrativa não concluída.');
  return body;
};

export default function AdminSocialModerationWorkspace({ authenticatedUser, profile }: {
  authenticatedUser: User; profile: AdminProfile;
}) {
  const [posts, setPosts] = useState<ModerationPost[]>([]);
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const body = await request(authenticatedUser, 'social-moderation-list');
      setPosts(Array.isArray(body.posts) ? body.posts as ModerationPost[] : []);
      setReports(Array.isArray(body.reports) ? body.reports as ModerationReport[] : []);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Falha ao carregar moderação.');
    } finally { setBusy(false); }
  }, [authenticatedUser]);
  useEffect(() => { void load(); }, [load]);

  const remove = async (post: ModerationPost) => {
    const reason = window.prompt(`Motivo da remoção de “${post.content.slice(0,80) || post.id}”:`, '');
    if (!reason) return;
    if (!window.confirm('Remover a publicação e suas interações? As denúncias serão preservadas para auditoria.')) return;
    setBusy(true); setError('');
    try {
      await request(authenticatedUser, post.publicationType === 'community' ? 'social-moderation-community-remove' : 'social-moderation-remove', {
        method: 'POST', body: JSON.stringify({ postId: post.id, reason }),
      });
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível remover a publicação.');
    } finally { setBusy(false); }
  };

  const hideReview = async (report: ModerationReport) => {
    if (report.kind !== 'review' || !report.storeId || !report.reviewId || !report.review) return;
    const reason = window.prompt('Justificativa para ocultar esta avaliação da loja:', '');
    if (!reason) return;
    if (!window.confirm(report.review.postId
      ? 'Ocultar a avaliação também removerá a publicação vinculada na Praça e suas interações. Confirmar?'
      : 'Ocultar a avaliação desta loja? A decisão ficará registrada para auditoria.')) return;
    setBusy(true); setError('');
    try {
      await request(authenticatedUser, 'social-moderation-store-review-hide', {
        method: 'POST',
        body: JSON.stringify({ storeId: report.storeId, reviewId: report.reviewId, reason }),
      });
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível ocultar a avaliação.');
    } finally { setBusy(false); }
  };

  const dismiss = async (report: ModerationReport) => {
    const reason = window.prompt('Justificativa para encerrar esta denúncia sem remoção:', '');
    if (!reason) return;
    if (!window.confirm('Confirmar revisão desta denúncia? A decisão será auditada.')) return;
    setBusy(true); setError('');
    try {
      await request(authenticatedUser, 'social-moderation-report-review', {
        method: 'POST', body: JSON.stringify({ kind: report.kind, reportId: report.id, reason }),
      });
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível concluir a revisão.');
    } finally { setBusy(false); }
  };

  return (
    <section id="admin-social-moderation" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-xs font-black text-white">Moderação da Praça, Comunidades e lojas</h4>
          <p className="mt-1 text-[9px] text-slate-500">Denúncias, decisões humanas e remoções auditadas.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={busy} className="rounded-xl border border-slate-700 p-2 text-slate-300" aria-label="Atualizar moderação">
          <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {error && <div className="rounded-lg border border-red-500/20 p-3 text-xs text-red-300" role="alert">{error}</div>}
      <div className="space-y-2" aria-label="Denúncias pendentes">
        <h5 className="flex items-center gap-2 text-sm font-bold text-white"><Flag className="h-4 w-4 text-amber-400"/> Denúncias pendentes ({reports.length})</h5>
        {reports.map(report => (
          <article key={`${report.kind}:${report.id}`} className="rounded-xl border border-amber-500/20 bg-slate-950 p-3">
            <p className="text-xs font-semibold text-white">{report.kind === 'community_post' ? 'Publicação de comunidade denunciada' : report.kind === 'post' ? 'Publicação denunciada' : report.kind === 'review' ? 'Avaliação da loja denunciada' : 'Usuário denunciado'}</p>
            <p className="mt-1 break-all font-mono text-[10px] text-slate-400">Referência: {report.kind === 'review' ? `${report.storeId}/${report.reviewId}` : report.postId || report.targetUserId}</p>
            <p className="mt-1 text-xs text-slate-300">Motivo: {report.reason}</p>
            {report.post && <p className="mt-2 whitespace-pre-wrap text-xs text-slate-400">{report.post.content || '(sem texto)'}</p>}
            {report.kind === 'community_post' && report.post?.mediaUrls.length ? (
              <div className="mt-3"><MediaCarousel mediaUrls={report.post.mediaUrls} /></div>
            ) : null}
            {report.review && (
              <div className="mt-2 rounded-lg border border-slate-700 p-2 text-xs text-slate-300">
                <p className="font-semibold">{report.review.authorName} · {'★'.repeat(Math.max(0, Math.min(5, report.review.rating)))}</p>
                <p className="mt-1 whitespace-pre-wrap">{report.review.content}</p>
                <p className="mt-1 text-[10px] text-slate-500">{report.review.postId ? 'Também compartilhada na Praça' : 'Somente na loja'}</p>
              </div>
            )}
            {report.kind === 'review' && !report.review && (
              <p className="mt-1 text-xs text-amber-300">Avaliação não encontrada. Preservar a denúncia para análise.</p>
            )}
            {(report.kind === 'post' || report.kind === 'community_post') && !report.post && <p className="mt-1 text-xs text-amber-300">Publicação indisponível. Preservar a denúncia para análise.</p>}
            <p className="mt-1 font-mono text-[9px] text-slate-500">{report.createdAtIso || 'Data indisponível'} · Denunciante {report.reporterId}</p>
            <div className="mt-3 flex gap-2">
              {(report.kind === 'post' || report.kind === 'community_post') && report.post && (
                <button type="button" disabled={busy} onClick={() => void remove(report.post!)} className="flex items-center gap-1 rounded-lg border border-red-500/30 px-2 py-1 text-xs text-red-300">
                  <Trash2 className="h-3 w-3"/> Remover publicação
                </button>
              )}
              {report.kind === 'review' && report.review && (
                <button type="button" disabled={busy} onClick={() => void hideReview(report)}
                  className="flex items-center gap-1 rounded-lg border border-amber-500/30 px-2 py-1 text-xs text-amber-200">
                  <Trash2 className="h-3 w-3" /> Ocultar avaliação
                </button>
              )}
              <button type="button" disabled={busy} onClick={() => void dismiss(report)} className="flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-200">
                <CheckCircle2 className="h-3 w-3"/> Encerrar com justificativa
              </button>
            </div>
          </article>
        ))}
        {!busy && reports.length === 0 && <p className="text-xs text-slate-500">Nenhuma denúncia pendente encontrada.</p>}
      </div>
      <div className="space-y-2" aria-label="Publicações recentes para moderação">
        <h5 className="text-sm font-bold text-white">Publicações recentes</h5>
        {posts.map(post => (
          <article key={post.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950 p-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1 text-xs font-bold text-white"><ShieldAlert className="h-3 w-3 text-amber-400"/>{post.authorName}</p>
              <p className="mt-2 whitespace-pre-wrap text-xs text-slate-300">{post.content || '(sem texto)'}</p>
              <p className="mt-1 truncate font-mono text-[9px] text-slate-500">{post.id} · {post.createdAtIso || 'data indisponível'}</p>
            </div>
            <button type="button" disabled={busy} onClick={() => void remove(post)} aria-label={`Remover publicação de ${post.authorName}`} className="shrink-0 rounded-lg border border-red-500/20 p-2 text-red-300"><Trash2 className="h-4 w-4"/></button>
          </article>
        ))}
      </div>
      <p className="text-[9px] text-slate-500">Acesso: {profile.role}. Máximo de 100 denúncias pendentes de cada tipo (Praça, Comunidades, usuários e avaliações) e 100 publicações recentes. Denúncias não aplicam punições automáticas.</p>
    </section>
  );
}
