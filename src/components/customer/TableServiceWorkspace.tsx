import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import {
  ArrowRightLeft,
  Check,
  ChevronLeft,
  CreditCard,
  Minus,
  Plus,
  ReceiptText,
  Send,
  Utensils,
  WalletCards,
  X,
} from 'lucide-react';
import type { Product } from '../../types';
import { auth } from '../../utils/firebase';
import {
  getCustomerOrderStatusLabel,
  type CustomerOrder,
} from '../../utils/customerOrders';
import {
  createStaffTableOrder,
  getActiveTableOrders,
  getTableOpenLines,
  getTableOutstandingTotal,
  getTablePaymentMethodLabel,
  registerTablePayment,
  transferTableItems,
  type StaffTableCartItem,
  type TableItemSelection,
  type TableOpenLine,
  type TablePaymentMethod,
} from '../../utils/tableOperations';
import { SharedPdvCatalog } from '../pdv/SharedPdvCatalog';

interface TableServiceWorkspaceProps {
  storeId: string;
  tableCode: string;
  products: Product[];
  keywords: string[];
  accentColor?: string;
  orders: CustomerOrder[];
  onClose: () => void;
  notify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

type WorkspaceTab = 'catalog' | 'account' | 'transfer';

type CartEntry = {
  product: Product;
  quantity: number;
  note: string;
};

const CONFIRMED_SALE_STATUSES = new Set<CustomerOrder['status']>([
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
]);

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);

const selectionToArray = (
  values: Record<string, number>,
  lines: TableOpenLine[]
): TableItemSelection[] =>
  lines.flatMap(line => {
    const quantity = values[line.key] ?? 0;
    return quantity > 0
      ? [{ orderId: line.orderId, lineId: line.lineId, quantity }]
      : [];
  });

const SelectionList = ({
  lines,
  selections,
  setSelections,
  emptyMessage,
}: {
  lines: TableOpenLine[];
  selections: Record<string, number>;
  setSelections: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  emptyMessage: string;
}) => {
  const updateQuantity = (line: TableOpenLine, quantity: number): void => {
    const safeQuantity = Math.max(0, Math.min(line.availableQuantity, quantity));
    setSelections(previous => ({
      ...previous,
      [line.key]: safeQuantity,
    }));
  };

  if (lines.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-950/60 px-4 py-10 text-center text-xs text-slate-500">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {lines.map(line => {
        const selected = selections[line.key] ?? 0;
        return (
          <article
            key={line.key}
            className={`rounded-2xl border p-3 transition-colors ${
              selected > 0
                ? 'border-orange-500/50 bg-orange-500/10'
                : 'border-slate-800 bg-slate-950'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                onClick={() =>
                  updateQuantity(line, selected > 0 ? 0 : line.availableQuantity)
                }
                className="min-w-0 flex-1 text-left"
              >
                <strong className="block truncate text-xs text-white">
                  {line.name}
                </strong>
                <span className="mt-1 block text-[10px] text-slate-500">
                  {line.buyerName} · {getCustomerOrderStatusLabel(line.orderStatus)}
                </span>
                {line.note && (
                  <span className="mt-1 block text-[10px] italic text-amber-300">
                    Obs.: {line.note}
                  </span>
                )}
              </button>
              <div className="text-right">
                <span className="block font-mono text-xs font-bold text-white">
                  {formatCurrency(line.price)}
                </span>
                <span className="text-[9px] text-slate-600">
                  {line.availableQuantity} disponível(is)
                </span>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3">
              <button
                type="button"
                onClick={() =>
                  updateQuantity(line, selected > 0 ? 0 : line.availableQuantity)
                }
                className={`flex h-7 w-7 items-center justify-center rounded-lg border ${
                  selected > 0
                    ? 'border-orange-500 bg-orange-500 text-slate-950'
                    : 'border-slate-700 bg-slate-900 text-slate-500'
                }`}
                aria-label={`Selecionar ${line.name}`}
              >
                {selected > 0 && <Check className="h-3.5 w-3.5" />}
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => updateQuantity(line, selected - 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-slate-400 hover:text-white"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="min-w-6 text-center font-mono text-xs font-black text-white">
                  {selected}
                </span>
                <button
                  type="button"
                  onClick={() => updateQuantity(line, selected + 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-slate-400 hover:text-white"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
};

export const TableServiceWorkspace = ({
  storeId,
  tableCode,
  products,
  keywords,
  accentColor = '#f97316',
  orders,
  onClose,
  notify,
}: TableServiceWorkspaceProps) => {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('catalog');
  const [isOrderReviewOpen, setIsOrderReviewOpen] = useState(false);
  const [cart, setCart] = useState<Record<string, CartEntry>>({});
  const [buyerName, setBuyerName] = useState('Atendimento presencial');
  const [customerNote, setCustomerNote] = useState('');
  const [paymentSelections, setPaymentSelections] = useState<Record<string, number>>({});
  const [transferSelections, setTransferSelections] = useState<Record<string, number>>({});
  const [paymentMethod, setPaymentMethod] = useState<TablePaymentMethod>('cash');
  const [targetTableCode, setTargetTableCode] = useState('');
  const [busyAction, setBusyAction] = useState<'' | 'order' | 'payment' | 'transfer'>('');

  useEffect(() => {
    setActiveTab('catalog');
    setIsOrderReviewOpen(false);
    setCart({});
    setBuyerName('Atendimento presencial');
    setCustomerNote('');
    setPaymentSelections({});
    setTransferSelections({});
    setTargetTableCode('');
  }, [tableCode]);

  const storeProducts = useMemo(
    () =>
      products.filter(
        product =>
          product.supplierId === storeId && product.wholesalePrice === undefined
      ),
    [products, storeId]
  );

  const activeOrders = useMemo(
    () => getActiveTableOrders(orders, tableCode),
    [orders, tableCode]
  );
  const openLines = useMemo(
    () => getTableOpenLines(orders, tableCode),
    [orders, tableCode]
  );
  const outstandingTotal = useMemo(
    () => getTableOutstandingTotal(orders, tableCode),
    [orders, tableCode]
  );
  const salesByProductId = useMemo(() => {
    const next: Record<string, number> = {};
    for (const order of orders) {
      if (!CONFIRMED_SALE_STATUSES.has(order.status)) continue;
      for (const item of order.items) {
        next[item.productId] = (next[item.productId] ?? 0) + item.quantity;
      }
    }
    return next;
  }, [orders]);

  const cartEntries = Object.values(cart);
  const cartQuantity = cartEntries.reduce((sum, entry) => sum + entry.quantity, 0);
  const cartTotal = cartEntries.reduce(
    (sum, entry) => sum + entry.product.price * entry.quantity,
    0
  );
  const paymentSelectionArray = selectionToArray(paymentSelections, openLines);
  const transferSelectionArray = selectionToArray(transferSelections, openLines);
  const selectedPaymentTotal = openLines.reduce(
    (sum, line) => sum + (paymentSelections[line.key] ?? 0) * line.price,
    0
  );
  const selectedTransferTotal = openLines.reduce(
    (sum, line) => sum + (transferSelections[line.key] ?? 0) * line.price,
    0
  );

  const addProduct = (product: Product): void => {
    setCart(previous => {
      const current = previous[product.id];
      return {
        ...previous,
        [product.id]: {
          product,
          quantity: (current?.quantity ?? 0) + 1,
          note: current?.note ?? '',
        },
      };
    });
  };

  const updateCartQuantity = (productId: string, quantity: number): void => {
    setCart(previous => {
      if (quantity <= 0) {
        const next = { ...previous };
        delete next[productId];
        return next;
      }
      const current = previous[productId];
      if (!current) return previous;
      return {
        ...previous,
        [productId]: { ...current, quantity },
      };
    });
  };

  const updateCartNote = (productId: string, note: string): void => {
    setCart(previous => {
      const current = previous[productId];
      if (!current) return previous;
      return {
        ...previous,
        [productId]: { ...current, note },
      };
    });
  };

  const handleSendToKds = async (): Promise<void> => {
    const user = auth.currentUser;
    if (!user) {
      notify('Faça login novamente para enviar o pedido.', 'error');
      return;
    }

    setBusyAction('order');
    try {
      const items: StaffTableCartItem[] = cartEntries.map(entry => ({
        product: entry.product,
        quantity: entry.quantity,
        note: entry.note,
      }));
      await createStaffTableOrder(user, {
        storeId,
        tableCode,
        buyerName,
        customerNote,
        items,
      });
      setCart({});
      setCustomerNote('');
      setIsOrderReviewOpen(false);
      notify(`Pedido da mesa ${tableCode} enviado ao KDS.`, 'success');
      setActiveTab('account');
    } catch (error) {
      notify(
        error instanceof Error ? error.message : 'Não foi possível enviar o pedido.',
        'error'
      );
    } finally {
      setBusyAction('');
    }
  };

  const handleRegisterPayment = async (): Promise<void> => {
    const user = auth.currentUser;
    if (!user) {
      notify('Faça login novamente para fechar a conta.', 'error');
      return;
    }

    setBusyAction('payment');
    try {
      const result = await registerTablePayment(user, {
        storeId,
        tableCode,
        selections: paymentSelectionArray,
        method: paymentMethod,
      });
      setPaymentSelections({});
      notify(
        `${formatCurrency(result.amount)} registrado em ${getTablePaymentMethodLabel(paymentMethod)}.`,
        'success'
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : 'Não foi possível registrar o pagamento.',
        'error'
      );
    } finally {
      setBusyAction('');
    }
  };

  const handleTransferItems = async (): Promise<void> => {
    const user = auth.currentUser;
    if (!user) {
      notify('Faça login novamente para transferir itens.', 'error');
      return;
    }

    setBusyAction('transfer');
    try {
      const result = await transferTableItems(user, {
        storeId,
        sourceTableCode: tableCode,
        targetTableCode,
        selections: transferSelectionArray,
      });
      setTransferSelections({});
      setTargetTableCode('');
      notify(
        `${result.quantity} item(ns) transferido(s) para a mesa ${targetTableCode.trim()}.`,
        'success'
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : 'Não foi possível transferir os itens.',
        'error'
      );
    } finally {
      setBusyAction('');
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-slate-950/90 backdrop-blur-sm">
      <div className="relative mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden bg-slate-900 shadow-2xl lg:my-4 lg:h-[calc(100%-2rem)] lg:rounded-3xl lg:border lg:border-slate-800">
        <header className="border-b border-slate-800 bg-slate-900/95 px-4 py-3 backdrop-blur-sm sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-400 hover:text-white lg:hidden"
                aria-label="Fechar atendimento"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-orange-500 text-slate-950">
                <Utensils className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-orange-400">
                  Atendimento presencial
                </span>
                <h2 className="truncate text-lg font-black text-white">
                  Mesa {tableCode}
                </h2>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right">
                <span className="block font-mono text-[8px] uppercase text-slate-600">
                  Saldo aberto
                </span>
                <strong className="font-mono text-sm text-white sm:text-base">
                  {formatCurrency(outstandingTotal)}
                </strong>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="hidden h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-400 hover:text-white lg:flex"
                aria-label="Fechar atendimento"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>

        {activeTab === 'catalog' && (
          <main className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5" id="staff-shared-pdv-view">
            <SharedPdvCatalog
              idPrefix="staff-pdv"
              resetKey={`${storeId}:${tableCode}`}
              products={storeProducts}
              keywords={keywords}
              selectedItems={cartEntries}
              onAddProduct={addProduct}
              accentColor={accentColor}
              salesByProductId={salesByProductId}
              emptySelectionMessage="Selecione produtos para montar o pedido da mesa."
              emptyCatalogMessage="Nenhum produto foi cadastrado no PDV desta loja."
              primaryAction={{
                onClick: () => setIsOrderReviewOpen(true),
                disabled: cartEntries.length === 0,
                label: 'Revisar e enviar o pedido da mesa ao KDS',
                title: 'Revisar pedido',
              }}
              secondaryAction={{
                onClick: () => setActiveTab('account'),
                label: 'Abrir conta e operações da mesa',
                title: 'Conta da mesa',
              }}
            />
          </main>
        )}

        {activeTab === 'account' && (
          <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6" id="staff-pdv-account-view">
            <div className="mx-auto max-w-5xl">
              <div className="mb-4 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setActiveTab('catalog')}
                  className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] font-black uppercase text-slate-300 hover:text-white"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Voltar ao PDV
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('transfer')}
                  className="flex min-h-10 items-center gap-2 rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 text-[10px] font-black uppercase text-blue-300"
                >
                  <ArrowRightLeft className="h-4 w-4" />
                  Transferir
                </button>
              </div>

              <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
                <section className="space-y-4">
                  <div>
                    <span className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-orange-400">
                      Fechamento seletivo
                    </span>
                    <h3 className="mt-1 text-base font-black text-white">
                      Selecione os itens que serão pagos agora
                    </h3>
                    <p className="mt-1 text-[11px] text-slate-500">
                      É possível receber apenas parte da conta. Os itens quitados deixam o saldo da mesa.
                    </p>
                  </div>
                  <SelectionList
                    lines={openLines}
                    selections={paymentSelections}
                    setSelections={setPaymentSelections}
                    emptyMessage="Não há itens pendentes de pagamento nesta mesa."
                  />
                </section>

                <aside className="h-fit space-y-4 rounded-3xl border border-slate-800 bg-slate-950 p-4 lg:sticky lg:top-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black uppercase text-white">Resumo</span>
                    <WalletCards className="h-5 w-5 text-orange-400" />
                  </div>
                  <div className="space-y-2 rounded-2xl bg-slate-900 p-3 text-xs">
                    <div className="flex justify-between text-slate-500">
                      <span>Pedidos ativos</span>
                      <span>{activeOrders.length}</span>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>Saldo da mesa</span>
                      <span>{formatCurrency(outstandingTotal)}</span>
                    </div>
                    <div className="flex justify-between border-t border-slate-800 pt-2 font-black text-white">
                      <span>Selecionado</span>
                      <span>{formatCurrency(selectedPaymentTotal)}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {(['cash', 'pix', 'card', 'other'] as TablePaymentMethod[]).map(method => (
                      <button
                        key={method}
                        type="button"
                        onClick={() => setPaymentMethod(method)}
                        className={`rounded-xl border px-3 py-2 text-[9px] font-black uppercase ${
                          paymentMethod === method
                            ? 'border-orange-500 bg-orange-500 text-slate-950'
                            : 'border-slate-800 bg-slate-900 text-slate-500'
                        }`}
                      >
                        {getTablePaymentMethodLabel(method)}
                      </button>
                    ))}
                  </div>

                  <p className="text-[9px] leading-relaxed text-slate-600">
                    Este botão registra um recebimento presencial no PDV; ele não processa transações bancárias.
                  </p>

                  <button
                    type="button"
                    disabled={paymentSelectionArray.length === 0 || busyAction === 'payment'}
                    onClick={() => void handleRegisterPayment()}
                    className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-[10px] font-black uppercase text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <CreditCard className="h-4 w-4" />
                    {busyAction === 'payment' ? 'Registrando...' : 'Registrar pagamento'}
                  </button>
                </aside>
              </div>
            </div>
          </main>
        )}

        {activeTab === 'transfer' && (
          <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6" id="staff-pdv-transfer-view">
            <div className="mx-auto max-w-5xl">
              <div className="mb-4 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setActiveTab('account')}
                  className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] font-black uppercase text-slate-300 hover:text-white"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Voltar à conta
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('catalog')}
                  className="flex min-h-10 items-center gap-2 rounded-xl border border-orange-500/30 bg-orange-500/10 px-3 text-[10px] font-black uppercase text-orange-300"
                >
                  <ReceiptText className="h-4 w-4" />
                  Abrir PDV
                </button>
              </div>

              <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
                <section className="space-y-4">
                  <div>
                    <span className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-orange-400">
                      Transferência de consumo
                    </span>
                    <h3 className="mt-1 text-base font-black text-white">
                      Selecione os itens que mudarão de mesa
                    </h3>
                    <p className="mt-1 text-[11px] text-slate-500">
                      O estágio atual de produção é preservado na mesa de destino.
                    </p>
                  </div>
                  <SelectionList
                    lines={openLines}
                    selections={transferSelections}
                    setSelections={setTransferSelections}
                    emptyMessage="Não há itens disponíveis para transferência."
                  />
                </section>

                <aside className="h-fit space-y-4 rounded-3xl border border-slate-800 bg-slate-950 p-4 lg:sticky lg:top-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black uppercase text-white">Destino</span>
                    <ArrowRightLeft className="h-5 w-5 text-orange-400" />
                  </div>
                  <input
                    type="text"
                    value={targetTableCode}
                    onChange={event => setTargetTableCode(event.target.value)}
                    placeholder="Mesa ou código de destino"
                    className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-3 text-xs text-white focus:border-orange-500 focus:outline-none"
                  />
                  <div className="rounded-2xl bg-slate-900 p-3 text-xs">
                    <div className="flex justify-between text-slate-500">
                      <span>Itens selecionados</span>
                      <span>
                        {transferSelectionArray.reduce((sum, item) => sum + item.quantity, 0)}
                      </span>
                    </div>
                    <div className="mt-2 flex justify-between border-t border-slate-800 pt-2 font-black text-white">
                      <span>Valor transferido</span>
                      <span>{formatCurrency(selectedTransferTotal)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={
                      transferSelectionArray.length === 0 ||
                      !targetTableCode.trim() ||
                      busyAction === 'transfer'
                    }
                    onClick={() => void handleTransferItems()}
                    className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-[10px] font-black uppercase text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ArrowRightLeft className="h-4 w-4" />
                    {busyAction === 'transfer' ? 'Transferindo...' : 'Transferir itens'}
                  </button>
                </aside>
              </div>
            </div>
          </main>
        )}

        <footer className="flex items-center justify-between border-t border-slate-800 bg-slate-950 px-4 py-2 text-[9px] text-slate-600 sm:px-6">
          <span>
            {activeOrders.length} pedido(s) ativo(s) · {openLines.length} linha(s) em aberto
          </span>
          <span className="font-mono">Mesa {tableCode}</span>
        </footer>

        {isOrderReviewOpen && (
          <div
            className="absolute inset-0 z-20 flex items-end justify-center bg-slate-950/85 backdrop-blur-sm sm:items-center sm:p-5"
            role="presentation"
            onClick={() => busyAction !== 'order' && setIsOrderReviewOpen(false)}
          >
            <section
              className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-3xl border border-slate-800 bg-slate-900 p-4 shadow-2xl sm:rounded-3xl sm:p-5"
              role="dialog"
              aria-modal="true"
              aria-labelledby="staff-order-review-title"
              onClick={event => event.stopPropagation()}
              id="staff-pdv-order-review"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="font-mono text-[9px] font-black uppercase tracking-[0.18em] text-orange-400">
                    Pedido da mesa {tableCode}
                  </span>
                  <h3 id="staff-order-review-title" className="mt-1 text-lg font-black text-white">
                    Revisar antes de enviar ao KDS
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOrderReviewOpen(false)}
                  disabled={busyAction === 'order'}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-500 hover:text-white disabled:opacity-40"
                  aria-label="Fechar revisão do pedido"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 space-y-2">
                {cartEntries.map(entry => (
                  <article
                    key={entry.product.id}
                    className="rounded-2xl border border-slate-800 bg-slate-950 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <strong className="block truncate text-xs text-white">
                          {entry.product.name}
                        </strong>
                        <span className="font-mono text-[10px] text-slate-500">
                          {formatCurrency(entry.product.price * entry.quantity)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            updateCartQuantity(entry.product.id, entry.quantity - 1)
                          }
                          className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-slate-400"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="min-w-5 text-center font-mono text-xs text-white">
                          {entry.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            updateCartQuantity(entry.product.id, entry.quantity + 1)
                          }
                          className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-slate-400"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <input
                      type="text"
                      value={entry.note}
                      onChange={event =>
                        updateCartNote(entry.product.id, event.target.value)
                      }
                      placeholder="Observação do item"
                      className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[10px] text-white focus:border-orange-500 focus:outline-none"
                    />
                  </article>
                ))}
              </div>

              <div className="mt-4 space-y-3 border-t border-slate-800 pt-4">
                <input
                  type="text"
                  value={buyerName}
                  onChange={event => setBuyerName(event.target.value)}
                  placeholder="Nome do cliente (opcional)"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-orange-500 focus:outline-none"
                />
                <textarea
                  value={customerNote}
                  onChange={event => setCustomerNote(event.target.value)}
                  rows={2}
                  placeholder="Observação geral (opcional)"
                  className="w-full resize-none rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-orange-500 focus:outline-none"
                />
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <span className="block font-mono text-[8px] uppercase text-slate-600">
                      Total deste envio
                    </span>
                    <strong className="font-mono text-lg text-white">
                      {formatCurrency(cartTotal)}
                    </strong>
                  </div>
                  <button
                    type="button"
                    disabled={cartEntries.length === 0 || busyAction === 'order'}
                    onClick={() => void handleSendToKds()}
                    className="flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-[10px] font-black uppercase text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                    {busyAction === 'order' ? 'Enviando...' : 'Enviar ao KDS'}
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
};
