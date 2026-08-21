import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import {
  Check,
  CheckCircle2,
  Clock3,
  MapPin,
  Minus,
  PackageCheck,
  Plus,
  ReceiptText,
  ShoppingCart,
  Store as StoreIcon,
  Truck,
  Utensils,
  WalletCards,
  XCircle,
} from 'lucide-react';
import { B2CCartDrawer as LegacyB2CCartDrawer } from './LegacyB2CCartDrawer';
import { auth } from '../../utils/firebase';
import { initiateMarketplaceCheckout } from '../../utils/marketplaceCheckout';
import {
  buildCustomerOrder,
  getCustomerOrderItemOpenQuantity,
  getCustomerOrderOutstandingTotal,
  getCustomerOrderStatusLabel,
  getFulfillmentLabel,
  loadLastCustomerOrderId,
  persistCustomerOrder,
  saveLastCustomerOrderId,
  subscribeToCustomerOrder,
  type CustomerFulfillmentType,
  type CustomerOrder,
  type CustomerOrderPaymentStatus,
  type CustomerOrderStatus,
} from '../../utils/customerOrders';

type B2CCartDrawerProps = React.ComponentProps<typeof LegacyB2CCartDrawer>;
type DrawerView = 'cart' | 'order' | 'account';

const terminalStatuses: CustomerOrderStatus[] = [
  'completed',
  'rejected',
  'cancelled',
];

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const formatDateTime = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Horário indisponível'
    : new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date);
};

const statusStepsFor = (order: CustomerOrder): CustomerOrderStatus[] =>
  order.fulfillmentType === 'delivery'
    ? ['pending', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'completed']
    : ['pending', 'accepted', 'preparing', 'ready', 'completed'];

const paymentPresentation = (
  paymentStatus: CustomerOrderPaymentStatus
): { label: string; className: string } => {
  if (paymentStatus === 'paid') {
    return {
      label: 'Conta paga',
      className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    };
  }

  if (paymentStatus === 'partial') {
    return {
      label: 'Pagamento parcial',
      className: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    };
  }

  return {
    label: 'Conta em aberto',
    className: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
  };
};

export const B2CCartDrawer: React.FC<B2CCartDrawerProps> = props => {
  const {
    isOpen,
    visitingStore,
    onClose,
    cart,
    updateCartQty,
    buyerName,
    setBuyerName,
    buyerEmail,
    setBuyerEmail,
    buyerAddress,
    setBuyerAddress,
  } = props;

  const [view, setView] = useState<DrawerView>('cart');
  const [fulfillmentType, setFulfillmentType] = useState<
    CustomerFulfillmentType | ''
  >('');
  const [tableCode, setTableCode] = useState('');
  const [customerNote, setCustomerNote] = useState('');
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [trackedOrderId, setTrackedOrderId] = useState('');
  const [currentOrder, setCurrentOrder] = useState<CustomerOrder | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [checkoutNotice, setCheckoutNotice] = useState('');

  const cartItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = useMemo(
    () =>
      cart.reduce(
        (sum, item) => sum + item.product.price * item.quantity,
        0
      ),
    [cart]
  );

  const accountTotals = useMemo(() => {
    if (!currentOrder) {
      return {
        consumed: 0,
        billable: 0,
        paid: 0,
        transferred: 0,
        outstanding: 0,
      };
    }

    const paid = currentOrder.items.reduce(
      (sum, item) => sum + item.paidQuantity * item.price,
      0
    );
    const transferred = currentOrder.items.reduce(
      (sum, item) => sum + item.transferredQuantity * item.price,
      0
    );
    const billable = currentOrder.items.reduce(
      (sum, item) =>
        sum + Math.max(0, item.quantity - item.transferredQuantity) * item.price,
      0
    );

    return {
      consumed: currentOrder.total,
      billable,
      paid,
      transferred,
      outstanding: getCustomerOrderOutstandingTotal(currentOrder),
    };
  }, [currentOrder]);

  useEffect(() => {
    if (!isOpen || !visitingStore) return;
    const user = auth.currentUser;
    if (!user) return;

    if (!buyerName.trim()) setBuyerName(user.displayName ?? '');
    if (!buyerEmail.trim()) setBuyerEmail(user.email ?? '');

    const previousOrderId = loadLastCustomerOrderId(
      localStorage,
      user.uid,
      visitingStore.id
    );
    setTrackedOrderId(previousOrderId);
    setCurrentOrder(null);
    setCheckoutNotice('');
    setView(previousOrderId && cart.length === 0 ? 'order' : 'cart');
  }, [isOpen, visitingStore?.id]);

  useEffect(() => {
    if (!isOpen || !visitingStore || !trackedOrderId) {
      if (!trackedOrderId) setCurrentOrder(null);
      return;
    }

    return subscribeToCustomerOrder(
      visitingStore.id,
      trackedOrderId,
      order => setCurrentOrder(order),
      error => console.warn('Acompanhamento do pedido indisponível.', error)
    );
  }, [isOpen, trackedOrderId, visitingStore?.id]);

  if (!isOpen || !visitingStore) return null;

  const accentColor = visitingStore.primaryColor || '#f97316';
  const currentPaymentPresentation = currentOrder
    ? paymentPresentation(currentOrder.paymentStatus)
    : null;

  const handleCreateOrder = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setFormError('');
    setCheckoutNotice('');

    const user = auth.currentUser;
    if (!user) {
      setFormError('Faça login novamente para enviar o pedido.');
      return;
    }

    setIsSubmitting(true);

    try {
      if (fulfillmentType === 'delivery' || fulfillmentType === 'pickup') {
        const checkout = await initiateMarketplaceCheckout(user, {
          storeId: visitingStore.id,
          buyerName,
          buyerEmail,
          fulfillmentType,
          deliveryAddress: buyerAddress,
          customerNote,
          cart,
          itemNotes,
        });

        setCheckoutNotice(
          checkout.providerReady
            ? 'Pagamento iniciado. O pedido só será enviado à loja depois da confirmação do provedor.'
            : 'Intenção de pagamento criada com segurança. O provedor Pix ainda não está habilitado neste ambiente; nenhum pedido foi enviado à loja.'
        );
        return;
      }

      const order = buildCustomerOrder(user, {
        storeId: visitingStore.id,
        buyerName,
        buyerEmail,
        fulfillmentType,
        deliveryAddress: buyerAddress,
        tableCode,
        customerNote,
        cart,
        itemNotes,
      });

      await persistCustomerOrder(order);
      saveLastCustomerOrderId(
        localStorage,
        user.uid,
        visitingStore.id,
        order.id
      );

      cart.forEach(item => updateCartQty(item.product.id, 0));
      setTrackedOrderId(order.id);
      setCurrentOrder(order);
      setView('order');
      setItemNotes({});
      setCustomerNote('');
      setTableCode('');
      setFulfillmentType('');
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : 'Não foi possível enviar o pedido.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const fulfillmentOptions: Array<{
    id: CustomerFulfillmentType;
    label: string;
    description: string;
    icon: React.ReactNode;
  }> = [
    {
      id: 'delivery',
      label: 'Entrega',
      description: 'Receber no endereço informado',
      icon: <Truck className="h-4 w-4" />,
    },
    {
      id: 'pickup',
      label: 'Retirada',
      description: 'Buscar diretamente na loja',
      icon: <StoreIcon className="h-4 w-4" />,
    },
    {
      id: 'dine_in',
      label: 'No local',
      description: 'Mesa ou código de atendimento',
      icon: <Utensils className="h-4 w-4" />,
    },
  ];

  const tabClassName = (tab: DrawerView): string =>
    `flex min-h-10 min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 text-[9px] font-black uppercase tracking-wide transition-colors ${
      view === tab
        ? 'bg-slate-800 text-white'
        : 'text-slate-500 hover:text-slate-300'
    }`;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/80 backdrop-blur-sm">
      <div className="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-slate-800 bg-slate-900">
        <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-900/95 px-5 py-4 backdrop-blur-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-orange-400">
                Finalizar pedido
              </span>
              <h3 className="mt-1 text-lg font-black text-white">
                {visitingStore.name}
              </h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-bold text-slate-400 hover:text-white"
            >
              Fechar ✕
            </button>
          </div>

          <div
            className="mt-4 grid grid-cols-3 gap-1.5 rounded-2xl bg-slate-950 p-1.5"
            id="customer-checkout-tabs"
          >
            <button
              type="button"
              onClick={() => setView('cart')}
              className={tabClassName('cart')}
              id="customer-cart-tab"
            >
              <ShoppingCart className="h-4 w-4 shrink-0" />
              <span className="truncate">Carrinho ({cartItemsCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setView('order')}
              className={tabClassName('order')}
              id="customer-order-tab"
            >
              <PackageCheck className="h-4 w-4 shrink-0" />
              <span className="truncate">Meu pedido</span>
            </button>
            <button
              type="button"
              onClick={() => setView('account')}
              className={tabClassName('account')}
              id="customer-account-tab"
            >
              <ReceiptText className="h-4 w-4 shrink-0" />
              <span className="truncate">Conta</span>
            </button>
          </div>
        </header>

        {view === 'cart' && (
          <form
            onSubmit={event => void handleCreateOrder(event)}
            className="flex flex-1 flex-col"
          >
            <div className="flex-1 space-y-6 p-5">
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase text-white">
                    Itens selecionados
                  </h4>
                  <span className="font-mono text-[10px] text-slate-500">
                    {cartItemsCount} item(ns)
                  </span>
                </div>

                {cart.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-950/50 py-12 text-center">
                    <ShoppingCart className="mx-auto h-9 w-9 text-slate-700" />
                    <p className="mt-3 text-xs font-bold text-slate-500">
                      Seu carrinho está vazio
                    </p>
                    <p className="mt-1 text-[11px] text-slate-600">
                      Consulte seu pedido ou sua conta pelas abas acima.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {cart.map(item => (
                      <article
                        key={item.product.id}
                        className="rounded-3xl border border-slate-800 bg-slate-950 p-3"
                      >
                        <div className="flex gap-3">
                          {item.product.image ? (
                            <img
                              src={item.product.image}
                              alt={item.product.name}
                              className="h-14 w-14 shrink-0 rounded-2xl object-cover"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-slate-700">
                              <PackageCheck className="h-5 w-5" />
                            </div>
                          )}

                          <div className="min-w-0 flex-1">
                            <h5 className="truncate text-xs font-black text-slate-200">
                              {item.product.name}
                            </h5>
                            <p className="mt-1 font-mono text-xs text-white">
                              {currencyFormatter.format(item.product.price)}
                            </p>

                            <div className="mt-2 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  updateCartQty(
                                    item.product.id,
                                    item.quantity - 1
                                  )
                                }
                                className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-slate-400 hover:text-white"
                                aria-label="Diminuir quantidade"
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </button>
                              <span className="min-w-6 text-center font-mono text-xs font-bold text-slate-300">
                                {item.quantity}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  updateCartQty(
                                    item.product.id,
                                    item.quantity + 1
                                  )
                                }
                                className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-slate-400 hover:text-white"
                                aria-label="Aumentar quantidade"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>

                        <input
                          type="text"
                          value={itemNotes[item.product.id] ?? ''}
                          onChange={event =>
                            setItemNotes(previous => ({
                              ...previous,
                              [item.product.id]: event.target.value,
                            }))
                          }
                          placeholder="Observação deste item (opcional)"
                          className="mt-3 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[11px] text-white focus:border-orange-500 focus:outline-none"
                        />
                      </article>
                    ))}
                  </div>
                )}
              </section>

              {cart.length > 0 && (
                <>
                  <section className="space-y-3">
                    <h4 className="text-xs font-black uppercase text-white">
                      Como deseja receber?
                    </h4>
                    <div className="grid gap-2">
                      {fulfillmentOptions.map(option => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => {
                            setFulfillmentType(option.id);
                            setCheckoutNotice('');
                          }}
                          className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors ${
                            fulfillmentType === option.id
                              ? 'border-orange-500/50 bg-orange-500/10'
                              : 'border-slate-800 bg-slate-950 hover:border-slate-700'
                          }`}
                        >
                          <span
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"
                            style={{ backgroundColor: accentColor }}
                          >
                            {option.icon}
                          </span>
                          <span className="min-w-0 flex-1">
                            <strong className="block text-xs text-white">
                              {option.label}
                            </strong>
                            <span className="mt-0.5 block text-[10px] text-slate-500">
                              {option.description}
                            </span>
                          </span>
                          {fulfillmentType === option.id && (
                            <Check className="h-4 w-4 text-orange-400" />
                          )}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="space-y-3">
                    <h4 className="text-xs font-black uppercase text-white">
                      Seus dados
                    </h4>
                    <input
                      type="text"
                      value={buyerName}
                      onChange={event => setBuyerName(event.target.value)}
                      placeholder="Seu nome"
                      className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white focus:border-orange-500 focus:outline-none"
                      required
                    />
                    <input
                      type="email"
                      value={buyerEmail}
                      onChange={event => setBuyerEmail(event.target.value)}
                      placeholder="Seu e-mail"
                      className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white focus:border-orange-500 focus:outline-none"
                      required
                    />

                    {fulfillmentType === 'delivery' && (
                      <div className="relative">
                        <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
                        <input
                          type="text"
                          value={buyerAddress}
                          onChange={event => setBuyerAddress(event.target.value)}
                          placeholder="Endereço completo para entrega"
                          className="w-full rounded-xl border border-slate-800 bg-slate-950 py-2.5 pl-10 pr-3 text-xs text-white focus:border-orange-500 focus:outline-none"
                          required
                        />
                      </div>
                    )}

                    {fulfillmentType === 'dine_in' && (
                      <input
                        type="text"
                        value={tableCode}
                        onChange={event => setTableCode(event.target.value)}
                        placeholder="Mesa ou código de atendimento"
                        className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white focus:border-orange-500 focus:outline-none"
                        required
                      />
                    )}

                    <textarea
                      value={customerNote}
                      onChange={event => setCustomerNote(event.target.value)}
                      rows={3}
                      placeholder="Observação geral do pedido (opcional)"
                      className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white focus:border-orange-500 focus:outline-none"
                    />
                  </section>

                  <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                    <div className="flex justify-between text-xs text-slate-400">
                      <span>Subtotal</span>
                      <span className="font-mono text-slate-200">
                        {currencyFormatter.format(subtotal)}
                      </span>
                    </div>
                    <div className="mt-2 flex justify-between border-t border-slate-800 pt-2 text-sm font-black text-white">
                      <span>Total do pedido</span>
                      <span className="font-mono" style={{ color: accentColor }}>
                        {currencyFormatter.format(subtotal)}
                      </span>
                    </div>
                    <p className="mt-3 text-[10px] leading-relaxed text-slate-600">
                      {fulfillmentType === 'dine_in'
                        ? 'O pedido no local será enviado para aprovação do atendimento, sem cobrança automática.'
                        : 'Entrega e retirada exigem pagamento confirmado. O pedido só será criado e enviado à loja depois da confirmação autoritativa do provedor.'}
                    </p>
                  </section>

                  {checkoutNotice && (
                    <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-xs leading-relaxed text-amber-200">
                      {checkoutNotice}
                    </p>
                  )}

                  {formError && (
                    <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-xs text-red-300">
                      {formError}
                    </p>
                  )}
                </>
              )}
            </div>

            {cart.length > 0 && (
              <footer className="sticky bottom-0 border-t border-slate-800 bg-slate-900/95 p-5 backdrop-blur-sm">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full rounded-xl py-3 text-xs font-black uppercase tracking-wider text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ backgroundColor: accentColor }}
                >
                  {isSubmitting
                    ? fulfillmentType === 'dine_in'
                      ? 'Enviando pedido...'
                      : 'Preparando pagamento...'
                    : fulfillmentType === 'dine_in'
                      ? 'Enviar pedido à loja'
                      : 'Continuar para pagamento Pix'}
                </button>
              </footer>
            )}
          </form>
        )}

        {view === 'order' && (
          <div className="flex-1 p-5" id="customer-order-panel">
            {!currentOrder ? (
              <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-950/50 px-5 py-14 text-center">
                <PackageCheck className="mx-auto h-10 w-10 text-slate-700" />
                <p className="mt-3 text-xs font-black uppercase text-slate-500">
                  Nenhum pedido recente
                </p>
                <p className="mt-1 text-[11px] text-slate-600">
                  Envie um pedido pelo carrinho para acompanhar o atendimento.
                </p>
                <button
                  type="button"
                  onClick={() => setView('cart')}
                  className="mt-5 rounded-xl bg-slate-800 px-4 py-2 text-[10px] font-black uppercase text-white"
                >
                  Abrir carrinho
                </button>
              </div>
            ) : (
              <div className="space-y-5">
                <section className="rounded-3xl border border-slate-800 bg-slate-950 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="font-mono text-[9px] font-bold uppercase tracking-wide text-orange-400">
                        {getFulfillmentLabel(currentOrder.fulfillmentType)}
                      </span>
                      <h4 className="mt-1 text-lg font-black text-white">
                        {getCustomerOrderStatusLabel(currentOrder.status)}
                      </h4>
                      <p className="mt-1 text-[10px] text-slate-500">
                        Enviado em {formatDateTime(currentOrder.createdAt)}
                      </p>
                    </div>
                    {terminalStatuses.includes(currentOrder.status) ? (
                      currentOrder.status === 'completed' ? (
                        <CheckCircle2 className="h-7 w-7 text-emerald-400" />
                      ) : (
                        <XCircle className="h-7 w-7 text-red-400" />
                      )
                    ) : (
                      <Clock3 className="h-7 w-7 animate-pulse text-amber-400" />
                    )}
                  </div>

                  {!terminalStatuses.includes(currentOrder.status) && (
                    <div className="mt-5 space-y-3">
                      {statusStepsFor(currentOrder).map((status, index, steps) => {
                        const currentIndex = steps.indexOf(currentOrder.status);
                        const complete = index <= currentIndex;
                        return (
                          <div key={status} className="flex items-center gap-3">
                            <span
                              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-black ${
                                complete
                                  ? 'border-emerald-500 bg-emerald-500 text-slate-950'
                                  : 'border-slate-700 bg-slate-900 text-slate-600'
                              }`}
                            >
                              {complete ? <Check className="h-3.5 w-3.5" /> : index + 1}
                            </span>
                            <span
                              className={`text-xs font-bold ${
                                complete ? 'text-slate-200' : 'text-slate-600'
                              }`}
                            >
                              {getCustomerOrderStatusLabel(status)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section className="rounded-3xl border border-slate-800 bg-slate-950 p-4">
                  <h5 className="text-xs font-black uppercase text-white">
                    Resumo do pedido
                  </h5>
                  <div className="mt-3 space-y-2">
                    {currentOrder.items.map(item => (
                      <div
                        key={`${currentOrder.id}-${item.productId}`}
                        className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3"
                      >
                        <div className="flex justify-between gap-3 text-xs">
                          <span className="text-slate-300">
                            {item.quantity}× {item.name}
                          </span>
                          <span className="font-mono text-slate-400">
                            {currencyFormatter.format(item.price * item.quantity)}
                          </span>
                        </div>
                        {item.note && (
                          <p className="mt-1 text-[10px] italic text-amber-300">
                            Obs.: {item.note}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex items-end justify-between border-t border-slate-800 pt-3">
                    <div>
                      <span className="block font-mono text-[8px] uppercase text-slate-600">
                        Pagamento
                      </span>
                      <button
                        type="button"
                        onClick={() => setView('account')}
                        className="text-[10px] font-bold uppercase text-amber-300 hover:text-amber-200"
                      >
                        Consultar conta
                      </button>
                    </div>
                    <strong className="font-mono text-lg text-white">
                      {currencyFormatter.format(currentOrder.total)}
                    </strong>
                  </div>
                </section>

                <button
                  type="button"
                  onClick={() => setView('cart')}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 py-3 text-[10px] font-black uppercase tracking-wide text-slate-300 hover:text-white"
                >
                  Voltar ao carrinho
                </button>
              </div>
            )}
          </div>
        )}

        {view === 'account' && (
          <div className="flex-1 p-5" id="customer-account-panel">
            {!currentOrder || !currentPaymentPresentation ? (
              <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-950/50 px-5 py-14 text-center">
                <ReceiptText className="mx-auto h-10 w-10 text-slate-700" />
                <p className="mt-3 text-xs font-black uppercase text-slate-500">
                  Nenhuma conta aberta
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                  A conta será criada quando seu primeiro pedido for enviado à loja.
                </p>
                <button
                  type="button"
                  onClick={() => setView('cart')}
                  className="mt-5 rounded-xl bg-slate-800 px-4 py-2 text-[10px] font-black uppercase text-white"
                >
                  Abrir carrinho
                </button>
              </div>
            ) : (
              <div className="space-y-5">
                <section className="rounded-3xl border border-slate-800 bg-slate-950 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white"
                        style={{ backgroundColor: accentColor }}
                      >
                        <WalletCards className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <span className="font-mono text-[9px] font-bold uppercase tracking-wide text-orange-400">
                          Checkout do consumo
                        </span>
                        <h4 className="mt-1 text-lg font-black text-white">
                          Sua conta
                        </h4>
                        <p className="mt-1 text-[10px] text-slate-500">
                          Pedido de {formatDateTime(currentOrder.createdAt)}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2.5 py-1 text-[8px] font-black uppercase ${currentPaymentPresentation.className}`}
                    >
                      {currentPaymentPresentation.label}
                    </span>
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-2">
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                      <span className="block font-mono text-[8px] uppercase text-slate-600">
                        Consumo total
                      </span>
                      <strong className="mt-1 block font-mono text-sm text-white">
                        {currencyFormatter.format(accountTotals.consumed)}
                      </strong>
                    </div>
                    <div className="rounded-2xl border border-orange-500/20 bg-orange-500/5 p-3">
                      <span className="block font-mono text-[8px] uppercase text-orange-300/70">
                        Em aberto
                      </span>
                      <strong className="mt-1 block font-mono text-sm text-orange-300">
                        {currencyFormatter.format(accountTotals.outstanding)}
                      </strong>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                      <span className="block font-mono text-[8px] uppercase text-slate-600">
                        Pago
                      </span>
                      <strong className="mt-1 block font-mono text-sm text-emerald-300">
                        {currencyFormatter.format(accountTotals.paid)}
                      </strong>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                      <span className="block font-mono text-[8px] uppercase text-slate-600">
                        Transferido
                      </span>
                      <strong className="mt-1 block font-mono text-sm text-slate-300">
                        {currencyFormatter.format(accountTotals.transferred)}
                      </strong>
                    </div>
                  </div>
                </section>

                <section className="rounded-3xl border border-slate-800 bg-slate-950 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h5 className="text-xs font-black uppercase text-white">
                      Itens consumidos
                    </h5>
                    <span className="font-mono text-[9px] text-slate-600">
                      Base cobrável {currencyFormatter.format(accountTotals.billable)}
                    </span>
                  </div>

                  <div className="mt-3 space-y-2">
                    {currentOrder.items.map(item => {
                      const openQuantity = getCustomerOrderItemOpenQuantity(item);
                      return (
                        <article
                          key={`${currentOrder.id}-account-${item.lineId}`}
                          className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <strong className="block truncate text-xs text-slate-200">
                                {item.quantity}× {item.name}
                              </strong>
                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[8px] uppercase text-slate-600">
                                {item.paidQuantity > 0 && (
                                  <span className="text-emerald-400">
                                    Pago: {item.paidQuantity}
                                  </span>
                                )}
                                {item.transferredQuantity > 0 && (
                                  <span>Transferido: {item.transferredQuantity}</span>
                                )}
                                <span className={openQuantity > 0 ? 'text-orange-300' : ''}>
                                  Em aberto: {openQuantity}
                                </span>
                              </div>
                            </div>
                            <span className="shrink-0 font-mono text-xs text-white">
                              {currencyFormatter.format(openQuantity * item.price)}
                            </span>
                          </div>
                        </article>
                      );
                    })}
                  </div>

                  <div className="mt-4 flex items-end justify-between border-t border-slate-800 pt-4">
                    <div>
                      <span className="block font-mono text-[8px] uppercase text-slate-600">
                        Total para fechamento
                      </span>
                      <p className="mt-1 max-w-[230px] text-[9px] leading-relaxed text-slate-500">
                        A forma de pagamento e o fechamento são confirmados pela loja.
                      </p>
                    </div>
                    <strong className="font-mono text-xl" style={{ color: accentColor }}>
                      {currencyFormatter.format(accountTotals.outstanding)}
                    </strong>
                  </div>
                </section>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setView('order')}
                    className="rounded-xl border border-slate-800 bg-slate-950 py-3 text-[9px] font-black uppercase text-slate-300 hover:text-white"
                  >
                    Meu pedido
                  </button>
                  <button
                    type="button"
                    onClick={() => setView('cart')}
                    className="rounded-xl border border-slate-800 bg-slate-950 py-3 text-[9px] font-black uppercase text-slate-300 hover:text-white"
                  >
                    Adicionar itens
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};