import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { doc, getDoc } from 'firebase/firestore';
import { LoaderCircle, Minus, Plus, ShoppingBasket, XCircle } from 'lucide-react';
import {
  getCustomerOrderDocumentPath,
  parseCustomerOrder,
  type CustomerOrder,
} from '../../utils/customerOrders';
import { db } from '../../utils/firebase';
import {
  rejectPendingOrderItems,
  type OrderItemRejectionLine,
} from '../../utils/orderItemRejection';
import { updateOrderStatusWithDecision } from '../../utils/orderWorkflow';

interface OrderRejectionScopeBridgeProps {
  storeId: string;
  notify: (
    message: string,
    type?: 'success' | 'error' | 'info' | 'warning'
  ) => void;
}

type RejectionScope = 'whole' | 'items';

const ORDER_CARD_PREFIX = 'kyrub-customer-order-';
const SCOPE_HOST_ID = 'kyrub-order-rejection-scope-host';

const findRejectionModal = (): HTMLElement | null => {
  for (const section of Array.from(document.querySelectorAll('section'))) {
    if (!(section instanceof HTMLElement)) continue;
    const hasTitle = Array.from(section.querySelectorAll('span')).some(
      element => element.textContent?.trim() === 'Recusar pedido'
    );
    const hasConfirm = Array.from(section.querySelectorAll('button')).some(
      element => element.textContent?.includes('Confirmar recusa')
    );
    if (hasTitle && hasConfirm) return section;
  }
  return null;
};

const confirmButtonFor = (modal: HTMLElement): HTMLButtonElement | null =>
  Array.from(modal.querySelectorAll('button')).find(
    element => element.textContent?.includes('Confirmar recusa')
  ) ?? null;

const closeRejectionModal = (modal: HTMLElement): void => {
  const buttons = Array.from(modal.querySelectorAll('button'));
  const close = buttons.find(button => !button.textContent?.trim());
  close?.click();
};

export const OrderRejectionScopeBridge = ({
  storeId,
  notify,
}: OrderRejectionScopeBridgeProps) => {
  const [orderId, setOrderId] = useState('');
  const [order, setOrder] = useState<CustomerOrder | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [reasonReady, setReasonReady] = useState(false);
  const [scope, setScope] = useState<RejectionScope>('whole');
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const captureOrder = (event: MouseEvent): void => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest('button');
      if (!button || button.textContent?.trim() !== 'Recusar') return;
      const article = button.closest(`article[id^="${ORDER_CARD_PREFIX}"]`);
      if (!(article instanceof HTMLElement)) return;
      const encoded = article.id.slice(ORDER_CARD_PREFIX.length);
      let resolved = '';
      try {
        resolved = decodeURIComponent(encoded);
      } catch {
        resolved = encoded;
      }
      setOrderId(resolved.trim());
      setOrder(null);
      setScope('whole');
      setSelected({});
      setError('');
    };
    document.addEventListener('click', captureOrder, true);
    return () => document.removeEventListener('click', captureOrder, true);
  }, []);

  useEffect(() => {
    if (!storeId || !orderId) return;
    let disposed = false;
    void getDoc(doc(db, getCustomerOrderDocumentPath(storeId, orderId)))
      .then(snapshot => {
        if (disposed) return;
        const parsed = snapshot.exists() ? parseCustomerOrder(snapshot.data()) : null;
        if (!parsed || parsed.id !== orderId || parsed.storeId !== storeId) {
          setError('Não foi possível carregar os itens deste pedido para a recusa.');
          return;
        }
        setOrder(parsed);
      })
      .catch(() => {
        if (!disposed) {
          setError('Não foi possível carregar os itens deste pedido para a recusa.');
        }
      });
    return () => {
      disposed = true;
    };
  }, [orderId, storeId]);

  useEffect(() => {
    let activeModal: HTMLElement | null = null;
    let activeTextarea: HTMLTextAreaElement | null = null;
    let originalConfirmDisplay = '';

    const sync = (): void => {
      const modal = findRejectionModal();
      if (!modal) {
        if (activeModal) {
          setHost(null);
          setReasonReady(false);
          setBusy(false);
        }
        activeModal = null;
        activeTextarea = null;
        return;
      }
      if (modal === activeModal && document.getElementById(SCOPE_HOST_ID)) return;

      activeModal = modal;
      const confirm = confirmButtonFor(modal);
      if (!confirm) return;
      originalConfirmDisplay = confirm.style.display;
      confirm.style.display = 'none';

      let portalHost = modal.querySelector(`#${SCOPE_HOST_ID}`);
      if (!(portalHost instanceof HTMLElement)) {
        portalHost = document.createElement('div');
        portalHost.id = SCOPE_HOST_ID;
        confirm.before(portalHost);
      }
      setHost(portalHost);

      const textarea = modal.querySelector('textarea');
      if (textarea instanceof HTMLTextAreaElement) {
        activeTextarea = textarea;
        const updateReason = (): void => setReasonReady(Boolean(textarea.value.trim()));
        updateReason();
        textarea.addEventListener('input', updateReason);
      }
    };

    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    sync();
    return () => {
      observer.disconnect();
      if (activeTextarea) {
        const textarea = activeTextarea;
        textarea.replaceWith(textarea.cloneNode(true));
      }
      if (activeModal) {
        const confirm = confirmButtonFor(activeModal);
        if (confirm) confirm.style.display = originalConfirmDisplay;
      }
    };
  }, []);

  const availableItems = useMemo(
    () => (order?.items ?? []).flatMap(item => {
      const quantity = Math.max(
        0,
        item.quantity - item.transferredQuantity - (item.voidedQuantity ?? 0)
      );
      return quantity > 0 ? [{ ...item, availableQuantity: quantity }] : [];
    }),
    [order]
  );

  const selectedLines = useMemo<OrderItemRejectionLine[]>(
    () => Object.entries(selected).flatMap(([lineId, quantity]) =>
      quantity > 0 ? [{ lineId, quantity }] : []
    ),
    [selected]
  );
  const totalOperationalQuantity = availableItems.reduce(
    (total, item) => total + item.availableQuantity,
    0
  );
  const selectedQuantity = selectedLines.reduce((total, line) => total + line.quantity, 0);
  const selectsEverything =
    totalOperationalQuantity > 0 && selectedQuantity === totalOperationalQuantity;
  const paidPartialBlocked =
    scope === 'items' && order !== null && order.paymentStatus !== 'unpaid';

  const setLineQuantity = (lineId: string, quantity: number, maximum: number): void => {
    const safe = Math.max(0, Math.min(maximum, Math.trunc(quantity)));
    setSelected(current => ({ ...current, [lineId]: safe }));
    setError('');
  };

  const submit = async (): Promise<void> => {
    const modal = findRejectionModal();
    if (!modal || !orderId || busy) return;
    const textarea = modal.querySelector('textarea');
    const alternativeInput = modal.querySelector('input[type="text"]');
    const reason = textarea instanceof HTMLTextAreaElement ? textarea.value.trim() : '';
    const alternative = alternativeInput instanceof HTMLInputElement
      ? alternativeInput.value.trim()
      : '';
    if (!reason) {
      setError('Informe o motivo antes de confirmar a recusa.');
      return;
    }
    if (scope === 'items' && selectedLines.length === 0) {
      setError('Escolha ao menos um item e a quantidade que será recusada.');
      return;
    }
    if (scope === 'items' && selectsEverything) {
      setError('Essa seleção corresponde a todos os itens restantes. Use “Pedido inteiro”.');
      return;
    }
    if (paidPartialBlocked) {
      setError('Este pedido já foi pago. A recusa de itens específicos precisa gerar um reembolso parcial correspondente; o Kyrub não fará um estorno integral por engano.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      if (scope === 'whole') {
        await updateOrderStatusWithDecision(storeId, orderId, 'rejected', {
          reason,
          alternative,
        });
        notify('Pedido recusado. Se houver pagamento confirmado, o reembolso ficará pendente para o fluxo financeiro seguro.', 'success');
      } else {
        const result = await rejectPendingOrderItems({
          storeId,
          orderId,
          reason,
          alternative,
          lines: selectedLines,
        });
        notify(
          `Itens recusados. O pedido continua aguardando decisão com total atualizado${typeof result.cancelledAmount === 'number' ? ` (${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(result.cancelledAmount)} removidos)` : ''}.`,
          'success'
        );
      }
      closeRejectionModal(modal);
      setOrderId('');
      setOrder(null);
      setSelected({});
      setScope('whole');
      setError('');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'A recusa não foi confirmada. Revise os dados e tente novamente.'
      );
    } finally {
      setBusy(false);
    }
  };

  if (!host) return null;

  return createPortal(
    <div data-kyrub-order-rejection-scope className="mt-4 space-y-3">
      {!reasonReady ? (
        <p className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-[10px] leading-relaxed text-slate-400">
          Informe o motivo acima. Em seguida, escolha se a recusa vale para o pedido inteiro ou apenas para itens específicos.
        </p>
      ) : (
        <>
          <div>
            <span className="text-[9px] font-black uppercase text-slate-400">O que será recusado?</span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => { setScope('whole'); setError(''); }}
                className={`min-h-11 rounded-xl border px-3 text-[9px] font-black uppercase ${scope === 'whole' ? 'border-red-400 bg-red-500/15 text-red-200' : 'border-slate-700 bg-slate-950 text-slate-400'}`}
              >
                Pedido inteiro
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => { setScope('items'); setError(''); }}
                className={`min-h-11 rounded-xl border px-3 text-[9px] font-black uppercase ${scope === 'items' ? 'border-amber-400 bg-amber-500/15 text-amber-100' : 'border-slate-700 bg-slate-950 text-slate-400'}`}
              >
                Itens específicos
              </button>
            </div>
          </div>

          {scope === 'items' && (
            <div className="space-y-2 rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-3">
              <div className="flex items-center gap-2 text-[9px] font-black uppercase text-amber-200">
                <ShoppingBasket className="h-4 w-4" /> Selecione item e quantidade
              </div>
              {!order && !error && (
                <p className="text-[10px] text-slate-500">Carregando itens do pedido…</p>
              )}
              {availableItems.map(item => {
                const quantity = selected[item.lineId] ?? 0;
                return (
                  <div key={item.lineId} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/80 p-2.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setLineQuantity(item.lineId, quantity > 0 ? 0 : 1, item.availableQuantity)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <strong className="block truncate text-[11px] text-white">{item.name}</strong>
                      <span className="text-[9px] text-slate-500">{item.availableQuantity} disponível{item.availableQuantity === 1 ? '' : 'is'}</span>
                    </button>
                    <div className="flex items-center gap-1">
                      <button type="button" disabled={busy || quantity <= 0} onClick={() => setLineQuantity(item.lineId, quantity - 1, item.availableQuantity)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-300 disabled:opacity-30"><Minus className="h-3.5 w-3.5" /></button>
                      <span className="w-7 text-center font-mono text-[11px] font-black text-white">{quantity}</span>
                      <button type="button" disabled={busy || quantity >= item.availableQuantity} onClick={() => setLineQuantity(item.lineId, quantity + 1, item.availableQuantity)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-300 disabled:opacity-30"><Plus className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                );
              })}
              {paidPartialBlocked && (
                <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[10px] leading-relaxed text-amber-100">
                  Este pedido já está pago. Itens específicos exigem reembolso parcial do valor correspondente; o Kyrub não vai transformar essa escolha em estorno integral.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {error && (
        <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[10px] leading-relaxed text-red-200">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={
          busy ||
          !reasonReady ||
          (scope === 'items' && (selectedLines.length === 0 || selectsEverything || paidPartialBlocked))
        }
        onClick={() => void submit()}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 text-[10px] font-black uppercase text-white disabled:opacity-40"
      >
        {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
        {busy ? 'Confirmando…' : scope === 'whole' ? 'Confirmar recusa do pedido' : 'Confirmar recusa dos itens'}
      </button>
    </div>,
    host
  );
};
