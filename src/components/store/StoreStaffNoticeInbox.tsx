import { useCallback, useEffect, useState } from 'react';
import type { StaffNoticeForViewer } from '../../../shared/staffNotices';
import { confirmStaffNoticeRead, listStaffNotices } from '../../utils/staffNotices';

export function StoreStaffNoticeInbox({ storeId }: { storeId: string }) {
  const [notices, setNotices] = useState<StaffNoticeForViewer[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const refresh = useCallback(async () => {
    try {
      const result = await listStaffNotices(storeId);
      setNotices(result);
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível carregar os avisos.');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  const confirm = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    setError('');
    try {
      const readAt = await confirmStaffNoticeRead(storeId, id);
      setNotices(items => items.map(item => item.id === id ? { ...item, readAt } : item));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível confirmar leitura.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <section aria-label="Avisos da equipe" data-kyrub-staff-notices-inbox
      className="mx-auto max-w-md space-y-3">
      <header className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
        <h3 className="text-sm font-black text-white">Avisos da equipe</h3>
        <p className="mt-1 text-xs text-slate-400">Comunicados desta loja destinados à sua função.</p>
        <button type="button" onClick={() => void refresh()} className="mt-2 text-xs font-bold text-orange-300">Atualizar avisos</button>
      </header>
      {loading && <p className="text-xs text-slate-400">Carregando...</p>}
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {!loading && notices.length === 0 && <p className="text-sm text-slate-400">Nenhum comunicado disponível.</p>}
      {notices.map(notice => (
        <article key={notice.id} className="rounded-2xl border border-slate-700 bg-slate-900 p-4 text-white">
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-sm font-black">{notice.title}</h4>
            {notice.readAt ? <span className="text-xs text-emerald-300">Lido</span> : <span className="text-xs text-orange-300">Novo</span>}
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{notice.body}</p>
          <p className="mt-3 text-xs text-slate-400">{new Date(notice.createdAt).toLocaleString('pt-BR')}</p>
          {!notice.readAt && (
            <button type="button" disabled={Boolean(busyId)} onClick={() => void confirm(notice.id)}
              className="mt-3 min-h-10 w-full rounded-xl border border-orange-400/40 bg-orange-500/15 p-2 text-xs font-bold text-orange-300 disabled:opacity-50">
              {busyId === notice.id ? 'Confirmando...' : 'Confirmar leitura'}
            </button>
          )}
        </article>
      ))}
    </section>
  );
}
