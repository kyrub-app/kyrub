import { useEffect, useMemo, useState } from 'react';
import { QrCode, X } from 'lucide-react';
import { resolveOrderServiceLocation } from '../../../shared/serviceLocation';
import {
  getCustomerOrderOutstandingTotal,
  isTerminalCustomerOrderStatus,
  subscribeToStoreCustomerOrders,
  type CustomerOrder,
} from '../../utils/customerOrders';
import { auth } from '../../utils/firebase';
import { getActiveTableOrders } from '../../utils/tableOperations';
import { ServiceLocationFinancialContextPanel } from './ServiceLocationFinancialContextPanel';

interface TablePixSelection {
  storeId: string;
  tableCode: string;
}

const normalized = (value: string): string =>
  value.trim().toLocaleLowerCase('pt-BR');

const buttonLabel = (button: HTMLButtonElement): string =>
  normalized(button.textContent ?? '');

const tableCodeFromAccount = (account: Element): string => {
  const workspace = account.closest('.fixed');
  if (!workspace) return '';
  const heading = Array.from(workspace.querySelectorAll('h2')).find(node =>
    /^mesa\s+/iu.test(node.textContent?.trim() ?? '')
  );
  return (heading?.textContent ?? '').replace(/^mesa\s+/iu, '').trim();
};

const pixButtonFromAccount = (account: Element): HTMLButtonElement | null =>
  Array.from(account.querySelectorAll<HTMLButtonElement>('button')).find(
    button => buttonLabel(button) === 'pix'
  ) ?? null;

const pixIsSelected = (account: Element): boolean => {
  const button = pixButtonFromAccount(account);
  if (!button) return false;
  return button.className.includes('bg-orange-500');
};

const selectedOrdersForTable = (
  orders: CustomerOrder[],
  tableCode: string
): CustomerOrder[] => {
  const direct = getActiveTableOrders(orders, tableCode);
  if (direct.length > 0) return direct;

  const target = normalized(tableCode);
  return orders.filter(order => {
    if (
      order.fulfillmentType !== 'dine_in' ||
      isTerminalCustomerOrderStatus(order.status) ||
      getCustomerOrderOutstandingTotal(order) <= 0
    ) {
      return false;
    }
    const location = resolveOrderServiceLocation({
      serviceLocation: order.serviceLocation,
      tableCode: order.tableCode,
    });
    return [order.tableCode, location?.label ?? ''].some(
      value => normalized(value) === target
    );
  });
};

export function TablePixCanonicalCheckoutBridge() {
  const [selection, setSelection] = useState<TablePixSelection | null>(null);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const openForAccount = (account: Element): void => {
      const user = auth.currentUser;
      const tableCode = tableCodeFromAccount(account);
      if (!user || !tableCode) return;
      setSelection({ storeId: user.uid, tableCode });
      setMessage('');
    };

    const interceptLegacyTablePix = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>('button');
      if (!button) return;
      const account = button.closest('#staff-pdv-account-view');
      if (!account) return;

      const label = buttonLabel(button);
      if (label === 'pix') {
        openForAccount(account);
        return;
      }

      if (
        (label === 'registrar pagamento' || label === 'registrando...') &&
        pixIsSelected(account)
      ) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        openForAccount(account);
      }
    };

    document.addEventListener('click', interceptLegacyTablePix, true);
    return () => document.removeEventListener('click', interceptLegacyTablePix, true);
  }, []);

  useEffect(() => {
    setOrders([]);
    if (!selection) return;
    return subscribeToStoreCustomerOrders(
      selection.storeId,
      setOrders,
      error => {
        console.warn('Cobrança Pix da mesa indisponível.', error);
        setMessage('Não foi possível atualizar os pedidos desta mesa.');
      }
    );
  }, [selection?.storeId, selection?.tableCode]);

  const activeOrders = useMemo(
    () => selection
      ? selectedOrdersForTable(orders, selection.tableCode)
      : [],
    [orders, selection]
  );

  if (!selection) return null;

  return (
    <div className="fixed inset-0 z-[160] flex items-end justify-center bg-slate-950/90 backdrop-blur-sm sm:items-center sm:p-5">
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
                Pix canônico · Mesa {selection.tableCode}
              </span>
              <h2 id="staff-table-canonical-pix-title" className="mt-1 text-xl font-black text-white">
                Gerar QR Code sem baixar a mesa antes do pagamento
              </h2>
              <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                O valor da cobrança é relido no servidor por pedido. Gerar ou exibir o Pix não altera `paidQuantity`, não fecha a mesa e não declara o pedido pago.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSelection(null)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-400 hover:text-white"
            aria-label="Fechar cobrança Pix"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-2.5 text-[9px] leading-relaxed text-emerald-100/75">
          A confirmação de pagamento continua pertencendo ao webhook verificado do provedor. Se a mesa tiver mais de um pedido ativo, cada pedido é cobrado separadamente para preservar a autoridade financeira e a idempotência.
        </div>

        {message && (
          <p className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[9px] text-amber-100" role="status">
            {message}
          </p>
        )}

        {activeOrders.length > 0 ? (
          <ServiceLocationFinancialContextPanel
            storeId={selection.storeId}
            orders={activeOrders}
          />
        ) : (
          <div className="mt-5 rounded-2xl border border-dashed border-slate-800 bg-slate-950/60 px-4 py-8 text-center text-[10px] text-slate-500">
            Não há pedido ativo com saldo aberto nesta mesa para gerar Pix.
          </div>
        )}
      </section>
    </div>
  );
}
