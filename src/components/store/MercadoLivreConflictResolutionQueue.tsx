import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import {
  loadMercadoLivreConflictResolutionQueue,
  resolveMercadoLivreBoundProductConflict,
  type MercadoLivreConflictResolutionItem,
} from '../../utils/storeConnections';

type Choice = 'kyrub' | 'mercado_livre';
type ChoiceState = Partial<Record<'name' | 'price', Choice>>;

const money = (value: number | null): string =>
  value === null
    ? 'Preço não informado'
    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const label = (field: string): string => ({
  name: 'nome',
  price: 'preço',
  stock: 'estoque',
  category: 'categoria',
  image: 'imagem',
}[field] ?? field);

export default function MercadoLivreConflictResolutionQueue({
  user,
  storeId,
  notify,
}: {
  user: User;
  storeId: string;
  notify: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [items, setItems] = useState<MercadoLivreConflictResolutionItem[]>([]);
  const [choices, setChoices] = useState<Record<string, ChoiceState>>({});
  const [loading, setLoading] = useState(false);
  const [resolvingId, setResolvingId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const result = await loadMercadoLivreConflictResolutionQueue(user, storeId, 50);
      setItems(result.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os conflitos de sincronização.');
    } finally {
      setLoading(false);
    }
  }, [storeId, user]);

  useEffect(() => {
    void load();
  }, [load]);

  const choose = (proposalId: string, field: 'name' | 'price', value: Choice): void => {
    setChoices(current => ({
      ...current,
      [proposalId]: { ...(current[proposalId] ?? {}), [field]: value },
    }));
  };

  const resolve = async (item: MercadoLivreConflictResolutionItem): Promise<void> => {
    if (item.baselineStatus !== 'conflict') {
      setError('O histórico detalhado deste baseline não está disponível; a resolução automática permanece bloqueada.');
      return;
    }
    const selected = choices[item.proposalId] ?? {};
    const missing = item.resolvableFields.filter(field => !selected[field]);
    if (missing.length) {
      setError(`Escolha Kyrub ou Mercado Livre para: ${missing.map(label).join(', ')}.`);
      return;
    }
    setResolvingId(item.proposalId);
    setError('');
    try {
      await resolveMercadoLivreBoundProductConflict(user, storeId, item.proposalId, selected);
      setItems(current => current.filter(entry => entry.proposalId !== item.proposalId));
      notify('Conflito resolvido campo a campo. Estoque, categoria, imagem e publicação permaneceram sob autoridade Kyrub.', 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível resolver o conflito.');
    } finally {
      setResolvingId('');
    }
  };

  if (!loading && items.length === 0) return null;

  return (
    <div className="rounded-3xl border border-rose-500/20 bg-rose-500/5 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="text-[9px] font-black uppercase tracking-wider text-rose-300">Conflitos de sincronização</span>
          <h4 className="mt-1 text-sm font-black text-white">Escolher qual versão prevalece</h4>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-500">
            O Kyrub mostra o baseline anterior, o valor atual do produto e o snapshot aprovado do Mercado Livre. Nome e preço podem ser escolhidos campo a campo. Estoque, categoria, imagem e publicação nunca são puxados do Mercado Livre neste corte.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || Boolean(resolvingId)}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-slate-300 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar conflitos
        </button>
      </div>

      <div className="mt-4 grid gap-3">
        {items.map(item => {
          const unavailable = item.baselineStatus === 'baseline_unavailable';
          const selected = choices[item.proposalId] ?? {};
          return (
            <div key={item.proposalId} className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black text-white">Produto {item.canonicalProductId}</p>
                  {unavailable ? (
                    <p className="mt-2 text-[10px] leading-relaxed text-amber-300">
                      O hash confirma que houve divergência, mas este binding é anterior ao snapshot detalhado de baseline. A resolução permanece bloqueada para não reconstruir o passado por inferência.
                    </p>
                  ) : (
                    <>
                      <p className="mt-2 text-[9px] text-slate-500">
                        Alterações locais desde o baseline: {item.localChangedFields.length ? item.localChangedFields.map(label).join(', ') : 'nenhuma identificada'}.
                        {' '}Alterações vindas do ML: {item.incomingChangedFields.length ? item.incomingChangedFields.map(label).join(', ') : 'nenhuma'}.
                      </p>

                      {item.resolvableFields.includes('name') && (
                        <div className="mt-3 rounded-xl border border-slate-800 p-3">
                          <p className="text-[9px] font-black uppercase text-slate-500">Nome</p>
                          <p className="mt-1 text-[9px] text-slate-600">Baseline: {item.baseline?.name}</p>
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            <button type="button" onClick={() => choose(item.proposalId, 'name', 'kyrub')}
                              className={`rounded-xl border p-3 text-left text-[10px] ${selected.name === 'kyrub' ? 'border-yellow-400 text-yellow-300' : 'border-slate-800 text-slate-300'}`}>
                              <span className="block text-[9px] font-black uppercase">Manter Kyrub</span>{item.current.name}
                            </button>
                            <button type="button" onClick={() => choose(item.proposalId, 'name', 'mercado_livre')}
                              className={`rounded-xl border p-3 text-left text-[10px] ${selected.name === 'mercado_livre' ? 'border-emerald-400 text-emerald-300' : 'border-slate-800 text-slate-300'}`}>
                              <span className="block text-[9px] font-black uppercase">Usar Mercado Livre</span>{item.incoming.name}
                            </button>
                          </div>
                        </div>
                      )}

                      {item.resolvableFields.includes('price') && (
                        <div className="mt-3 rounded-xl border border-slate-800 p-3">
                          <p className="text-[9px] font-black uppercase text-slate-500">Preço</p>
                          <p className="mt-1 text-[9px] text-slate-600">Baseline: {money(item.baseline?.price ?? null)}</p>
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            <button type="button" onClick={() => choose(item.proposalId, 'price', 'kyrub')}
                              className={`rounded-xl border p-3 text-left text-[10px] ${selected.price === 'kyrub' ? 'border-yellow-400 text-yellow-300' : 'border-slate-800 text-slate-300'}`}>
                              <span className="block text-[9px] font-black uppercase">Manter Kyrub</span>{money(item.current.price)}
                            </button>
                            <button type="button" onClick={() => choose(item.proposalId, 'price', 'mercado_livre')}
                              className={`rounded-xl border p-3 text-left text-[10px] ${selected.price === 'mercado_livre' ? 'border-emerald-400 text-emerald-300' : 'border-slate-800 text-slate-300'}`}>
                              <span className="block text-[9px] font-black uppercase">Usar Mercado Livre</span>{money(item.incoming.price)}
                            </button>
                          </div>
                        </div>
                      )}

                      <p className="mt-3 text-[9px] leading-relaxed text-slate-600">
                        Campos protegidos mantidos do Kyrub: estoque {item.current.stock}, categoria “{item.current.category}” e imagem atual. Publication status não é alterado.
                      </p>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void resolve(item)}
                  disabled={unavailable || Boolean(resolvingId)}
                  className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-yellow-400 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-slate-950 disabled:opacity-40"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {resolvingId === item.proposalId ? 'Resolvendo…' : unavailable ? 'Baseline indisponível' : 'Confirmar resolução'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="mt-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-3 text-[10px] text-rose-200" aria-live="polite">
          {error}
        </div>
      )}
    </div>
  );
}
