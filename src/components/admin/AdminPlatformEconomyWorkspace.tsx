import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CircleAlert,
  Landmark,
  RefreshCw,
  RotateCcw,
  Store,
} from 'lucide-react';
import type { AdminPlatformEconomySnapshot } from '../../../shared/adminPlatformEconomy';
import { loadAdminPlatformEconomy } from '../../utils/adminPlatformEconomy';

const money = (minor: number): string =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(minor / 100);

const when = (value: string): string => {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
};

export default function AdminPlatformEconomyWorkspace({
  authenticatedUser,
}: {
  authenticatedUser: User;
}) {
  const [snapshot, setSnapshot] = useState<AdminPlatformEconomySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSnapshot(await loadAdminPlatformEconomy(authenticatedUser));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Não foi possível consultar a economia da plataforma.'
      );
    } finally {
      setLoading(false);
    }
  }, [authenticatedUser]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section
      id="admin-platform-economy-workspace"
      className="rounded-[2rem] border border-slate-800 bg-slate-900/65 p-5 sm:p-6"
      aria-labelledby="admin-platform-economy-title"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-emerald-500/10 p-3 text-emerald-300">
            <Landmark className="h-5 w-5" />
          </div>
          <div>
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-emerald-400">
              Platform Economy
            </span>
            <h2 id="admin-platform-economy-title" className="mt-1 text-lg font-black text-white">
              Economia canônica da plataforma
            </h2>
            <p className="mt-1 max-w-3xl text-[10px] leading-relaxed text-slate-500">
              Projeção somente leitura do ledger econômico bruto. Não representa saldo disponível, receita líquida, taxas, impostos ou settlement.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-400 hover:text-white disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {error && (
        <div className="mt-4 flex gap-3 rounded-2xl border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-200" role="alert">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!snapshot && loading ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map(item => (
            <div key={item} className="h-24 animate-pulse rounded-2xl bg-slate-950/70" />
          ))}
        </div>
      ) : snapshot ? (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-2xl border border-emerald-500/15 bg-emerald-500/5 p-4">
              <ArrowUpRight className="h-4 w-4 text-emerald-400" />
              <span className="mt-3 block text-[9px] font-black uppercase tracking-wider text-slate-500">Capturado bruto</span>
              <strong className="mt-1 block text-xl text-white">{money(snapshot.totals.capturedMinor)}</strong>
              <span className="text-[9px] text-slate-600">{snapshot.totals.captureCount} captura(s)</span>
            </article>
            <article className="rounded-2xl border border-rose-500/15 bg-rose-500/5 p-4">
              <ArrowDownLeft className="h-4 w-4 text-rose-400" />
              <span className="mt-3 block text-[9px] font-black uppercase tracking-wider text-slate-500">Refundado</span>
              <strong className="mt-1 block text-xl text-white">{money(snapshot.totals.refundedMinor)}</strong>
              <span className="text-[9px] text-slate-600">{snapshot.totals.refundCount} refund(s)</span>
            </article>
            <article className="rounded-2xl border border-cyan-500/15 bg-cyan-500/5 p-4">
              <Landmark className="h-4 w-4 text-cyan-400" />
              <span className="mt-3 block text-[9px] font-black uppercase tracking-wider text-slate-500">Bruto após refunds</span>
              <strong className="mt-1 block text-xl text-white">{money(snapshot.totals.grossAfterRefundsMinor)}</strong>
              <span className="text-[9px] text-slate-600">antes de taxas, impostos e settlement</span>
            </article>
            <article className="rounded-2xl border border-amber-500/15 bg-amber-500/5 p-4">
              <RotateCcw className="h-4 w-4 text-amber-400" />
              <span className="mt-3 block text-[9px] font-black uppercase tracking-wider text-slate-500">Parcela refundada</span>
              <strong className="mt-1 block text-xl text-white">{(snapshot.totals.refundShareBps / 100).toFixed(2)}%</strong>
              <span className="text-[9px] text-slate-600">{snapshot.totals.recoveredCaptureCount} captura(s) recuperada(s) de snapshot</span>
            </article>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_1.35fr]">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
              <div className="flex items-center gap-2">
                <Store className="h-4 w-4 text-violet-400" />
                <h3 className="text-[10px] font-black uppercase tracking-wider text-white">Atividade recente por loja</h3>
              </div>
              <p className="mt-1 text-[9px] text-slate-600">
                Janela dos últimos {snapshot.recentWindow.limit} eventos; não é ranking vitalício.
              </p>
              <div className="mt-3 space-y-2">
                {snapshot.recentWindow.stores.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-800 p-5 text-center text-[10px] text-slate-600">Nenhuma atividade econômica registrada.</p>
                ) : snapshot.recentWindow.stores.slice(0, 12).map(store => (
                  <div key={store.storeId} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <strong className="truncate font-mono text-[9px] text-slate-300">{store.storeId}</strong>
                      <span className="text-[8px] text-slate-600">{when(store.lastOccurredAt)}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-slate-500">
                      <span>capturado {money(store.capturedMinor)}</span>
                      <span>refundado {money(store.refundedMinor)}</span>
                      <span>bruto {money(store.grossAfterRefundsMinor)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
              <h3 className="text-[10px] font-black uppercase tracking-wider text-white">Eventos econômicos recentes</h3>
              <p className="mt-1 text-[9px] text-slate-600">
                {snapshot.recentWindow.entryCount} evento(s), {snapshot.recentWindow.representedStoreCount} loja(s) representada(s) nesta janela.
              </p>
              <div className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-1">
                {snapshot.recentWindow.entries.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-800 p-5 text-center text-[10px] text-slate-600">Ledger ainda sem eventos.</p>
                ) : snapshot.recentWindow.entries.map(entry => (
                  <div key={`${entry.storeId}:${entry.id}`} className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                    <div className={`mt-0.5 rounded-lg p-1.5 ${entry.kind === 'payment_capture' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                      {entry.kind === 'payment_capture' ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownLeft className="h-3.5 w-3.5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <strong className="text-[10px] text-white">{entry.kind === 'payment_capture' ? 'Captura' : 'Refund'} · {money(Math.abs(entry.amountMinor))}</strong>
                        <span className="shrink-0 text-[8px] text-slate-600">{when(entry.occurredAt)}</span>
                      </div>
                      <p className="mt-1 truncate font-mono text-[8px] text-slate-600">loja {entry.storeId} · pagamento {entry.paymentId}</p>
                      <p className="mt-1 text-[8px] text-slate-700">{entry.paymentContext} · {entry.provider} · {entry.sourceAuthority}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
