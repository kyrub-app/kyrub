import { useCallback, useEffect, useState } from 'react';
import {
  CircleAlert,
  Copy,
  CreditCard,
  ExternalLink,
  LoaderCircle,
  QrCode,
  ShieldCheck,
} from 'lucide-react';
import type { LocalOrderFinancialContext } from '../../../shared/localOrderFinancialContext';
import type { CustomerOrder } from '../../utils/customerOrders';
import { loadLocalOrderFinancialContext } from '../../utils/localOrderFinancialContext';
import {
  attachLocalMercadoPagoPix,
  createLocalPaymentIntent,
  loadPendingLocalPayment,
  newLocalPaymentAttemptKey,
  type LocalMercadoPagoPixCheckout,
} from '../../utils/localPixCheckout';

const money = (value: number): string =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);

const stateLabel = (context: LocalOrderFinancialContext): string => {
  switch (context.state) {
    case 'paid': return 'Pago por evidência canônica';
    case 'partial': return 'Pagamento canônico parcial';
    case 'pending': return 'Pagamento canônico pendente';
    case 'refunded': return 'Pagamento reembolsado';
    case 'reconciliation_required': return 'Conciliação necessária';
    case 'attention': return 'Evidência financeira requer atenção';
    default: return 'Pagamento canônico não iniciado';
  }
};

const pixActionLabel = (context: LocalOrderFinancialContext): string => {
  if (context.pendingPaymentCount > 0) return 'Retomar Pix';
  if (context.state === 'partial') return 'Cobrar saldo por Pix';
  if (context.state === 'refunded') return 'Gerar novo Pix';
  return 'Gerar Pix';
};

const canOperatePix = (context: LocalOrderFinancialContext): boolean =>
  context.state !== 'paid' && context.state !== 'reconciliation_required';

const qrImageSource = (value: string): string =>
  value.startsWith('data:') ? value : `data:image/png;base64,${value}`;

const expiryLabel = (value: string): string => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(timestamp));
};

interface PixUiState {
  loading: boolean;
  error: string;
  checkout: LocalMercadoPagoPixCheckout | null;
  copied: boolean;
}

const emptyPixState = (): PixUiState => ({
  loading: false,
  error: '',
  checkout: null,
  copied: false,
});

export function ServiceLocationFinancialContextPanel({
  storeId,
  orders,
}: {
  storeId: string;
  orders: CustomerOrder[];
}) {
  const [contexts, setContexts] = useState<Record<string, LocalOrderFinancialContext>>({});
  const [pixByOrder, setPixByOrder] = useState<Record<string, PixUiState>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const patchPix = useCallback((
    orderId: string,
    patch: Partial<PixUiState>
  ): void => {
    setPixByOrder(current => ({
      ...current,
      [orderId]: {
        ...(current[orderId] ?? emptyPixState()),
        ...patch,
      },
    }));
  }, []);

  const refresh = useCallback(async (quiet = false): Promise<void> => {
    if (!storeId || orders.length === 0) {
      setContexts({});
      setError('');
      return;
    }
    if (!quiet) setLoading(true);
    try {
      const next = await Promise.all(
        orders.map(order =>
          loadLocalOrderFinancialContext({ storeId, orderId: order.id })
        )
      );
      const nextContexts = Object.fromEntries(
        next.map(context => [context.orderId, context])
      );
      setContexts(nextContexts);
      setPixByOrder(current => {
        const retained = { ...current };
        for (const context of next) {
          const existing = retained[context.orderId];
          if (context.state === 'paid' || context.state === 'reconciliation_required') {
            delete retained[context.orderId];
          } else if (
            context.pendingPaymentCount === 0 &&
            existing?.checkout &&
            !existing.loading
          ) {
            retained[context.orderId] = {
              ...existing,
              checkout: null,
              copied: false,
            };
          }
        }
        return retained;
      });
      setError('');
    } catch (caught) {
      if (!quiet) {
        setError(
          caught instanceof Error
            ? caught.message
            : 'Não foi possível consultar a evidência financeira.'
        );
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [orders, storeId]);

  const preparePix = useCallback(async (
    order: CustomerOrder,
    context: LocalOrderFinancialContext
  ): Promise<void> => {
    if (!canOperatePix(context)) return;
    patchPix(order.id, { loading: true, error: '', copied: false });
    try {
      let pending = await loadPendingLocalPayment({
        storeId,
        orderId: order.id,
      });
      if (!pending) {
        pending = await createLocalPaymentIntent({
          storeId,
          orderId: order.id,
          idempotencyKey: newLocalPaymentAttemptKey(order.id),
        });
      }
      const checkout = await attachLocalMercadoPagoPix({
        storeId,
        paymentIntentId: pending.paymentIntentId,
        paymentId: pending.paymentId,
      });
      patchPix(order.id, {
        loading: false,
        error: '',
        checkout,
        copied: false,
      });
      await refresh(true);
    } catch (caught) {
      patchPix(order.id, {
        loading: false,
        error:
          caught instanceof Error
            ? caught.message
            : 'Não foi possível preparar o Pix deste pedido.',
      });
      await refresh(true);
    }
  }, [patchPix, refresh, storeId]);

  const copyPixCode = useCallback(async (
    orderId: string,
    code: string
  ): Promise<void> => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      patchPix(orderId, { copied: true, error: '' });
    } catch {
      patchPix(orderId, {
        copied: false,
        error: 'Não foi possível copiar o código Pix automaticamente.',
      });
    }
  }, [patchPix]);

  useEffect(() => {
    void refresh();
    if (!storeId || orders.length === 0) return;
    const timer = window.setInterval(() => void refresh(true), 10000);
    return () => window.clearInterval(timer);
  }, [refresh, storeId, orders.length]);

  if (orders.length === 0) return null;

  return (
    <section
      id="service-location-financial-context"
      className="mt-5 rounded-2xl border border-indigo-500/20 bg-indigo-500/[0.04] p-3"
    >
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />
        <div>
          <h3 className="text-[9px] font-black uppercase text-indigo-100">
            Evidência financeira canônica
          </h3>
          <p className="mt-1 text-[8px] leading-relaxed text-indigo-100/55">
            Pagamentos canônicos vinculados aos pedidos deste local. Espelhos legados não comprovam quitação e são ignorados no valor confirmado.
          </p>
        </div>
      </div>

      {loading && (
        <div className="mt-3 flex items-center gap-2 text-[8px] text-slate-500">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          Conferindo evidência financeira…
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[8px] text-amber-100">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {orders.map(order => {
          const context = contexts[order.id];
          const pix = pixByOrder[order.id] ?? emptyPixState();
          const visibleCheckout =
            context && canOperatePix(context) ? pix.checkout : null;
          const safeTicketUrl = visibleCheckout?.ticketUrl.startsWith('https://')
            ? visibleCheckout.ticketUrl
            : '';
          return (
            <article
              key={order.id}
              className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="flex items-center gap-1.5 text-[8px] text-slate-500">
                    <CreditCard className="h-3.5 w-3.5" />
                    Pedido {order.id.slice(-8)}
                  </span>
                  <strong className="mt-1 block text-[9px] text-white">
                    {context ? stateLabel(context) : 'Aguardando leitura financeira'}
                  </strong>
                </div>
                {context && (
                  <span className="shrink-0 font-mono text-[9px] text-indigo-100">
                    {money(context.authoritativelyPaidAmount)} / {money(context.expectedAmount)}
                  </span>
                )}
              </div>

              {context && (
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-white/5 pt-2 text-[7px] text-slate-600">
                  <span>{context.canonicalPaymentCount} pagamento(s) canônico(s)</span>
                  <span>{context.pendingPaymentCount} pendente(s)</span>
                  {context.ignoredLegacyMirrorCount > 0 && (
                    <span>{context.ignoredLegacyMirrorCount} espelho(s) legado(s) ignorado(s)</span>
                  )}
                  {context.state === 'reconciliation_required' && (
                    <span className="font-bold text-amber-300">Status operacional diverge da evidência canônica</span>
                  )}
                </div>
              )}

              {context && canOperatePix(context) && (
                <div className="mt-3 border-t border-white/5 pt-3">
                  <button
                    type="button"
                    disabled={pix.loading}
                    onClick={() => void preparePix(order, context)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-400/25 bg-indigo-500/10 px-2.5 py-1.5 text-[8px] font-bold text-indigo-100 transition hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {pix.loading
                      ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      : <QrCode className="h-3.5 w-3.5" />}
                    {pix.loading ? 'Preparando Pix…' : pixActionLabel(context)}
                  </button>
                </div>
              )}

              {pix.error && (
                <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-2 text-[8px] text-amber-100">
                  <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {pix.error}
                </div>
              )}

              {visibleCheckout && (
                <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <strong className="text-[9px] text-emerald-100">
                        Pix aguardando confirmação
                      </strong>
                      <p className="mt-0.5 text-[7px] text-emerald-100/55">
                        {money(visibleCheckout.amount)}
                        {expiryLabel(visibleCheckout.expiresAt)
                          ? ` · expira em ${expiryLabel(visibleCheckout.expiresAt)}`
                          : ''}
                      </p>
                    </div>
                    <QrCode className="h-4 w-4 text-emerald-300" />
                  </div>

                  {visibleCheckout.qrCodeBase64 && (
                    <img
                      src={qrImageSource(visibleCheckout.qrCodeBase64)}
                      alt="QR Code Pix"
                      className="mx-auto mt-3 h-40 w-40 rounded-lg bg-white p-2"
                    />
                  )}

                  {visibleCheckout.qrCode && (
                    <div className="mt-3">
                      <label className="text-[7px] font-bold uppercase tracking-wide text-emerald-100/60">
                        Pix copia e cola
                      </label>
                      <textarea
                        readOnly
                        value={visibleCheckout.qrCode}
                        rows={3}
                        className="mt-1 w-full resize-none rounded-lg border border-white/10 bg-black/30 p-2 font-mono text-[7px] text-emerald-50 outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => void copyPixCode(order.id, visibleCheckout.qrCode)}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1.5 text-[8px] font-bold text-emerald-100 hover:bg-emerald-500/20"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {pix.copied ? 'Código copiado' : 'Copiar código Pix'}
                      </button>
                    </div>
                  )}

                  {safeTicketUrl && (
                    <a
                      href={safeTicketUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-[7px] font-bold text-emerald-200 underline decoration-emerald-400/30 underline-offset-2"
                    >
                      Abrir comprovante/QR do Mercado Pago
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}

                  <p className="mt-3 text-[7px] leading-relaxed text-emerald-100/55">
                    O pedido não é marcado como pago por esta tela. A confirmação só aparece após o webhook verificado do provedor atualizar a evidência canônica.
                  </p>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <p className="mt-3 text-[8px] leading-relaxed text-slate-600">
        O valor da cobrança é calculado no servidor. A interface envia apenas IDs opacos e nunca informa valor, e-mail do pagador, `paymentStatus` ou `paidQuantity`.
      </p>
    </section>
  );
}
