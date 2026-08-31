import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { FileCheck2, Link2, RefreshCw } from 'lucide-react';
import {
  createCanonicalKyrubProductFromMercadoLivreDraft,
  loadMercadoLivreImportDraftsForPreparation,
  prepareMercadoLivreImportAsKyrubCatalogDraft,
  type MercadoLivreImportDraftPreparationItem,
} from '../../utils/storeConnections';

const money = (value: number | null): string =>
  value === null
    ? 'Preço pendente'
    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

type ResolveForm = { category: string; stock: string; price: string };

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
  const [finalizingId, setFinalizingId] = useState('');
  const [forms, setForms] = useState<Record<string, ResolveForm>>({});
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
        'Rascunho Kyrub preparado. Agora confirme categoria e estoque antes de criar o produto canônico.',
        'success'
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível preparar o rascunho Kyrub.');
    } finally {
      setPreparingId('');
    }
  };

  const updateForm = (draftId: string, patch: Partial<ResolveForm>): void => {
    setForms(current => ({
      ...current,
      [draftId]: {
        category: current[draftId]?.category ?? '',
        stock: current[draftId]?.stock ?? '',
        price: current[draftId]?.price ?? '',
        ...patch,
      },
    }));
  };

  const finalize = async (item: MercadoLivreImportDraftPreparationItem): Promise<void> => {
    const form = forms[item.draft.id] ?? { category: '', stock: '', price: '' };
    const category = form.category.trim();
    const stock = Number(form.stock);
    const needsPrice = item.draft.price === null;
    const price = needsPrice ? Number(form.price) : undefined;

    if (!category) {
      setError('Informe a categoria Kyrub antes de criar o produto.');
      return;
    }
    if (!Number.isSafeInteger(stock) || stock < 0) {
      setError('Informe um estoque Kyrub inteiro e não negativo.');
      return;
    }
    if (needsPrice && (!Number.isFinite(price) || Number(price) < 0)) {
      setError('Informe um preço válido antes de criar o produto.');
      return;
    }

    setFinalizingId(item.draft.id);
    setError('');
    try {
      const result = await createCanonicalKyrubProductFromMercadoLivreDraft(
        user,
        storeId,
        item.draft.id,
        {
          category,
          stock,
          ...(needsPrice ? { price } : {}),
        }
      );
      setItems(current => current.map(entry => entry.draft.id === item.draft.id
        ? {
            ...entry,
            preparation: {
              status: 'bound',
              kyrubDraftId: entry.preparation.kyrubDraftId,
              canonicalProductId: result.canonicalProductId,
            },
          }
        : entry));
      notify(
        'Produto Kyrub criado em rascunho e vinculado ao anúncio do Mercado Livre. Nada foi publicado automaticamente.',
        'success'
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível criar o produto Kyrub.');
    } finally {
      setFinalizingId('');
    }
  };

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">Entrada no catálogo</span>
          <h4 className="mt-1 text-sm font-black text-white">Rascunhos importados do Mercado Livre</h4>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-500">
            O título, preço e imagem podem vir do anúncio importado. Categoria e estoque Kyrub só nascem após sua confirmação explícita.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || Boolean(preparingId) || Boolean(finalizingId)}
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
            const bound = item.preparation.status === 'bound';
            const stale = item.preparation.status === 'stale';
            const form = forms[item.draft.id] ?? { category: '', stock: '', price: '' };
            return (
              <div key={item.draft.id} className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-black text-white">{item.draft.title}</p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {money(item.draft.price)} · ML {item.draft.provenance.externalId}
                    </p>
                    <p className="mt-1 text-[9px] text-slate-600">
                      Categoria ML: {item.draft.categoryId || 'não informada'} · disponível no ML: {item.draft.sourceAvailableQuantity ?? 'não informado'}
                    </p>
                    {bound ? (
                      <p className="mt-2 inline-flex items-center gap-1.5 text-[9px] font-bold text-emerald-300">
                        <Link2 className="h-3.5 w-3.5" /> Vinculado ao produto Kyrub {item.preparation.canonicalProductId}
                      </p>
                    ) : stale ? (
                      <p className="mt-2 text-[9px] leading-relaxed text-amber-300/80">
                        O anúncio mudou depois da preparação. Prepare novamente antes de criar o produto Kyrub.
                      </p>
                    ) : prepared ? (
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <label className="text-[9px] font-bold text-slate-400">
                          Categoria Kyrub
                          <input
                            value={form.category}
                            onChange={event => updateForm(item.draft.id, { category: event.target.value })}
                            placeholder="Ex.: Burgers artesanais"
                            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[10px] text-white outline-none focus:border-yellow-500"
                          />
                        </label>
                        <label className="text-[9px] font-bold text-slate-400">
                          Estoque inicial Kyrub
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={form.stock}
                            onChange={event => updateForm(item.draft.id, { stock: event.target.value })}
                            placeholder="0"
                            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[10px] text-white outline-none focus:border-yellow-500"
                          />
                        </label>
                        {item.draft.price === null ? (
                          <label className="text-[9px] font-bold text-slate-400">
                            Preço Kyrub
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={form.price}
                              onChange={event => updateForm(item.draft.id, { price: event.target.value })}
                              placeholder="0,00"
                              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[10px] text-white outline-none focus:border-yellow-500"
                            />
                          </label>
                        ) : (
                          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-[9px] text-slate-500">
                            Preço confirmado pela API do ML: <span className="font-bold text-slate-300">{money(item.draft.price)}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="mt-2 text-[9px] leading-relaxed text-amber-300/80">
                        Antes de virar produto Kyrub: confirmar categoria e estoque{item.draft.price === null ? ', além do preço' : ''}.
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col gap-2">
                    {!prepared && !bound && (
                      <button
                        type="button"
                        onClick={() => void prepare(item)}
                        disabled={Boolean(preparingId) || Boolean(finalizingId)}
                        className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-emerald-300 disabled:opacity-50"
                      >
                        <FileCheck2 className="h-3.5 w-3.5" />
                        {preparingId === item.draft.id ? 'Preparando…' : stale ? 'Preparar novamente' : 'Preparar rascunho Kyrub'}
                      </button>
                    )}
                    {prepared && (
                      <button
                        type="button"
                        onClick={() => void finalize(item)}
                        disabled={Boolean(preparingId) || Boolean(finalizingId)}
                        className="inline-flex items-center gap-2 rounded-xl bg-yellow-400 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-slate-950 disabled:opacity-50"
                      >
                        <Link2 className="h-3.5 w-3.5" />
                        {finalizingId === item.draft.id ? 'Criando…' : 'Criar produto Kyrub em rascunho'}
                      </button>
                    )}
                  </div>
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
