import { useCallback, useEffect, useState } from 'react';
import { BookOpenCheck, Download, RefreshCw } from 'lucide-react';
import type { StaffProcedureView } from '../../../shared/staffProcedures';
import {
  confirmStaffProcedureRead,
  downloadStaffProcedureFile,
  listStaffProcedures,
} from '../../utils/staffProcedures';

export function StoreStaffPopInbox({ storeId }: { storeId: string }) {
  const [items, setItems] = useState<StaffProcedureView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const refresh = useCallback(async () => {
    try {
      setItems(await listStaffProcedures(storeId));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar os manuais.');
    } finally {
      setLoading(false);
    }
  }, [storeId]);
  useEffect(() => {setLoading(true); void refresh();}, [refresh]);

  const confirm = async (procedure: StaffProcedureView) => {
    if (busyId) return;
    setBusyId(procedure.id);
    setError('');
    try {
      const readAt = await confirmStaffProcedureRead(
        storeId, procedure.id, procedure.currentVersion
      );
      setItems(old => old.map(item => item.id === procedure.id &&
        item.currentVersion === procedure.currentVersion ? { ...item, readAt } : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao confirmar leitura.');
      await refresh();
    } finally {
      setBusyId('');
    }
  };

  const download = async (pop: StaffProcedureView) => {
    if (!pop.revision.attachment) return;
    setError('');
    try {
      await downloadStaffProcedureFile(
        storeId, pop.id, pop.currentVersion, pop.revision.attachment.name
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao baixar o anexo.');
    }
  };

  return (
    <section aria-label="Manuais POP da equipe" data-kyrub-staff-pops-inbox
      className="mx-auto max-w-md space-y-3">
      <header className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
        <h3 className="flex items-center gap-2 text-sm font-black text-white">
          <BookOpenCheck className="h-5 w-5 text-orange-300" /> Manuais POP
        </h3>
        <p className="mt-1 text-xs text-slate-400">Procedimentos vigentes para sua função. Cada nova versão exige confirmação própria.</p>
        <button type="button" onClick={() => void refresh()}
          className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-orange-300">
          <RefreshCw className="h-4 w-4" /> Atualizar manuais
        </button>
      </header>
      {loading && <p className="text-xs text-slate-400">Carregando procedimentos...</p>}
      {error && <p role="alert" className="rounded-xl border border-red-500/30 p-3 text-xs text-red-300">{error}</p>}
      {!loading && !items.length && <p className="text-xs text-slate-400">Nenhum manual disponível para sua função nesta loja.</p>}
      {items.map(pop => (
        <article key={pop.id} className="space-y-3 rounded-2xl border border-slate-700 bg-slate-900 p-4 text-white">
          <div className="flex items-start justify-between gap-3">
            <h4 className="text-sm font-black">{pop.title}</h4>
            <div className="shrink-0 text-right text-xs">
              <span className="block text-slate-400">Versão {pop.currentVersion}</span>
              <span className={pop.readAt ? 'text-emerald-300' : 'text-orange-300'}>
                {pop.readAt ? 'Lido' : 'Pendente'}
              </span>
            </div>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{pop.revision.body}</p>
          <p className="text-xs text-slate-400">
            Publicado em {new Date(pop.publishedAt).toLocaleString('pt-BR')}
          </p>
          {pop.revision.attachment && (
            <button type="button" onClick={() => void download(pop)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-600 p-3 text-xs font-bold text-orange-300">
              <Download className="h-4 w-4" /> Baixar {pop.revision.attachment.name}
            </button>
          )}
          {!pop.readAt ? (
            <button type="button" disabled={Boolean(busyId)}
              onClick={() => void confirm(pop)}
              className="w-full min-h-11 rounded-xl bg-orange-500/15 p-3 text-xs font-bold text-orange-300 disabled:opacity-50">
              {busyId === pop.id ? 'Confirmando...' : 'Confirmar leitura desta versão'}
            </button>
          ) : (
            <p className="text-xs text-emerald-300">Leitura confirmada em {new Date(pop.readAt).toLocaleString('pt-BR')}</p>
          )}
        </article>
      ))}
    </section>
  );
}
