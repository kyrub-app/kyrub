import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  AlertTriangle,
  LoaderCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import { auth } from '../../utils/firebase';
import {
  KYRUB_99FOOD_STATUS_WRITE_AUTHORITY_CHANGED_EVENT,
  KYRUB_99FOOD_STATUS_WRITE_AUTHORITY_REQUESTED_EVENT,
  KYRUB_99FOOD_STATUS_WRITE_RESULT_EVENT,
  readNinetyNineFoodStatusWriteAuthority,
  resolveNinetyNineFoodStatusWriteAuthority,
  type NinetyNineFoodStatusWriteAuthorityRequest,
  type NinetyNineFoodStatusWriteResult,
} from '../../utils/ninetyNineFoodStatusWriteAuthority';
import {
  loadNinetyNineFoodPendingStatusSyncs,
  sendNinetyNineFoodPendingStatusSync,
  type NinetyNineFoodPendingStatusSyncItem,
} from '../../utils/ninetyNineFoodPendingStatusSync';

const statusLabel = (status: string): string => {
  switch (status) {
    case 'accepted': return 'aceitar o pedido';
    case 'preparing': return 'iniciar o preparo';
    case 'ready': return 'marcar o pedido como pronto';
    case 'out_for_delivery': return 'confirmar a saída para entrega';
    case 'completed': return 'concluir o pedido';
    case 'rejected': return 'recusar o pedido';
    case 'cancelled': return 'cancelar o pedido';
    default: return `alterar para ${status}`;
  }
};

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

const resultMessage = (result: NinetyNineFoodStatusWriteResult): string => {
  if (result.partnerSync === 'sent') {
    return `O pedido ${result.orderId} foi atualizado no Kyrub e a 99Food aceitou o envio do mesmo status.`;
  }
  if (result.partnerSync === 'attention') {
    return `O pedido ${result.orderId} foi atualizado no Kyrub, mas a 99Food não confirmou o envio: ${result.partnerWarning || 'resposta do provedor indisponível.'}`;
  }
  if (result.partnerSync === 'authorization-required') {
    return `O pedido ${result.orderId} foi atualizado somente no Kyrub. Nenhuma alteração foi enviada à 99Food.`;
  }
  return '';
};

export function NinetyNineFoodOrderStatusBridge() {
  const [request, setRequest] = useState<NinetyNineFoodStatusWriteAuthorityRequest | null>(null);
  const [message, setMessage] = useState('');
  const [pendingItems, setPendingItems] = useState<NinetyNineFoodPendingStatusSyncItem[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingError, setPendingError] = useState('');
  const [pendingOpen, setPendingOpen] = useState(false);
  const [confirmSyncOrderId, setConfirmSyncOrderId] = useState('');
  const [syncingOrderId, setSyncingOrderId] = useState('');

  const refreshPending = useCallback(async (): Promise<void> => {
    const user = auth.currentUser;
    if (!user) {
      setPendingItems([]);
      setPendingError('');
      return;
    }
    setPendingLoading(true);
    setPendingError('');
    try {
      setPendingItems(await loadNinetyNineFoodPendingStatusSyncs(user));
    } catch (error) {
      setPendingError(
        error instanceof Error
          ? error.message
          : 'Não foi possível consultar as sincronizações pendentes da 99Food.'
      );
    } finally {
      setPendingLoading(false);
    }
  }, []);

  useEffect(() => {
    let clearMessageTimer: number | null = null;

    const syncAuthority = (): void => {
      const user = auth.currentUser;
      setRequest(user ? readNinetyNineFoodStatusWriteAuthority(user.uid) : null);
    };

    const handleRequested = (
      event: Event
    ): void => {
      const detail = (event as CustomEvent<NinetyNineFoodStatusWriteAuthorityRequest>).detail;
      const user = auth.currentUser;
      if (!user || detail?.storeId !== user.uid) return;
      syncAuthority();
    };

    const handleResult = (event: Event): void => {
      const detail = (event as CustomEvent<NinetyNineFoodStatusWriteResult>).detail;
      const user = auth.currentUser;
      if (!user || detail?.storeId !== user.uid) return;
      const nextMessage = resultMessage(detail);
      if (nextMessage) {
        setMessage(nextMessage);
        if (clearMessageTimer !== null) window.clearTimeout(clearMessageTimer);
        clearMessageTimer = window.setTimeout(() => setMessage(''), 8000);
      }
      void refreshPending();
    };

    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      syncAuthority();
      if (user) {
        void refreshPending();
      } else {
        setPendingItems([]);
        setPendingOpen(false);
      }
    });
    syncAuthority();
    void refreshPending();
    window.addEventListener(
      KYRUB_99FOOD_STATUS_WRITE_AUTHORITY_REQUESTED_EVENT,
      handleRequested
    );
    window.addEventListener(
      KYRUB_99FOOD_STATUS_WRITE_AUTHORITY_CHANGED_EVENT,
      syncAuthority
    );
    window.addEventListener(
      KYRUB_99FOOD_STATUS_WRITE_RESULT_EVENT,
      handleResult
    );

    return () => {
      unsubscribeAuth();
      window.removeEventListener(
        KYRUB_99FOOD_STATUS_WRITE_AUTHORITY_REQUESTED_EVENT,
        handleRequested
      );
      window.removeEventListener(
        KYRUB_99FOOD_STATUS_WRITE_AUTHORITY_CHANGED_EVENT,
        syncAuthority
      );
      window.removeEventListener(
        KYRUB_99FOOD_STATUS_WRITE_RESULT_EVENT,
        handleResult
      );
      if (clearMessageTimer !== null) window.clearTimeout(clearMessageTimer);
    };
  }, [refreshPending]);

  const choose = (
    choice: 'kyrub_only' | 'kyrub_and_99food'
  ): void => {
    if (!request) return;
    resolveNinetyNineFoodStatusWriteAuthority(request, choice);
  };

  const syncPending = async (
    item: NinetyNineFoodPendingStatusSyncItem
  ): Promise<void> => {
    if (confirmSyncOrderId !== item.orderId) {
      setConfirmSyncOrderId(item.orderId);
      setPendingError('');
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      setPendingError('Faça login novamente para sincronizar o pedido.');
      return;
    }

    setSyncingOrderId(item.orderId);
    setPendingError('');
    try {
      const result = await sendNinetyNineFoodPendingStatusSync(user, item);
      setConfirmSyncOrderId('');
      if (result.partnerSync === 'sent') {
        setMessage(
          `O status “${statusName(result.status)}” do pedido ${item.displayId} foi enviado à 99Food. O Kyrub não refez a transição local.`
        );
      } else {
        setMessage(
          `A 99Food não confirmou o envio do pedido ${item.displayId}: ${result.partnerWarning || 'resposta do provedor indisponível.'} A pendência continua manual e o status local não foi revertido.`
        );
      }
      await refreshPending();
    } catch (error) {
      setConfirmSyncOrderId('');
      setPendingError(
        error instanceof Error
          ? error.message
          : 'Não foi possível enviar o status pendente à 99Food.'
      );
      await refreshPending();
    } finally {
      setSyncingOrderId('');
    }
  };

  return (
    <>
      {request && (
        <div className="fixed inset-0 z-[190] flex items-end justify-center bg-slate-950/90 backdrop-blur-md sm:items-center sm:p-5">
          <section
            id="kyrub-99food-status-write-authority"
            className="w-full max-w-lg rounded-t-3xl border border-amber-500/25 bg-slate-900 p-5 shadow-2xl sm:rounded-3xl sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="kyrub-99food-status-write-authority-title"
          >
            <div>
              <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-amber-300">
                Autoridade de canal · 99Food
              </span>
              <h3
                id="kyrub-99food-status-write-authority-title"
                className="mt-1 text-lg font-black text-white"
              >
                Onde aplicar esta mudança?
              </h3>
            </div>

            <p className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/[0.07] p-4 text-[10px] leading-relaxed text-amber-100">
              Você escolheu <strong>{statusLabel(request.status)}</strong> no pedido {request.orderId}. Agora defina somente o alcance dessa ação. O Kyrub não enviará nada à 99Food sem a opção explícita abaixo.
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                id="kyrub-99food-status-kyrub-only"
                type="button"
                onClick={() => choose('kyrub_only')}
                className="min-h-12 rounded-xl border border-slate-700 bg-slate-950 px-4 text-[10px] font-black uppercase text-slate-200"
              >
                Atualizar só no Kyrub
              </button>
              <button
                id="kyrub-99food-status-kyrub-and-provider"
                type="button"
                onClick={() => choose('kyrub_and_99food')}
                className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 text-[10px] font-black uppercase text-slate-950"
              >
                <ShieldCheck className="h-4 w-4" />
                Kyrub + 99Food
              </button>
            </div>

            <p className="mt-3 text-[9px] leading-relaxed text-slate-500">
              Esta tela define apenas o alcance da mudança que você já solicitou no KDS. O status canônico do Kyrub é atualizado primeiro. Se a 99Food falhar depois disso, o pedido permanece atualizado no Kyrub, o erro é mostrado e nenhum retry externo é executado automaticamente.
            </p>
          </section>
        </div>
      )}

      {!request && pendingItems.length > 0 && (
        <button
          id="kyrub-99food-pending-status-sync-trigger"
          type="button"
          onClick={() => setPendingOpen(true)}
          className="fixed bottom-5 right-5 z-[120] flex items-center gap-2 rounded-2xl border border-amber-500/30 bg-slate-950 px-4 py-3 text-left shadow-2xl"
        >
          <AlertTriangle className="h-4 w-4 text-amber-300" />
          <span>
            <strong className="block text-[9px] font-black uppercase tracking-wide text-amber-300">
              99Food · sincronização pendente
            </strong>
            <span className="mt-0.5 block text-[9px] text-slate-400">
              {pendingItems.length} pedido(s) aguardando revisão manual
            </span>
          </span>
        </button>
      )}

      {!request && pendingOpen && (
        <div className="fixed inset-0 z-[185] flex items-end justify-center bg-slate-950/90 backdrop-blur-md sm:items-center sm:p-5">
          <section
            id="kyrub-99food-pending-status-sync-queue"
            className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-amber-500/25 bg-slate-900 p-5 shadow-2xl sm:rounded-3xl sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="kyrub-99food-pending-status-sync-title"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-amber-300">
                  Autoridade externa · 99Food
                </span>
                <h3
                  id="kyrub-99food-pending-status-sync-title"
                  className="mt-1 text-lg font-black text-white"
                >
                  Sincronizações de status pendentes
                </h3>
                <p className="mt-2 max-w-xl text-[10px] leading-relaxed text-slate-400">
                  Estes pedidos já mudaram no Kyrub. Aqui você revisa cada status e, somente se quiser, autoriza um envio externo separado. Nenhuma ação desta fila repete a transição local.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPendingOpen(false);
                  setConfirmSyncOrderId('');
                }}
                className="rounded-xl border border-slate-700 bg-slate-950 p-2 text-slate-400"
                aria-label="Fechar fila de sincronização 99Food"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
              <span className="text-[9px] text-slate-400">
                {pendingItems.length} pendência(s) manual(is)
              </span>
              <button
                type="button"
                onClick={() => void refreshPending()}
                disabled={pendingLoading || Boolean(syncingOrderId)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[8px] font-black uppercase text-slate-300 disabled:opacity-40"
              >
                <RefreshCw className={`h-3 w-3 ${pendingLoading ? 'animate-spin' : ''}`} />
                Atualizar
              </button>
            </div>

            {pendingError && (
              <p className="mt-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-3 text-[9px] leading-relaxed text-rose-200" aria-live="polite">
                {pendingError}
              </p>
            )}

            <div className="mt-4 space-y-3">
              {pendingLoading && pendingItems.length === 0 ? (
                <div className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-950/50 p-4 text-[10px] text-slate-400">
                  <LoaderCircle className="h-4 w-4 animate-spin" /> Consultando pendências…
                </div>
              ) : pendingItems.length === 0 ? (
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-[10px] text-emerald-200">
                  Nenhuma sincronização manual está pendente nesta leitura.
                </div>
              ) : pendingItems.map(item => {
                const armed = confirmSyncOrderId === item.orderId;
                const syncing = syncingOrderId === item.orderId;
                return (
                  <article
                    key={item.orderId}
                    className={`rounded-2xl border p-4 ${item.outboundStatus === 'attention' ? 'border-rose-500/20 bg-rose-500/[0.04]' : 'border-amber-500/20 bg-amber-500/[0.035]'}`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[9px] font-black uppercase text-slate-500">Pedido {item.displayId}</span>
                          <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[8px] font-black uppercase text-slate-300">
                            {statusName(item.status)}
                          </span>
                          <span className={`rounded-full border px-2 py-0.5 text-[8px] font-black uppercase ${item.outboundStatus === 'attention' ? 'border-rose-500/25 text-rose-300' : 'border-amber-500/25 text-amber-300'}`}>
                            {item.outboundStatus === 'attention' ? 'Falha no último envio' : 'Autorização necessária'}
                          </span>
                        </div>
                        {item.customerName && (
                          <strong className="mt-2 block text-xs text-white">{item.customerName}</strong>
                        )}
                        <p className="mt-2 text-[9px] leading-relaxed text-slate-400">
                          O Kyrub está em <strong className="text-slate-200">{statusName(item.status)}</strong>. O envio abaixo autoriza exatamente esse status para a 99Food; se o pedido tiver mudado desde esta leitura, o servidor recusará a autorização antes do provider write.
                        </p>
                        {item.outboundError && (
                          <p className="mt-2 rounded-xl border border-rose-500/15 bg-rose-500/5 p-2.5 text-[9px] leading-relaxed text-rose-200">
                            Último erro: {item.outboundError}
                          </p>
                        )}
                        <p className="mt-2 break-all text-[8px] text-slate-600">
                          Kyrub: {item.orderId} · 99Food: {item.externalOrderId}
                        </p>
                      </div>

                      <div className="shrink-0 sm:w-44">
                        {armed ? (
                          <div className="space-y-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-2.5">
                            <p className="text-[8px] leading-relaxed text-amber-100">
                              Confirme o envio de “{statusName(item.status)}” à 99Food.
                            </p>
                            <button
                              type="button"
                              onClick={() => void syncPending(item)}
                              disabled={Boolean(syncingOrderId)}
                              className="flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-2 text-[8px] font-black uppercase text-slate-950 disabled:opacity-40"
                            >
                              {syncing ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                              Confirmar envio
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmSyncOrderId('')}
                              disabled={Boolean(syncingOrderId)}
                              className="min-h-8 w-full rounded-lg border border-slate-700 text-[8px] font-black uppercase text-slate-300 disabled:opacity-40"
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void syncPending(item)}
                            disabled={Boolean(syncingOrderId)}
                            className="flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 text-[8px] font-black uppercase text-amber-200 disabled:opacity-40"
                          >
                            <Send className="h-3.5 w-3.5" />
                            Revisar e enviar
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            <p className="mt-4 text-[9px] leading-relaxed text-slate-500">
              Se a 99Food falhar, o Kyrub mantém o status local, registra a falha nesta fila e não agenda retry automático. Uma nova tentativa só ocorre após outra confirmação explícita sua.
            </p>
          </section>
        </div>
      )}

      {message && (
        <div className="fixed bottom-24 left-1/2 z-[125] w-[min(92vw,34rem)] -translate-x-1/2 rounded-2xl border border-yellow-500/30 bg-slate-950 px-5 py-4 text-center shadow-2xl">
          <strong className="block text-[9px] font-black uppercase tracking-wide text-yellow-300">
            Sincronização 99Food
          </strong>
          <span className="mt-1 block text-[10px] leading-relaxed text-slate-300">
            {message}
          </span>
        </div>
      )}
    </>
  );
}
