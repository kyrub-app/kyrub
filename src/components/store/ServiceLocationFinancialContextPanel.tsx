import { useCallback, useEffect, useState } from 'react';
import { CircleAlert, CreditCard, LoaderCircle, ShieldCheck } from 'lucide-react';
import type { LocalOrderFinancialContext } from '../../../shared/localOrderFinancialContext';
import type { CustomerOrder } from '../../utils/customerOrders';
import { loadLocalOrderFinancialContext } from '../../utils/localOrderFinancialContext';

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

export function ServiceLocationFinancialContextPanel({
  storeId,
  orders,
}: {
  storeId: string;
  orders: CustomerOrder[];
}) {
  const [contexts, setContexts] = useState<Record<string, LocalOrderFinancialContext>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
            Leitura de pagamentos canônicos vinculados aos pedidos deste local. Espelhos legados não comprovam quitação e são ignorados no valor confirmado.
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
            </article>
          );
        })}
      </div>

      <p className="mt-3 text-[8px] leading-relaxed text-slate-600">
        Esta área é somente leitura. Não registra recebimento, não altera `paymentStatus` ou `paidQuantity` e não chama PSP.
      </p>
    </section>
  );
}
