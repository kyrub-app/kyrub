import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { AlertTriangle, ArrowDownRight, CircleAlert, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  loadStoreChannelOperationalQueue,
  type StoreChannelOperationalItem,
} from '../../utils/storeChannelOperations';

const labels: Record<StoreChannelOperationalItem['kind'], string> = {
  mercado_livre_sync_review: 'Revisão manual',
  mercado_livre_conflict: 'Conflito',
  '99food_insufficient_atp': 'ATP insuficiente',
  '99food_binding_unresolved': 'Binding não resolvido',
};

const openChannel = (target: StoreChannelOperationalItem['actionTarget']): void => {
  const element = target === 'mercado_livre'
    ? document.getElementById('kyrub-mercado-livre-channel-detail')
    : document.getElementById('kyrub-99food-channel-detail')
      ?? document.querySelector<HTMLElement>('[data-integration-id="99food"]');
  element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

export default function StoreChannelOperationsQueue({ user, storeId }: { user: User; storeId: string }) {
  const [items, setItems] = useState<StoreChannelOperationalItem[]>([]);
  const [sourceErrors, setSourceErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const criticalCount = useMemo(() => items.filter(item => item.severity === 'critical').length, [items]);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const result = await loadStoreChannelOperationalQueue(user, storeId);
      setItems(result.items);
      setSourceErrors(result.sourceErrors);
    } finally {
      setLoaded(true);
      setLoading(false);
    }
  }, [storeId, user]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <section className="rounded-3xl border border-amber-500/20 bg-amber-500/[0.035] p-5" aria-label="Pendências dos canais">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-300">Operação omnichannel</span>
          <h3 className="mt-1 flex items-center gap-2 text-lg font-black text-white"><AlertTriangle className="h-5 w-5" /> Pendências dos canais</h3>
          <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-slate-400">
            Reúne estados autoritativos que precisam de atenção. Esta fila apenas lê e encaminha para o módulo correto do canal.
          </p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-300 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3"><span className="block text-[9px] font-black uppercase text-slate-500">Pendências</span><strong className="mt-1 block text-lg text-amber-300">{items.length}</strong></div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3"><span className="block text-[9px] font-black uppercase text-slate-500">Bloqueios/conflitos</span><strong className="mt-1 block text-lg text-rose-300">{criticalCount}</strong></div>
      </div>

      {sourceErrors.length > 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3 text-[10px] text-amber-100">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>A visão está parcial porque {sourceErrors.length} fonte(s) não responderam. Os itens exibidos continuam válidos.</span>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {!loaded || (loading && items.length === 0) ? (
          <p className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4 text-[10px] text-slate-500">Consultando filas autoritativas dos canais…</p>
        ) : items.length === 0 && sourceErrors.length === 0 ? (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-emerald-300">
            <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /><strong className="text-xs">Nenhuma pendência encontrada.</strong></div>
          </div>
        ) : items.map(item => (
          <article key={item.id} className={`rounded-2xl border p-4 ${item.severity === 'critical' ? 'border-rose-500/20 bg-rose-500/[0.045]' : 'border-amber-500/20 bg-amber-500/[0.035]'}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><span className="text-[9px] font-black uppercase text-slate-500">{item.provider === 'mercado_livre' ? 'Mercado Livre' : '99Food'}</span><span className="rounded-full border border-slate-700 px-2 py-0.5 text-[8px] font-black uppercase text-slate-300">{labels[item.kind]}</span></div>
                <strong className="mt-2 block text-xs text-white">{item.title}</strong>
                <p className="mt-1 text-[10px] leading-relaxed text-slate-400">{item.detail}</p>
                <p className="mt-2 break-all text-[9px] text-slate-600">Ref. {item.reference}</p>
              </div>
              <button type="button" onClick={() => openChannel(item.actionTarget)}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-cyan-300">
                <ArrowDownRight className="h-3.5 w-3.5" /> Abrir canal
              </button>
            </div>
          </article>
        ))}
      </div>

      <p className="mt-4 text-[10px] leading-relaxed text-slate-600">
        A fila não altera produtos, estoque, reservas, decisões de revisão ou estado de provedor. A ação permanece no módulo específico do canal.
      </p>
    </section>
  );
}
