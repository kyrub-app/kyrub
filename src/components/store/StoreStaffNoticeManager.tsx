import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Send } from 'lucide-react';
import type { StaffNoticeForViewer, StaffNoticeAudienceRole } from '../../../shared/staffNotices';
import { listStaffNotices, publishStaffNotice } from '../../utils/staffNotices';

export function StoreStaffNoticeManager({
  storeId, onBack,
}: { storeId: string; onBack: () => void }) {
  const [notices, setNotices] = useState<StaffNoticeForViewer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [noticeTitle, setNoticeTitle] = useState('');
  const [noticeBody, setNoticeBody] = useState('');
  const [audience, setAudience] = useState<'all' | StaffNoticeAudienceRole>('all');
  const requestIdRef = useRef('');
  const refresh = useCallback(async () => {
    try {
      const rows = await listStaffNotices(storeId);
      setNotices(rows);
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Falha ao consultar avisos.');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  const publish = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    if (!requestIdRef.current) requestIdRef.current = crypto.randomUUID();
    try {
      await publishStaffNotice({
        storeId,
        requestId: requestIdRef.current,
        title: noticeTitle,
        body: noticeBody,
        audienceRoles: audience === 'all' ? [] : [audience],
      });
      requestIdRef.current = '';
      setNoticeTitle('');
      setNoticeBody('');
      setAudience('all');
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Falha ao publicar aviso.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-kyrub-staff-notices-manager className="space-y-5 text-slate-100">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm font-bold text-orange-300">
        <ArrowLeft className="h-4 w-4" /> Central do Staff
      </button>
      <header>
        <h2 className="text-lg font-black">Avisos e comunicados</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          Publique recados internos. A equipe recebe um aviso no sininho e pode confirmar leitura na Central do Colaborador.
        </p>
      </header>
      <form onSubmit={event => void publish(event)} className="space-y-3 rounded-2xl border border-slate-700 bg-slate-950/70 p-4">
        <label className="block text-xs font-bold" htmlFor="staff-notice-title">Título</label>
        <input id="staff-notice-title" value={noticeTitle} maxLength={120} required
          onChange={event => { setNoticeTitle(event.target.value); requestIdRef.current = ''; }}
          className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-white" />
        <label className="block text-xs font-bold" htmlFor="staff-notice-body">Comunicado</label>
        <textarea id="staff-notice-body" value={noticeBody} required maxLength={2500} rows={5}
          onChange={event => { setNoticeBody(event.target.value); requestIdRef.current = ''; }}
          className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-white" />
        <label className="block text-xs font-bold" htmlFor="staff-notice-audience">Destinatários</label>
        <select id="staff-notice-audience" value={audience}
          onChange={event => { setAudience(event.target.value as typeof audience); requestIdRef.current = ''; }}
          className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-white">
          <option value="all">Toda a equipe ativa</option>
          <option value="manager">Gerentes</option>
          <option value="cashier">Caixa</option>
          <option value="seller">Vendedores</option>
          <option value="production">Produção</option>
        </select>
        <button disabled={busy || !noticeTitle.trim() || !noticeBody.trim()}
          type="submit"
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-xs font-black text-slate-950 disabled:opacity-50">
          <Send className="h-4 w-4" />
          {busy ? 'Publicando...' : 'Publicar comunicado'}
        </button>
        <p className="text-xs text-slate-400">A publicação é registrada no servidor e não pode ser editada nesta primeira versão.</p>
      </form>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <div aria-live="polite" className="space-y-3">
        <h3 className="text-sm font-black">Comunicados publicados</h3>
        {loading && <p className="text-xs text-slate-400">Carregando avisos...</p>}
        {!loading && notices.length === 0 && <p className="text-xs text-slate-400">Nenhum comunicado publicado nesta loja.</p>}
        {notices.map(notice => (
          <article key={notice.id} className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
            <h4 className="font-bold">{notice.title}</h4>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{notice.body}</p>
            <p className="mt-3 text-xs text-slate-400">
              {notice.audienceRoles.length === 0 ? 'Toda a equipe' : notice.audienceRoles.join(', ')}
              {' · '}{new Date(notice.createdAt).toLocaleString('pt-BR')}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
