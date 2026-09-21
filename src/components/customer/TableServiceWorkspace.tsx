import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { QrCode, X } from 'lucide-react';
import { TableServiceWorkspace as LegacyTableServiceWorkspace } from './LegacyTableServiceWorkspace';
import { ServiceLocationFinancialContextPanel } from '../store/ServiceLocationFinancialContextPanel';
import {
  getActiveTableOrders,
  getTablePaymentMethodLabel,
} from '../../utils/tableOperations';

type TableServiceWorkspaceProps = Omit<
  React.ComponentProps<typeof LegacyTableServiceWorkspace>,
  'onAppliedCouponChange'
>;

export const TableServiceWorkspace = (props: TableServiceWorkspaceProps) => {
  const [pixCheckoutOpen, setPixCheckoutOpen] = useState(false);
  const [appliedCouponCode, setAppliedCouponCode] = useState('');
  const [paymentDraft, setPaymentDraft] = useState<{ amount: number; orderIds: string[] }>({ amount: 0, orderIds: [] });

  useEffect(() => {
    setPixCheckoutOpen(false);
    setAppliedCouponCode('');
    setPaymentDraft({ amount: 0, orderIds: [] });
  }, [props.storeId, props.tableCode]);

  const activeOrders = useMemo(
    () => getActiveTableOrders(props.orders, props.tableCode),
    [props.orders, props.tableCode]
  );



  const canonicalCheckout = activeOrders.length > 0 ? (
    <ServiceLocationFinancialContextPanel
      storeId={props.storeId}
      orders={activeOrders}
      couponCode={appliedCouponCode}
      requestedAmount={paymentDraft.amount}
      targetOrderIds={paymentDraft.orderIds}
    />
  ) : (
    <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/60 px-4 py-8 text-center text-[10px] text-slate-500">
      Não há pedido ativo com saldo aberto nesta mesa para aplicar cupom ou gerar Pix.
    </div>
  );

  return (
    <>
      <LegacyTableServiceWorkspace
        {...props}
        onAppliedCouponChange={setAppliedCouponCode}
        onPaymentDraftChange={setPaymentDraft}
        onPixRequested={() => setPixCheckoutOpen(true)}
      />


      {pixCheckoutOpen && (
        <div className="fixed inset-0 z-[150] flex items-end justify-center bg-slate-950/90 backdrop-blur-sm sm:items-center sm:p-5">
          <section
            id="staff-table-canonical-pix-checkout"
            className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl border border-indigo-500/25 bg-slate-900 p-4 shadow-2xl sm:rounded-3xl sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="staff-table-canonical-pix-title"
          >
            <header className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-500 text-white">
                  <QrCode className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <span className="font-mono text-[9px] font-black uppercase tracking-[0.18em] text-indigo-300">
                    Cobrança Pix canônica · Mesa {props.tableCode}
                  </span>
                  <h2 id="staff-table-canonical-pix-title" className="mt-1 text-xl font-black text-white">
                    Gerar QR Code sem baixar a conta antes do pagamento
                  </h2>
                  <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                    O Pix desta tela usa a cobrança canônica do Kyrub. O valor é relido no servidor por pedido; a seleção de itens da tela anterior não define o valor bancário e nenhum item é marcado como pago apenas por gerar o QR Code.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPixCheckoutOpen(false)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-400 hover:text-white"
                aria-label="Fechar cobrança Pix"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-2.5 text-[9px] leading-relaxed text-emerald-100/75">
              A cobrança permanece pendente até a autoridade correspondente ao modo escolhido: webhook verificado no Mercado Pago ou confirmação manual auditada no Pix próprio. Se houver mais de um pedido ativo na mesa, cada pedido aparece separadamente para não somar valores no navegador nem criar uma segunda autoridade financeira.
            </div>

            <div className="mt-5">{canonicalCheckout}</div>
          </section>
        </div>
      )}
    </>
  );
};
