import { useCallback, useEffect, useState } from 'react';
import {
  CircleAlert,
  Copy,
  CreditCard,
  ExternalLink,
  LoaderCircle,
  QrCode,
  ShieldCheck,
  TicketPercent,
} from 'lucide-react';
import type { LocalOrderFinancialContext } from '../../../shared/localOrderFinancialContext';
import type { CustomerOrder } from '../../utils/customerOrders';
import { loadLocalOrderFinancialContext } from '../../utils/localOrderFinancialContext';
import {
  attachLocalMercadoPagoPix,
  attachLocalStoreOwnedPix,
  confirmLocalStoreOwnedPix,
  createLocalPaymentIntent,
  loadLocalPaymentOptions,
  loadPendingLocalPayment,
  newLocalPaymentAttemptKey,
  type LocalPaymentOptions,
  type LocalPixCheckout,
  type LocalPixProvider,
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

const providerLabel = (provider: LocalPixProvider): string =>
  provider === 'mercado-pago' ? 'Mercado Pago' : 'Pix próprio';

interface PixUiState {
  loading: boolean;
  error: string;
  checkout: LocalPixCheckout | null;
  copied: boolean;
  boundProvider: '' | LocalPixProvider;
  confirmedCredit: boolean;
  couponCode: string;
}

const emptyPixState = (): PixUiState => ({
  loading: false,
  error: '',
  checkout: null,
  copied: false,
  boundProvider: '',
  confirmedCredit: false,
  couponCode: '',
});

export function ServiceLocationFinancialContextPanel({
  storeId,
  orders,
  couponCode: appliedCouponCode = '',
  requestedAmount = 0,
  targetOrderIds = [],
}: {
  storeId: string;
  orders: CustomerOrder[];
  couponCode?: string;
  requestedAmount?: number;
  targetOrderIds?: string[];
}) {
  const [contexts, setContexts] = useState<Record<string, LocalOrderFinancialContext>>({});
  const [pixByOrder, setPixByOrder] = useState<Record<string, PixUiState>>({});
  const [options, setOptions] = useState<LocalPaymentOptions | null>(null);
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
      setContexts(Object.fromEntries(next.map(context => [context.orderId, context])));
      setPixByOrder(current => {
        const retained = { ...current };
        for (const context of next) {
          const existing = retained[context.orderId];
          if (context.state === 'paid' || context.state === 'reconciliation_required') {
            delete retained[context.orderId];
          } else if (
            context.canonicalProjection.pendingPaymentCount === 0 &&
            existing?.checkout &&
            !existing.loading
          ) {
            retained[context.orderId] = {
              ...existing,
              checkout: null,
              copied: false,
              boundProvider: '',
              confirmedCredit: false,
              couponCode: '',
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

  const refreshOptions = useCallback(async (): Promise<void> => {
    if (!storeId) return;
    try {
      setOptions(await loadLocalPaymentOptions(storeId));
    } catch (caught) {
      setOptions(null);
      setError(caught instanceof Error ? caught.message : 'Não foi possível consultar os modos de recebimento.');
    }
  }, [storeId]);

  const preparePix = useCallback(async (
    order: CustomerOrder,
    context: LocalOrderFinancialContext,
    provider: LocalPixProvider
  ): Promise<void> => {
    if (!canOperatePix(context)) return;
    const couponCode = appliedCouponCode.trim();
    patchPix(order.id, { loading: true, error: '', copied: false, confirmedCredit: false });
    try {
      let pending = await loadPendingLocalPayment({ storeId, orderId: order.id });
      if (pending && couponCode) {
        throw new Error('Já existe uma cobrança pendente para este pedido. O cupom só pode ser definido ao criar uma nova tentativa de pagamento.');
      }
      if (pending?.provider && pending.provider !== provider) {
        patchPix(order.id, { boundProvider: pending.provider });
        throw new Error(`Esta tentativa já está vinculada a ${providerLabel(pending.provider)}. Retome pelo mesmo modo ou inicie outra tentativa após o encerramento desta.`);
      }
      if (!pending) {
        pending = await createLocalPaymentIntent({
          storeId,
          orderId: order.id,
          idempotencyKey: newLocalPaymentAttemptKey(order.id),
          ...(couponCode ? { couponCode } : {}),
          ...(requestedAmount > 0 ? { amount: requestedAmount } : {}),
        });
      }
      const checkout = provider === 'mercado-pago'
        ? await attachLocalMercadoPagoPix({ storeId, paymentIntentId: pending.paymentIntentId, paymentId: pending.paymentId })
        : await attachLocalStoreOwnedPix({ storeId, paymentIntentId: pending.paymentIntentId, paymentId: pending.paymentId });
      patchPix(order.id, {
        loading: false,
        error: '',
        checkout,
        copied: false,
        boundProvider: provider,
        confirmedCredit: false,
        couponCode,
      });
      await refresh(true);
    } catch (caught) {
      patchPix(order.id, {
        loading: false,
        error: caught instanceof Error ? caught.message : 'Não foi possível preparar o Pix deste pedido.',
      });
      await refresh(true);
    }
  }, [appliedCouponCode, patchPix, pixByOrder, refresh, requestedAmount, storeId]);

  const confirmStorePix = useCallback(async (
    orderId: string,
    checkout: Extract<LocalPixCheckout, { provider: 'store-pix' }>
  ): Promise<void> => {
    const state = pixByOrder[orderId];
    if (!state?.confirmedCredit) return;
    patchPix(orderId, { loading: true, error: '' });
    try {
      await confirmLocalStoreOwnedPix({
        storeId,
        paymentIntentId: checkout.paymentIntentId,
        paymentId: checkout.paymentId,
        providerPaymentId: checkout.providerPaymentId,
      });
      patchPix(orderId, {
        loading: false,
        checkout: null,
        copied: false,
        confirmedCredit: false,
        boundProvider: '',
        couponCode: '',
      });
      await refresh(true);
    } catch (caught) {
      patchPix(orderId, {
        loading: false,
        error: caught instanceof Error ? caught.message : 'Não foi possível registrar a confirmação manual do Pix.',
      });
      await refresh(true);
    }
  }, [patchPix, pixByOrder, refresh, storeId]);

  const copyPixCode = useCallback(async (orderId: string, code: string): Promise<void> => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      patchPix(orderId, { copied: true, error: '' });
    } catch {
      patchPix(orderId, { copied: false, error: 'Não foi possível copiar o código Pix automaticamente.' });
    }
  }, [patchPix]);

  useEffect(() => {
    void refresh();
    void refreshOptions();
    if (!storeId || orders.length === 0) return;
    const timer = window.setInterval(() => void refresh(true), 10000);
    return () => window.clearInterval(timer);
  }, [refresh, refreshOptions, storeId, orders.length]);

  if (orders.length === 0) return null;

  return (
    <section id="service-location-financial-context" className="mt-5 rounded-2xl border border-indigo-500/20 bg-indigo-500/[0.04] p-3">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />
        <div>
          <h3 className="text-[9px] font-black uppercase text-indigo-100">Evidência financeira canônica</h3>
          <p className="mt-1 text-[8px] leading-relaxed text-indigo-100/55">
            Dinheiro confirmado e liquidação por itens são estados separados. Mercado Pago usa webhook verificado; Pix próprio usa declaração manual auditada do operador. `paidQuantity` continua reservado à alocação explícita das linhas.
          </p>
        </div>
      </div>

      {loading && <div className="mt-3 flex items-center gap-2 text-[8px] text-slate-500"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />Conferindo evidência financeira…</div>}
      {error && <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[8px] text-amber-100"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</div>}

      <div className="mt-3 space-y-2">
        {orders.map(order => {
          const context = contexts[order.id];
          const pix = pixByOrder[order.id] ?? emptyPixState();
          const visibleCheckout = context && canOperatePix(context) ? pix.checkout : null;
          const safeTicketUrl = visibleCheckout?.provider === 'mercado-pago' && visibleCheckout.ticketUrl.startsWith('https://') ? visibleCheckout.ticketUrl : '';
          const mercadoPagoAvailable = options?.mercadoPagoConnected === true;
          const storePixAvailable = options?.storePixEnabled === true;
          const couponApplied = Boolean(visibleCheckout && pix.couponCode.trim());
          const selectedForPix = targetOrderIds.length === 0 || (targetOrderIds.length === 1 && targetOrderIds[0] === order.id);
          const couponSubtotal = couponApplied && context ? context.canonicalProjection.expectedAmount : 0;
          const couponDiscount = couponApplied && visibleCheckout ? Number(Math.max(0, couponSubtotal - visibleCheckout.amount).toFixed(2)) : 0;
          return (
            <article key={order.id} className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="flex items-center gap-1.5 text-[8px] text-slate-500"><CreditCard className="h-3.5 w-3.5" />Pedido {order.id.slice(-8)}</span>
                  <strong className="mt-1 block text-[9px] text-white">{context ? stateLabel(context) : 'Aguardando leitura financeira'}</strong>
                </div>
                {context && <span className="shrink-0 font-mono text-[9px] text-indigo-100">{money(context.canonicalProjection.authoritativelyPaidAmount)} / {money(context.canonicalProjection.expectedAmount)}</span>}
              </div>

              {context && (
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-white/5 pt-2 text-[7px] text-slate-600">
                  <span>{context.canonicalProjection.canonicalPaymentCount} pagamento(s) canônico(s)</span>
                  <span>{context.canonicalProjection.pendingPaymentCount} pendente(s)</span>
                  <span>Liquidação por itens: {context.lineSettlement.status}</span>
                  {context.ignoredLegacyMirrorCount > 0 && <span>{context.ignoredLegacyMirrorCount} espelho(s) legado(s) ignorado(s)</span>}
                  {context.lineSettlementConsistency === 'canonical_ahead' && <span className="font-bold text-cyan-300">Pagamento canônico confirmado; alocação por item continua independente</span>}
                  {context.state === 'reconciliation_required' && <span className="font-bold text-amber-300">Conciliação necessária entre evidência financeira e liquidação por item</span>}
                </div>
              )}

              {context && canOperatePix(context) && (
                <div className="mt-3 border-t border-white/5 pt-3">
                  {targetOrderIds.length > 1 && <p className="mb-2 text-[8px] text-amber-200/75">Para Pix parcial, selecione itens de um único pedido por vez.</p>}
                  {selectedForPix && requestedAmount > 0 && <p className="mb-2 text-[8px] text-emerald-200/75">Valor solicitado nesta cobrança: {money(requestedAmount)}.</p>}
                  <div className="flex flex-wrap gap-2">
                    {mercadoPagoAvailable && <button type="button" disabled={!selectedForPix || pix.loading || Boolean(pix.boundProvider && pix.boundProvider !== 'mercado-pago')} onClick={() => void preparePix(order, context, 'mercado-pago')} className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/25 bg-sky-500/10 px-2.5 py-1.5 text-[8px] font-bold text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50">{pix.loading && pix.boundProvider === 'mercado-pago' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <QrCode className="h-3.5 w-3.5" />}Mercado Pago</button>}
                    {storePixAvailable && <button type="button" disabled={!selectedForPix || pix.loading || Boolean(pix.boundProvider && pix.boundProvider !== 'store-pix')} onClick={() => void preparePix(order, context, 'store-pix')} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1.5 text-[8px] font-bold text-emerald-100 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50">{pix.loading && pix.boundProvider === 'store-pix' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <QrCode className="h-3.5 w-3.5" />}Pix próprio</button>}
                  </div>
                  {options && !mercadoPagoAvailable && !storePixAvailable && <p className="mt-2 text-[8px] leading-relaxed text-amber-200/75">Nenhum modo Pix está ativo. Configure Recebimentos em Integrações antes de gerar a cobrança.</p>}
                </div>
              )}

              {pix.error && <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-2 text-[8px] text-amber-100"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{pix.error}</div>}

              {visibleCheckout && (
                <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <strong className="text-[9px] text-emerald-100">Pix aguardando confirmação · {providerLabel(visibleCheckout.provider)}</strong>
                      <p className="mt-0.5 text-[7px] text-emerald-100/55">{money(visibleCheckout.amount)}{expiryLabel(visibleCheckout.expiresAt) ? ` · tentativa Kyrub válida até ${expiryLabel(visibleCheckout.expiresAt)}` : ''}</p>
                    </div>
                    <QrCode className="h-4 w-4 text-emerald-300" />
                  </div>

                  {couponApplied && (
                    <div className="mt-3 rounded-lg border border-violet-400/20 bg-violet-500/[0.08] p-2.5">
                      <div className="flex items-center gap-1.5 text-[8px] font-bold text-violet-100"><TicketPercent className="h-3.5 w-3.5" />Cupom {pix.couponCode.trim().toUpperCase()} aplicado</div>
                      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[8px]">
                        <dt className="text-slate-500">Subtotal</dt><dd className="text-right font-mono text-slate-200">{money(couponSubtotal)}</dd>
                        <dt className="text-violet-200/70">Desconto</dt><dd className="text-right font-mono font-bold text-violet-200">− {money(couponDiscount)}</dd>
                        <dt className="border-t border-white/10 pt-1 font-bold text-emerald-100">Total Pix</dt><dd className="border-t border-white/10 pt-1 text-right font-mono font-black text-emerald-100">{money(visibleCheckout.amount)}</dd>
                      </dl>
                      <p className="mt-1.5 text-[7px] leading-relaxed text-violet-100/50">O total do Pix veio da cobrança autoritativa criada pelo servidor. Este quadro apenas apresenta a composição ao operador.</p>
                    </div>
                  )}

                  {visibleCheckout.qrCodeBase64 && <img src={qrImageSource(visibleCheckout.qrCodeBase64)} alt="QR Code Pix" className="mx-auto mt-3 h-40 w-40 rounded-lg bg-white p-2" />}

                  {visibleCheckout.qrCode && (
                    <div className="mt-3">
                      <label className="text-[7px] font-bold uppercase tracking-wide text-emerald-100/60">Pix copia e cola</label>
                      <textarea readOnly value={visibleCheckout.qrCode} rows={3} className="mt-1 w-full resize-none rounded-lg border border-white/10 bg-black/30 p-2 font-mono text-[7px] text-emerald-50 outline-none" />
                      <button type="button" onClick={() => void copyPixCode(order.id, visibleCheckout.qrCode)} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1.5 text-[8px] font-bold text-emerald-100 hover:bg-emerald-500/20"><Copy className="h-3.5 w-3.5" />{pix.copied ? 'Código copiado' : 'Copiar código Pix'}</button>
                    </div>
                  )}

                  {safeTicketUrl && <a href={safeTicketUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[7px] font-bold text-emerald-200 underline decoration-emerald-400/30 underline-offset-2">Abrir comprovante/QR do Mercado Pago<ExternalLink className="h-3 w-3" /></a>}

                  {visibleCheckout.provider === 'mercado-pago' ? (
                    <p className="mt-3 text-[7px] leading-relaxed text-emerald-100/55">O pedido não é marcado como pago por gerar o QR. A evidência financeira só muda após o webhook verificado do Mercado Pago.</p>
                  ) : (
                    <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.08] p-2.5">
                      <p className="text-[8px] font-bold text-amber-100">Confirmação manual — o Kyrub não consultou o banco.</p>
                      <p className="mt-1 text-[7px] leading-relaxed text-amber-100/70">Confira o crédito na conta ou no aplicativo da instituição recebedora. Só então declare o recebimento abaixo. A identidade do operador, o valor canônico e o horário ficam auditados.</p>
                      <label className="mt-2 flex items-start gap-2 text-[8px] text-amber-50"><input type="checkbox" checked={pix.confirmedCredit} onChange={event => patchPix(order.id, { confirmedCredit: event.target.checked })} disabled={pix.loading} className="mt-0.5" /><span>Conferi na conta recebedora e confirmo que este crédito foi recebido.</span></label>
                      <button type="button" disabled={pix.loading || !pix.confirmedCredit} onClick={() => void confirmStorePix(order.id, visibleCheckout)} className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-amber-300 px-3 text-[8px] font-black uppercase text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">{pix.loading && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}Confirmar recebimento manualmente</button>
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <p className="mt-3 text-[8px] leading-relaxed text-slate-600">O valor da cobrança é calculado no servidor pela base cobrável das linhas. A interface envia apenas IDs opacos e, opcionalmente, o código do cupom; nunca informa valor, e-mail do pagador, `paymentStatus` ou `paidQuantity`.</p>
    </section>
  );
}
