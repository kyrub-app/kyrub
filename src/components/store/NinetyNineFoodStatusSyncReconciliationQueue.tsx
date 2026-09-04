import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  AlertOctagon,
  Eye,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react';
import { auth } from '../../utils/firebase';
import {
  KYRUB_99FOOD_STATUS_SYNC_RECONCILIATION_CHANGED_EVENT,
  loadNinetyNineFoodStatusSyncReconciliationItems,
  reconcileNinetyNineFoodStatusSyncExecution,
  type NinetyNineFoodStatusSyncReconciliationItem,
  type NinetyNineFoodStatusSyncReconciliationResult,
} from '../../utils/ninetyNineFoodStatusSyncReconciliation';

const statusName = (status: string): string => {
  switch (status) {
    case 'accepted': return 'Aceito';
    case 'preparing': return 'Em preparo';
    case 'ready': return 'Pronto';
    case 'out_for_delivery': return 'Saiu para entrega';
    case 'completed': return 'Concluído';
    case 'rejected': return 'Recusado';
    case 'cancelled': return 'Cancelado';
    default: return status;
  }
};

const phaseLabel = (phase: string): string => {
  switch (phase) {
    case 'claimed': return 'Claim órfão';
    case 'provider_write_started': return 'Envio iniciado sem finalização';
    case 'provider_write_outcome_unknown': return 'Resposta externa desconhecida';
    case 'reconciliation_uncertain': return 'Última conferência inconclusiva';
    case 'reconciliation_checking': return 'Conferência anterior interrompida';
    default: return phase;
  }
};

const ageLabel = (ageMs: number): string => {
  const minutes = Math.max(1, Math.floor(ageMs / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}h ${rest}min` : `${hours}h`;
};

const resultText = (
  item: NinetyNineFoodStatusSyncReconciliationItem,
  result: NinetyNineFoodStatusSyncReconciliationResult
): string => {
  if (result.reconciliation === 'confirmed') {
    return `A leitura da 99Food confirma que o efeito de “${statusName(item.targetStatus)}” já está presente. O Kyrub encerrou a execução sem reenviar nada.`;
  }
  if (result.reconciliation === 'not_observed') {
    return `A leitura atual da 99Food não mostrou o efeito esperado para “${statusName(item.targetStatus)}”. O pedido voltou para atenção manual. Qualquer novo envio exigirá uma nova autorização explícita.`;
  }
  if (result.reconciliation === 'conflict') {
    return `A 99Food retornou um estado conflitante com “${statusName(item.targetStatus)}”. Nenhum novo envio foi feito e o pedido ficou em atenção manual.`;
  }
  return `A 99Food ainda não forneceu evidência suficiente para decidir. A execução continua bloqueada para nova conferência manual e nenhum status foi reenviado.`;
};

export function NinetyNineFoodStatusSyncReconciliationQueue() {
  const [items, setItems] = useState<NinetyNineFoodStatusSyncReconciliationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState(false);
  const [checkingExecutionId, setCheckingExecutionId] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    const user = auth.currentUser;
    if (!user) {
      setItems([]);
      setError('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      setItems(await loadNinetyNineFoodStatusSyncReconciliationItems(user));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Não foi possível consultar as reconciliações 99Food.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, user => {
      if (user) {
        void refresh();
      } else {
        setItems([]);
        setOpen(false);
      }
    });
    const handleChanged = (): void => {
      void refresh();
    };
    void refresh();
    window.addEventListener(
      KYRUB_99FOOD_STATUS_SYNC_RECONCILIATION_CHANGED_EVENT,
      handleChanged
    );
    return () => {
      unsubscribe();
      window.removeEventListener(
        KYRUB_99FOOD_STATUS_SYNC_RECONCILIATION_CHANGED_EVENT,
        handleChanged
      );
    };
  }, [refresh]);

  const reconcile = async (
    item: NinetyNineFoodStatusSyncReconciliationItem
  ): Promise<void> => {
    const user = auth.currentUser;
    if (!user) {
      setError('Faça login novamente para conferir a execução 99Food.');
      return;
    }
    setCheckingExecutionId(item.executionId);
    setError('');
    setMessage('');
    try {
      const result = await reconcileNinetyNineFoodStatusSyncExecution(user, item);
      setMessage(resultText(item, result));
      await refresh();
    } catch (reconcileError) {
      setError(
        reconcileError instanceof Error
          ? reconcileError.message
          : 'Não foi possível reconciliar esta execução 99Food.'
      );
      await refresh();
    } finally {
      setCheckingExecutionId('');
    }
  };

  return (
    <>
      {items.length > 0 && (
        <button
          id="kyrub-99food-status-sync-reconciliation-trigger"
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-20 right-5 z-[121] flex items-center gap-2 rounded-2xl border border-rose-500/35 bg-slate-950 px-4 py-3 text-left shadow-2xl"
        >
          <ShieldAlert className="h-4 w-4 text-rose-300" />
          <span>
            <strong className="block text-[9px] font-black uppercase tracking-wide text-rose-300">
              99Food · reconciliação necessária
            </strong>
            <span className="mt-0.5 block text-[9px] text-slate-400">
              {items.length} execução(ões) com resultado externo indefinido
            </span>
          </span>
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-[188] flex items-end justify-center bg-slate-950/90 backdrop-blur-md sm:items-center sm:p-5">
          <section
            id="kyrub-99food-status-sync-reconciliation-queue"
            className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-rose-500/25 bg-slate-900 p-5 shadow-2xl sm:rounded-3xl sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="kyrub-99food-status-sync-reconciliation-title"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-rose-300">
                  Evidência externa · 99Food
                </span>
                <h3
                  id="kyrub-99food-status-sync-reconciliation-title"
                  className="mt-1 text-lg font-black text-white"
                >
                  Execuções aguardando reconciliação
                </h3>
                <p className="mt-2 max-w-xl text-[10px] leading-relaxed text-slate-400">
                  O Kyrub perdeu a certeza sobre o resultado de um envio anterior — por interrupção do processo, timeout ou resposta de rede ambígua. “Conferir na 99Food” faz somente uma leitura do pedido externo. Esta fila não possui caminho de provider write.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-xl border border-slate-700 bg-slate-950 p-2 text-slate-400"
                aria-label="Fechar reconciliação 99Food"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
              <span className="text-[9px] text-slate-400">
                {items.length} execução(ões) bloqueada(s) para novo envio
              </span>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={loading || Boolean(checkingExecutionId)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[8px] font-black uppercase text-slate-300 disabled:opacity-40"
              >
                <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
                Atualizar
              </button>
            </div>

            {error && (
              <p className="mt-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-3 text-[9px] leading-relaxed text-rose-200" aria-live="polite">
                {error}
              </p>
            )}
            {message && (
              <p className="mt-3 rounded-2xl border border-sky-500/20 bg-sky-500/5 p-3 text-[9px] leading-relaxed text-sky-100" aria-live="polite">
                {message}
              </p>
            )}

            <div className="mt-4 space-y-3">
              {loading && items.length === 0 ? (
                <div className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-950/50 p-4 text-[10px] text-slate-400">
                  <LoaderCircle className="h-4 w-4 animate-spin" /> Procurando execuções órfãs…
                </div>
              ) : items.length === 0 ? (
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-[10px] text-emerald-200">
                  Nenhuma execução 99Food precisa de reconciliação nesta leitura.
                </div>
              ) : items.map(item => {
                const checking = checkingExecutionId === item.executionId;
                return (
                  <article
                    key={item.executionId}
                    className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.035] p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[9px] font-black uppercase text-slate-500">
                            Pedido {item.displayId}
                          </span>
                          <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[8px] font-black uppercase text-slate-300">
                            alvo: {statusName(item.targetStatus)}
                          </span>
                          <span className="rounded-full border border-rose-500/25 px-2 py-0.5 text-[8px] font-black uppercase text-rose-300">
                            {phaseLabel(item.executionStatus)}
                          </span>
                        </div>
                        {item.customerName && (
                          <strong className="mt-2 block text-xs text-white">{item.customerName}</strong>
                        )}
                        <p className="mt-2 text-[9px] leading-relaxed text-slate-400">
                          A execução está sem conclusão autoritativa há aproximadamente <strong className="text-slate-200">{ageLabel(item.ageMs)}</strong>. Enquanto isso, o Kyrub impede um novo envio do mesmo fluxo.
                        </p>
                        {item.warning && (
                          <p className="mt-2 rounded-xl border border-rose-500/15 bg-rose-500/5 p-2.5 text-[9px] leading-relaxed text-rose-200">
                            Evidência atual: {item.warning}
                          </p>
                        )}
                        <p className="mt-2 break-all text-[8px] text-slate-600">
                          execução: {item.executionId} · Kyrub: {item.orderId} · 99Food: {item.externalOrderId}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => void reconcile(item)}
                        disabled={Boolean(checkingExecutionId)}
                        className="flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-sky-500/25 bg-sky-500/10 px-3 text-[8px] font-black uppercase text-sky-200 disabled:opacity-40 sm:w-44"
                      >
                        {checking ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                        Conferir na 99Food
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="mt-4 flex gap-2 rounded-2xl border border-amber-500/15 bg-amber-500/[0.04] p-3 text-[9px] leading-relaxed text-amber-100">
              <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                A reconciliação nunca reenvia o status. Se a leitura não confirmar o efeito externo, o pedido volta para atenção manual e qualquer nova tentativa continua exigindo uma nova autorização explícita na fila normal.
              </span>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
