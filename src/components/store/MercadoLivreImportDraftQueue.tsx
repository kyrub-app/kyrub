import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { FileCheck2, RefreshCw } from 'lucide-react';
import {
  loadMercadoLivreImportDraftsForPreparation,
  prepareMercadoLivreImportAsKyrubCatalogDraft,
  type MercadoLivreImportDraftPreparationItem,
} from '../../utils/storeConnections';

const money = (value: number | null): string =>
  value === null
    ? 'Preço pendente'
    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

export default function MercadoLivreImportDraftQueue({
  user,
  storeId,
  refreshKey,
  notify,
}: {
  user: User;
  storeId: string;
  refreshKey?: number;
  notify: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [items, setItems] = useState<MercadoLivreImportDraftPreparationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [preparingId, setPreparingId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const result = await loadMercadoLivreImportDraftsForPreparation(user, storeId, 50);
      setItems(result.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os rascunhos importados.');
    } finally {
      setLoading(false);
    }
  }, [storeId, user]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const prepare = async (item: MercadoLivreImportDraftPreparationItem): Promise<void> => {
    setPreparingId(item.draft.id);
    setError('');
    try {
      const result = await prepareMercadoLivreImportAsKyrubCatalogDraft(user, storeId, item.draft.id);
      setItems(current => current.map(entry => entry.draft.id === item.draft.id
        ? {
            ...entry,
            preparation: { status: 'prepared', kyrubDraftId: result.kyrubDraftId },
          }
        : entry));
      notify(
        'Rascunho Kyrub preparado. Categoria e estoque continuam pendentes e nenhum produto foi publicado.',
        'success'
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível preparar o rascunho Kyrub.');
    } finally {
      setPreparingId('');
    }
  };

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">Entrada no catálogo</span>
          <h4 className="mt-1 text-sm font-black text-white">Rascunhos importados do Mercado Livre</h4>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-500">
            O título, preço e imagem podem vir do anúncio importado. A categoria do Mercado Livre e a quantidade disponível não viram categoria ou estoque Kyrub automaticamente.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || Boolean(preparingId)}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-slate-300 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </div>

      {loading && items.length === 0 ? (
        <p className="mt-4 text-[10px] text-slate-500">Consultando rascunhos importados…</p>
      ) : items.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-[10px] text-slate-500">
          Nenhum produto do Mercado Livre foi importado como rascunho ainda.
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          {items.map(item => {
            const prepared = item.preparation.status === 'prepared';
            return (
              <div key={item.draft.id} className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-black text-white">{item.draft.title}</p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {money(item.draft.price)} · ML {item.draft.provenance.externalId}
                    </p>
                    <p className="mt-1 text-[9px] text-slate-600">
                      Categoria ML: {item.draft.categoryId || 'não informada'} · disponível no ML: {item.draft.sourceAvailableQuantity ?? 'não informado'}
                    </p>
                    <p className="mt-2 text-[9px] leading-relaxed text-amber-300/80">
                      Antes de virar produto Kyrub: confirmar categoria e estoque{item.draft.price === null ? ', além do preço' : ''}.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void prepare(item)}
                    disabled={Boolean(preparingId) || prepared}
                    className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-emerald-300 disabled:opacity-50"
                  >
                    <FileCheck2 className="h-3.5 w-3.5" />
                    {prepared ? 'Rascunho preparado' : preparingId === item.draft.id ? 'Preparando…' : 'Preparar rascunho Kyrub'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-3 text-[10px] text-rose-200" aria-live="polite">
          {error}
        </div>
      )}
    </div>
  );
}
