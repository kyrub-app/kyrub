import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { ShieldCheck, X } from 'lucide-react';
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
      if (!nextMessage) return;
      setMessage(nextMessage);
      if (clearMessageTimer !== null) window.clearTimeout(clearMessageTimer);
      clearMessageTimer = window.setTimeout(() => setMessage(''), 8000);
    };

    const unsubscribeAuth = onAuthStateChanged(auth, syncAuthority);
    syncAuthority();
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
  }, []);

  const choose = (
    choice: 'cancel' | 'kyrub_only' | 'kyrub_and_99food'
  ): void => {
    if (!request) return;
    resolveNinetyNineFoodStatusWriteAuthority(request, choice);
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
            <div className="flex items-start justify-between gap-4">
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
              <button
                type="button"
                onClick={() => choose('cancel')}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-500"
                aria-label="Voltar sem alterar o pedido"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/[0.07] p-4 text-[10px] leading-relaxed text-amber-100">
              Você está prestes a <strong>{statusLabel(request.status)}</strong> no pedido {request.orderId}. O Kyrub não enviará nada à 99Food sem sua escolha explícita abaixo.
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
              O status canônico do Kyrub é atualizado primeiro. Se a 99Food falhar depois disso, o pedido permanece atualizado no Kyrub, o erro é mostrado e nenhum retry externo é executado automaticamente.
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
