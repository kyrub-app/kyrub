import { useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  CircleAlert,
  CreditCard,
  Link2,
  LoaderCircle,
  Search,
  UserRoundSearch,
} from 'lucide-react';
import type {
  InPersonCustomerCandidate,
  InPersonCustomerContext,
  InPersonCustomerLookupKind,
  InPersonCustomerPaymentState,
} from '../../../shared/inPersonCustomerIdentity';
import type { CustomerOrder } from '../../utils/customerOrders';
import {
  linkInPersonCustomer,
  loadInPersonCustomerContext,
  searchInPersonCustomers,
} from '../../utils/inPersonCustomerIdentity';

const money = (value: number): string =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);

const paymentLabel = (state: InPersonCustomerPaymentState): string => {
  if (state === 'paid') return 'Pagamento confirmado para este Cairuvi';
  if (state === 'paid_unattributed') return 'Pagamento confirmado, ainda não atribuído ao Cairuvi';
  if (state === 'partial') return 'Pagamento parcial';
  if (state === 'pending') return 'Pagamento pendente';
  if (state === 'refunded') return 'Pagamento reembolsado';
  if (state === 'reconciliation_required') return 'Pagamento precisa de conciliação';
  if (state === 'attention') return 'Situação financeira requer atenção';
  return 'Nenhum pagamento canônico iniciado';
};

const locationLabel = (order: CustomerOrder): string =>
  order.serviceLocation?.label || order.tableCode || 'Atendimento local';

export const InPersonCustomerLinker = ({
  storeId,
  orders,
}: {
  storeId: string;
  orders: CustomerOrder[];
}) => {
  const eligibleOrders = useMemo(
    () => orders
      .filter(order =>
        order.source === 'staff' &&
        order.fulfillmentType === 'dine_in' &&
        order.status !== 'rejected' &&
        order.status !== 'cancelled'
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 20),
    [orders]
  );
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [context, setContext] = useState<InPersonCustomerContext | null>(null);
  const [lookupKind, setLookupKind] = useState<InPersonCustomerLookupKind>('name');
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<InPersonCustomerCandidate[]>([]);
  const [loadingContext, setLoadingContext] = useState(false);
  const [searching, setSearching] = useState(false);
  const [linkingRef, setLinkingRef] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    setSelectedOrderId(current =>
      eligibleOrders.some(order => order.id === current)
        ? current
        : eligibleOrders[0]?.id ?? ''
    );
  }, [eligibleOrders]);

  useEffect(() => {
    setContext(null);
    setCandidates([]);
    setMessage('');
    if (!storeId || !selectedOrderId) return;
    let active = true;
    setLoadingContext(true);
    void loadInPersonCustomerContext({ storeId, orderId: selectedOrderId })
      .then(next => {
        if (active) setContext(next);
      })
      .catch(error => {
        if (active) setMessage(error instanceof Error ? error.message : 'Não foi possível ler o pedido.');
      })
      .finally(() => {
        if (active) setLoadingContext(false);
      });
    return () => {
      active = false;
    };
  }, [selectedOrderId, storeId]);

  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = event instanceof CustomEvent
        ? event.detail as { orderId?: string } | undefined
        : undefined;
      if (!selectedOrderId || detail?.orderId !== selectedOrderId) return;
      void loadInPersonCustomerContext({ storeId, orderId: selectedOrderId })
        .then(setContext)
        .catch(() => undefined);
    };
    window.addEventListener('kyrub-in-person-order-created', refresh);
    window.addEventListener('kyrub-in-person-customer-linked', refresh);
    return () => {
      window.removeEventListener('kyrub-in-person-order-created', refresh);
      window.removeEventListener('kyrub-in-person-customer-linked', refresh);
    };
  }, [selectedOrderId, storeId]);

  const handleSearch = async (): Promise<void> => {
    if (!selectedOrderId || !query.trim() || searching) return;
    setSearching(true);
    setMessage('');
    try {
      const next = await searchInPersonCustomers({
        storeId,
        orderId: selectedOrderId,
        kind: lookupKind,
        query: query.trim(),
      });
      setCandidates(next);
      if (lookupKind !== 'name') setQuery('');
      if (next.length === 0) {
        setMessage('Nenhuma conta Cairuvi correspondente foi encontrada.');
      }
    } catch (error) {
      setCandidates([]);
      setMessage(error instanceof Error ? error.message : 'Não foi possível pesquisar o cliente.');
    } finally {
      setSearching(false);
    }
  };

  const handleLink = async (candidate: InPersonCustomerCandidate): Promise<void> => {
    if (!selectedOrderId || !candidate.customerRef || !candidate.linkable || linkingRef) return;
    setLinkingRef(candidate.customerRef);
    setMessage('');
    try {
      const next = await linkInPersonCustomer({
        storeId,
        orderId: selectedOrderId,
        customerRef: candidate.customerRef,
      });
      setContext(next);
      setCandidates([]);
      setMessage('Cliente vinculado ao pedido e ao CRM da loja como primeiro contato.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível vincular o cliente.');
    } finally {
      setLinkingRef('');
    }
  };

  if (eligibleOrders.length === 0) {
    return (
      <section className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-3 text-[9px] leading-relaxed text-slate-500">
        <strong className="block text-[10px] text-slate-300">Identificação do cliente</strong>
        Crie um pedido presencial para vincular um Cairuvi e acompanhar o estado do pagamento.
      </section>
    );
  }

  return (
    <section
      id="kyrub-in-person-customer-linker"
      className="mt-4 space-y-3 rounded-2xl border border-teal-500/20 bg-slate-900/70 p-3 sm:p-4"
    >
      <div className="flex items-start gap-2">
        <UserRoundSearch className="mt-0.5 h-4 w-4 shrink-0 text-teal-300" />
        <div>
          <h3 className="text-[11px] font-black uppercase text-white">Cliente, CRM e pagamento</h3>
          <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
            Localize a conta Cairuvi sem transformar nome parecido em identidade. CPF e telefone usam correspondência exata de identidade aprovada; o pagamento é lido da evidência financeira do pedido.
          </p>
        </div>
      </div>

      <label className="space-y-1 text-[8px] font-black uppercase text-slate-500">
        Pedido presencial
        <select
          value={selectedOrderId}
          onChange={event => setSelectedOrderId(event.target.value)}
          className="min-h-10 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] font-bold normal-case text-white outline-none"
        >
          {eligibleOrders.map(order => (
            <option key={order.id} value={order.id}>
              {locationLabel(order)} · {order.buyerName || 'Cliente local'} · {order.id.slice(-8)}
            </option>
          ))}
        </select>
      </label>

      {loadingContext ? (
        <div className="flex items-center gap-2 text-[9px] text-slate-500">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Atualizando contexto…
        </div>
      ) : context && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-950/75 p-3">
            <div className="flex items-center gap-2 text-[8px] font-black uppercase text-slate-500">
              <BadgeCheck className="h-3.5 w-3.5" /> Identidade
            </div>
            <strong className="mt-1 block text-[10px] text-white">
              {context.identityStatus === 'verified_account'
                ? context.customerName || 'Cairuvi identificado'
                : 'Cliente ainda não identificado no Cairuvi'}
            </strong>
            <span className="mt-1 block text-[8px] leading-relaxed text-slate-600">
              {context.identityStatus === 'verified_account'
                ? 'Vínculo canônico cliente ↔ loja ativo no CRM.'
                : 'O nome local do pedido não é considerado identidade verificada.'}
            </span>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/75 p-3">
            <div className="flex items-center gap-2 text-[8px] font-black uppercase text-slate-500">
              <CreditCard className="h-3.5 w-3.5" /> Pagamento
            </div>
            <strong className="mt-1 block text-[10px] text-white">
              {paymentLabel(context.payment.state)}
            </strong>
            <span className="mt-1 block text-[8px] leading-relaxed text-slate-600">
              {money(context.payment.authoritativelyPaidAmount)} confirmado de {money(context.payment.expectedAmount)} esperado.
            </span>
          </div>
        </div>
      )}

      {context?.identityStatus !== 'verified_account' && (
        <>
          <div className="grid gap-2 sm:grid-cols-[130px_1fr_auto]">
            <select
              value={lookupKind}
              onChange={event => {
                setLookupKind(event.target.value as InPersonCustomerLookupKind);
                setCandidates([]);
                setMessage('');
              }}
              className="min-h-10 rounded-xl border border-slate-800 bg-slate-950 px-3 text-[9px] font-bold text-white outline-none"
            >
              <option value="name">Nome</option>
              <option value="cpf">CPF</option>
              <option value="phone">Telefone</option>
            </select>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-600" />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') void handleSearch();
                }}
                inputMode={lookupKind === 'name' ? 'text' : 'numeric'}
                autoComplete="off"
                placeholder={
                  lookupKind === 'name'
                    ? 'Nome exato do cliente'
                    : lookupKind === 'cpf'
                      ? 'CPF do cliente'
                      : 'Telefone / WhatsApp'
                }
                className="min-h-10 w-full rounded-xl border border-slate-800 bg-slate-950 pl-9 pr-3 text-[10px] text-white outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleSearch()}
              disabled={searching || !query.trim()}
              className="flex min-h-10 items-center justify-center gap-2 rounded-xl border border-teal-500/25 bg-teal-500/10 px-4 text-[9px] font-black uppercase text-teal-200 disabled:opacity-40"
            >
              {searching ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              Buscar
            </button>
          </div>

          {lookupKind === 'name' && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/15 bg-amber-500/[0.05] px-3 py-2 text-[8px] leading-relaxed text-amber-100/70">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Nome serve para localizar candidatos, mas não autoriza o vínculo sozinho. Para confirmar agora, use CPF ou telefone exato; QR/NFC poderá substituir essa etapa depois.
            </div>
          )}

          {candidates.length > 0 && (
            <div className="space-y-2">
              {candidates.map((candidate, index) => (
                <article
                  key={`${candidate.displayName}-${candidate.maskedEmail}-${index}`}
                  className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/75 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <strong className="block truncate text-[10px] text-white">{candidate.displayName}</strong>
                    <div className="mt-1 flex flex-wrap gap-2 text-[8px] text-slate-500">
                      {candidate.maskedEmail && <span>{candidate.maskedEmail}</span>}
                      {candidate.maskedPhone && <span>{candidate.maskedPhone}</span>}
                      <span>{candidate.identityVerified ? 'Identidade aprovada' : 'Conta localizada'}</span>
                    </div>
                  </div>
                  {candidate.linkable ? (
                    <button
                      type="button"
                      onClick={() => void handleLink(candidate)}
                      disabled={Boolean(linkingRef)}
                      className="flex min-h-9 items-center justify-center gap-2 rounded-lg bg-teal-600 px-3 text-[8px] font-black uppercase text-white disabled:opacity-50"
                    >
                      {linkingRef === candidate.customerRef
                        ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        : <Link2 className="h-3.5 w-3.5" />}
                      Vincular ao pedido
                    </button>
                  ) : (
                    <span className="rounded-lg border border-slate-800 px-3 py-2 text-center text-[8px] font-black uppercase text-slate-600">
                      Confirmação adicional necessária
                    </span>
                  )}
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {message && (
        <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[9px] text-slate-400" role="status">
          {message}
        </div>
      )}

      <p className="text-[8px] leading-relaxed text-slate-600">
        Identificar o Cairuvi não confirma pagamento, não gera pontos e não altera documento fiscal. O CRM registra o primeiro contato; compras só passam a contar quando o domínio financeiro tiver evidência autoritativa.
      </p>
    </section>
  );
};
