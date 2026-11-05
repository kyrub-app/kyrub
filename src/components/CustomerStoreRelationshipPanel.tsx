import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  Award,
  ChevronDown,
  ChevronUp,
  Gift,
  History,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Target,
  TicketCheck,
  Trophy,
} from 'lucide-react';
import type {
  StoreRelationshipChallengeSummary,
  StoreRelationshipSummary,
  StoreRelationshipVoucherSummary,
} from '../../shared/storeRelationship';
import { auth } from '../utils/firebase';
import { acceptMerchantPrepaidRenewal, checkoutMerchantPrepaidRenewal, listMyMerchantPrepaidRenewalProposals, loadMerchantPrepaidRenewalPaymentStatus, type MerchantPrepaidRenewalPaymentState } from '../utils/storeSubscription';
import { redeemStoreRewardForCurrentUser } from '../utils/storeRewardRedemption';
import { loadStoreRelationshipForCurrentUser } from '../utils/storeRelationship';

interface CustomerStoreRelationshipPanelProps {
  storeId: string;
  storeName: string;
}

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const date = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
});

const challengeMetric = (
  challenge: StoreRelationshipChallengeSummary
): string => {
  if (challenge.metric === 'spend_minor') {
    return `${currency.format(challenge.progress / 100)} de ${currency.format(challenge.target / 100)}`;
  }
  return `${challenge.progress} de ${challenge.target} compra${challenge.target === 1 ? '' : 's'}`;
};

const benefitLabel = (input: {
  discountType: 'percentage' | 'fixed';
  discountValue: number;
}): string => input.discountType === 'percentage'
  ? `${input.discountValue}% de desconto`
  : `${currency.format(input.discountValue)} de desconto`;

const voucherStatus = (
  status: StoreRelationshipVoucherSummary['status']
): string => {
  if (status === 'available') return 'Disponível';
  if (status === 'used') return 'Utilizado';
  if (status === 'expired') return 'Expirado';
  return 'Inativo';
};

type BuyerRenewalOffer = Awaited<ReturnType<typeof listMyMerchantPrepaidRenewalProposals>>['proposals'][number];

/** Display uses authoritative server state; browser events never mark a renewal paid. */
export function PrepaidRenewalOfferCard({ offer, payment, busyId, onAccept, onPayment }: {
  offer: BuyerRenewalOffer;
  payment?: MerchantPrepaidRenewalPaymentState;
  busyId: string;
  onAccept: (id: string, total: number) => void;
  onPayment: (id: string, action: 'checkout' | 'status') => void;
}) {
  const state = offer.renewalState === 'activated' ? 'activated' : payment?.state ?? offer.renewalState ?? offer.status;
  const contract = payment?.contract ?? offer.contract;
  const expired = payment?.pix && Date.parse(payment.pix.expiresAt) <= Date.now();
  return (
    <div className="rounded-xl border border-slate-700 p-3 text-xs text-slate-300">
      <p>Produto: {offer.proposal.productId}</p>
      <p>Período: {offer.proposal.months} meses</p>
      <p>Preço mensal vigente: {currency.format(offer.proposal.currentMonthlyPriceMinor / 100)}</p>
      <p>Desconto: {offer.proposal.discountPercent}%</p>
      <p className="mt-1 font-bold text-white">Total da proposta: {currency.format(offer.proposal.totalDueMinor / 100)}</p>
      {state === 'awaiting_acceptance' ? (
        <button type="button" disabled={Boolean(busyId)}
          onClick={() => void onAccept(offer.id, offer.proposal.totalDueMinor)}
          className="mt-3 min-h-10 rounded-xl bg-cyan-700 px-4 font-bold text-white disabled:opacity-50">
          {busyId === offer.id ? 'Registrando aceite…' : 'Aceitar condições da renovação'}
        </button>
      ) : state === 'activated' ? (
        <div role="status" className="mt-3 text-emerald-300">
          <p className="font-bold">Contrato ativado. Pagamento confirmado.</p>
          {contract && <p>Vigência: {date.format(new Date(contract.startsAt))} até {date.format(new Date(contract.expiresAt))}.</p>}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <p role="status" className="text-cyan-300">{state === 'payment_confirmed'
            ? 'Pagamento confirmado. Concluindo a ativação do contrato.'
            : state === 'recovery_required'
              ? 'Verificação necessária. Consulte o pagamento existente antes de continuar.'
              : state === 'expired' || expired
                ? 'O prazo do Pix expirou. Consulte o estado antes de solicitar novas condições à loja.'
                : state === 'awaiting_payment'
                  ? 'Aguardando pagamento. A renovação será ativada após confirmação.'
                  : 'Condições aceitas. Gere o Pix para continuar.'}</p>
          {payment?.pix && !expired && state === 'awaiting_payment' && (
            <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900 p-3">
              <label className="block font-bold" htmlFor={`renewal-pix-${offer.id}`}>Pix copia e cola</label>
              <textarea id={`renewal-pix-${offer.id}`} readOnly value={payment.pix.qrCode} rows={3} className="w-full resize-none rounded-lg bg-slate-950 p-2 text-xs text-white" />
              <p>Válido até {new Date(payment.pix.expiresAt).toLocaleString('pt-BR')}.</p>
              <p>Confira o recebedor e o valor de {currency.format(offer.proposal.totalDueMinor / 100)} no seu aplicativo antes de pagar.</p>
            </div>
          )}
          <button type="button" disabled={Boolean(busyId)}
            onClick={() => void onPayment(offer.id, state === 'accepted' ? 'checkout' : 'status')}
            className="min-h-10 rounded-xl border border-cyan-600 px-4 font-bold text-cyan-200 disabled:opacity-50">
            {busyId === offer.id ? 'Verificando…' : state === 'accepted' ? 'Gerar Pix da renovação' : 'Consultar pagamento existente'}
          </button>
        </div>
      )}
    </div>
  );
}

export function CustomerStoreRelationshipPanel(props: CustomerStoreRelationshipPanelProps) {
  const [identity, setIdentity] = useState<{ ready: boolean; uid: string | null }>({ ready: false, uid: null });
  useEffect(() => onAuthStateChanged(auth, user => {
    setIdentity({ ready: true, uid: user?.uid ?? null });
  }), []);
  if (!identity.ready) return null;
  // A new UID or store remounts all customer data before any new request settles.
  return <CustomerStoreRelationshipSession key={JSON.stringify([identity.uid, props.storeId])} {...props} buyerUid={identity.uid} />;
}

function CustomerStoreRelationshipSession({ storeId, storeName, buyerUid }: CustomerStoreRelationshipPanelProps & { buyerUid: string | null }) {
  const signedIn = Boolean(buyerUid);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const isCurrentSession = useCallback(() => mounted.current && auth.currentUser?.uid === buyerUid, [buyerUid]);
  const [expanded, setExpanded] = useState(false);
  const [summary, setSummary] = useState<StoreRelationshipSummary | null>(null);
  const [renewalOffers, setRenewalOffers] = useState<Awaited<ReturnType<typeof listMyMerchantPrepaidRenewalProposals>>['proposals']>([]);
  const [renewalBusyId, setRenewalBusyId] = useState('');
  const [renewalError, setRenewalError] = useState('');
  const [renewalPayments, setRenewalPayments] = useState<Record<string, MerchantPrepaidRenewalPaymentState>>({});
  const [loading, setLoading] = useState(false);
  const [busyRewardId, setBusyRewardId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    if (!storeId || !auth.currentUser) {
      setSummary(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await loadStoreRelationshipForCurrentUser(storeId);
      if (isCurrentSession()) setSummary(result);
    } catch (loadError) {
      if (!isCurrentSession()) return;
      setSummary(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Não foi possível carregar seu relacionamento.'
      );
    } finally {
      if (isCurrentSession()) setLoading(false);
    }
  }, [storeId, isCurrentSession]);

  useEffect(() => {
    setSummary(null);
    setMessage('');
    setError('');
    if (signedIn) void refresh();
  }, [signedIn, storeId, refresh]);

  useEffect(() => {
    let active = true;
    setRenewalOffers([]);
    setRenewalError('');
    if (signedIn && storeId) {
      void listMyMerchantPrepaidRenewalProposals({ storeId }).then(result => {
        if (active && isCurrentSession()) setRenewalOffers(result.proposals);
      }).catch(error => {
        if (active && isCurrentSession()) setRenewalError(error instanceof Error ? error.message : 'Não foi possível carregar as propostas.');
      });
    }
    return () => { active = false; };
  }, [signedIn, storeId, isCurrentSession]);

  const acceptRenewal = async (id: string, acceptedTotalMinor: number): Promise<void> => {
    if (renewalBusyId || !isCurrentSession()) return;
    setRenewalBusyId(id);
    setRenewalError('');
    try {
      await acceptMerchantPrepaidRenewal({ storeId, proposalId: id, acceptedTotalMinor });
      if (!isCurrentSession()) return;
      const result = await listMyMerchantPrepaidRenewalProposals({ storeId });
      if (isCurrentSession()) setRenewalOffers(result.proposals);
    } catch (error) {
      if (!isCurrentSession()) return;
      setRenewalError(error instanceof Error ? error.message : 'Não foi possível registrar seu aceite.');
    } finally {
      if (isCurrentSession()) setRenewalBusyId('');
    }
  };

  const updateRenewalPayment = async (id: string, action: 'checkout' | 'status'): Promise<void> => {
    if (renewalBusyId || !isCurrentSession()) return;
    setRenewalBusyId(id);
    setRenewalError('');
    try {
      const result = await (action === 'checkout' ? checkoutMerchantPrepaidRenewal : loadMerchantPrepaidRenewalPaymentStatus)({ storeId, proposalId: id });
      if (!isCurrentSession()) return;
      setRenewalPayments(current => ({ ...current, [id]: result }));
      if (result.state === 'activated') {
        const latest = await listMyMerchantPrepaidRenewalProposals({ storeId });
        if (isCurrentSession()) setRenewalOffers(latest.proposals);
      }
    } catch (paymentError) {
      if (!isCurrentSession()) return;
      // An unsuccessful response may follow a successful provider request. Offer
      // only reconciliation next; never encourage a second payment creation.
      setRenewalPayments(current => ({ ...current, [id]: { ...current[id], state: 'recovery_required' } }));
      setRenewalError(paymentError instanceof Error ? paymentError.message : 'Não foi possível consultar o pagamento. Verifique o estado antes de tentar novamente.');
    } finally {
      if (isCurrentSession()) setRenewalBusyId('');
    }
  };

  const activeChallenges = useMemo(
    () => summary?.challenges.filter(
      challenge => challenge.status === 'active' || challenge.status === 'completed'
    ) ?? [],
    [summary]
  );

  const handleRedeem = async (rewardId: string): Promise<void> => {
    if (busyRewardId || !isCurrentSession()) return;
    setBusyRewardId(rewardId);
    setMessage('');
    setError('');
    try {
      const result = await redeemStoreRewardForCurrentUser({ storeId, rewardId });
      if (!isCurrentSession()) return;
      setMessage(
        result.duplicate
          ? `Recompensa já resgatada. Voucher ${result.voucherCode}.`
          : `Recompensa resgatada. Seu voucher é ${result.voucherCode}.`
      );
      await refresh();
    } catch (redeemError) {
      if (!isCurrentSession()) return;
      setError(
        redeemError instanceof Error
          ? redeemError.message
          : 'Não foi possível resgatar a recompensa.'
      );
    } finally {
      if (isCurrentSession()) setBusyRewardId('');
    }
  };

  if (!signedIn) {
    return (
      <section
        id="customer-store-relationship-panel"
        className="rounded-3xl border border-slate-800 bg-slate-900 p-4"
      >
        <div className="flex items-start gap-3">
          <Trophy className="mt-0.5 h-5 w-5 text-amber-300" />
          <div>
            <h3 className="text-sm font-black uppercase text-white">Meu relacionamento</h3>
            <p className="mt-1 text-[10px] text-slate-500">
              Entre na sua conta para acompanhar pontos, desafios e recompensas desta loja.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      id="customer-store-relationship-panel"
      className="overflow-hidden rounded-3xl border border-amber-500/20 bg-slate-900 shadow-lg"
      aria-label={`Meu relacionamento com ${storeName || 'esta loja'}`}
    >
      {renewalOffers.length > 0 && (
        <div className="m-4 rounded-2xl border border-cyan-500/30 bg-slate-950 p-4" aria-label="Minhas propostas de renovação">
          <h3 className="text-sm font-bold text-white">Minhas propostas de renovação</h3>
          <p className="mt-1 text-xs text-slate-400">Confira as condições antes de aceitar. O aceite não gera cobrança nem ativa a renovação.</p>
          <div className="mt-3 space-y-3">
            {renewalOffers.map(offer => (
              <PrepaidRenewalOfferCard key={offer.id} offer={offer} payment={renewalPayments[offer.id]}
                busyId={renewalBusyId} onAccept={(id, total) => void acceptRenewal(id, total)}
                onPayment={(id, action) => void updateRenewalPayment(id, action)} />
            ))}
          </div>
        </div>
      )}
      {renewalError && <p role="alert" className="mx-4 text-xs text-red-300">{renewalError}</p>}
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-amber-500/25 bg-amber-500/10 text-amber-300">
              <Trophy className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-amber-400">
                Meu relacionamento
              </span>
              <h3 className="mt-1 truncate text-sm font-black text-white">
                {storeName || 'Esta loja'}
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-500 hover:text-white disabled:opacity-40"
            aria-label="Atualizar meu relacionamento"
          >
            {loading
              ? <LoaderCircle className="h-4 w-4 animate-spin" />
              : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>

        {summary ? (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
              <span className="text-[8px] font-black uppercase text-slate-500">Saldo</span>
              <strong className="mt-1 block text-lg font-black text-amber-300">
                {summary.points.balance}
              </strong>
              <span className="text-[8px] text-slate-600">Pontos da Loja</span>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
              <span className="text-[8px] font-black uppercase text-slate-500">Nível</span>
              <strong className="mt-1 block truncate text-xs font-black text-white">
                {summary.level.label}
              </strong>
              <span className="text-[8px] text-slate-600">
                {summary.level.confirmedPurchases} compra{summary.level.confirmedPurchases === 1 ? '' : 's'} confirmada{summary.level.confirmedPurchases === 1 ? '' : 's'}
              </span>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
              <span className="text-[8px] font-black uppercase text-slate-500">Desafios</span>
              <strong className="mt-1 block text-lg font-black text-violet-300">
                {activeChallenges.length}
              </strong>
              <span className="text-[8px] text-slate-600">ativos/concluídos</span>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
              <span className="text-[8px] font-black uppercase text-slate-500">Recompensas</span>
              <strong className="mt-1 block text-lg font-black text-emerald-300">
                {summary.rewards.filter(reward => reward.canRedeem).length}
              </strong>
              <span className="text-[8px] text-slate-600">prontas para resgate</span>
            </div>
          </div>
        ) : loading ? (
          <div className="mt-4 flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-950 px-4 py-5 text-xs text-slate-500">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Carregando saldo e benefícios reais…
          </div>
        ) : null}

        {summary?.level.nextLabel && (
          <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-950 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3 text-[9px]">
              <span className="font-bold text-slate-400">Próximo nível: {summary.level.nextLabel}</span>
              <span className="text-slate-600">{summary.level.nextAtPurchases} compras</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-amber-400 transition-all"
                style={{ width: `${summary.level.progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-[10px] font-bold text-red-300">
            {error}
          </p>
        )}
        {message && (
          <p className="mt-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[10px] font-bold text-emerald-300">
            {message}
          </p>
        )}

        <button
          type="button"
          onClick={() => setExpanded(current => !current)}
          className="mt-4 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-950 text-[9px] font-black uppercase text-slate-300 hover:text-white"
          aria-expanded={expanded}
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {expanded ? 'Ocultar detalhes' : 'Ver pontos, desafios e benefícios'}
        </button>
      </div>

      {expanded && summary && (
        <div className="space-y-4 border-t border-slate-800 bg-slate-950/50 p-4 sm:p-5">
          <section>
            <div className="mb-2 flex items-center gap-2">
              <Award className="h-4 w-4 text-amber-300" />
              <h4 className="text-[10px] font-black uppercase text-white">Pontos reais</h4>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
                <span className="text-[8px] uppercase text-slate-600">Ganhos válidos</span>
                <strong className="mt-1 block text-sm text-emerald-300">+{summary.points.lifetimeEarned}</strong>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
                <span className="text-[8px] uppercase text-slate-600">Resgatados</span>
                <strong className="mt-1 block text-sm text-violet-300">{summary.points.lifetimeRedeemed}</strong>
              </div>
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <Target className="h-4 w-4 text-violet-300" />
              <h4 className="text-[10px] font-black uppercase text-white">Desafios</h4>
            </div>
            <div className="space-y-2">
              {summary.challenges.map(challenge => (
                <article key={challenge.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <strong className="block truncate text-xs text-white">{challenge.title}</strong>
                      <span className="mt-1 block text-[9px] text-slate-500">
                        {challengeMetric(challenge)} · +{challenge.rewardPoints} pontos
                      </span>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[8px] font-black uppercase ${
                      challenge.status === 'completed'
                        ? 'bg-emerald-500/10 text-emerald-300'
                        : challenge.status === 'active'
                          ? 'bg-violet-500/10 text-violet-300'
                          : 'bg-slate-800 text-slate-500'
                    }`}>
                      {challenge.status === 'completed' ? 'Concluído' : challenge.status === 'active' ? 'Ativo' : challenge.status === 'paused' ? 'Pausado' : 'Encerrado'}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-violet-400"
                      style={{ width: `${challenge.progressPercent}%` }}
                    />
                  </div>
                </article>
              ))}
              {summary.challenges.length === 0 && (
                <p className="rounded-2xl border border-dashed border-slate-800 px-3 py-5 text-center text-[10px] text-slate-600">
                  Nenhum desafio disponível nesta loja agora.
                </p>
              )}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <Gift className="h-4 w-4 text-emerald-300" />
              <h4 className="text-[10px] font-black uppercase text-white">Recompensas</h4>
            </div>
            <div className="space-y-2">
              {summary.rewards.map(reward => (
                <article key={reward.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <strong className="block truncate text-xs text-white">{reward.title}</strong>
                      <span className="mt-1 block text-[9px] text-slate-500">
                        {benefitLabel(reward)} · {reward.costPoints} pontos
                      </span>
                      {reward.redeemed && reward.voucherCode && (
                        <span className="mt-1 block font-mono text-[9px] font-black text-emerald-300">
                          Voucher: {reward.voucherCode}
                        </span>
                      )}
                    </div>
                    {reward.redeemed ? (
                      <span className="shrink-0 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[8px] font-black uppercase text-emerald-300">
                        Resgatada
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={!reward.canRedeem || Boolean(busyRewardId)}
                        onClick={() => void handleRedeem(reward.id)}
                        className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 text-[8px] font-black uppercase text-emerald-300 disabled:cursor-not-allowed disabled:opacity-35"
                      >
                        {busyRewardId === reward.id
                          ? <LoaderCircle className="h-3 w-3 animate-spin" />
                          : <Sparkles className="h-3 w-3" />}
                        {reward.canRedeem
                          ? `Resgatar por ${reward.costPoints}`
                          : `Faltam ${Math.max(0, reward.costPoints - summary.points.balance)} pts`}
                      </button>
                    )}
                  </div>
                </article>
              ))}
              {summary.rewards.length === 0 && (
                <p className="rounded-2xl border border-dashed border-slate-800 px-3 py-5 text-center text-[10px] text-slate-600">
                  Nenhuma recompensa disponível ou resgatada nesta loja.
                </p>
              )}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <TicketCheck className="h-4 w-4 text-cyan-300" />
              <h4 className="text-[10px] font-black uppercase text-white">Cupons e vouchers</h4>
            </div>
            <div className="space-y-2">
              {summary.vouchers.map(voucher => (
                <div key={voucher.redemptionId} className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <strong className="block truncate text-xs text-white">{voucher.title}</strong>
                      <span className="mt-1 block font-mono text-[9px] font-black text-cyan-300">{voucher.code}</span>
                    </div>
                    <span className="shrink-0 text-[8px] font-black uppercase text-slate-500">
                      {voucherStatus(voucher.status)}
                    </span>
                  </div>
                  <span className="mt-1 block text-[8px] text-slate-600">até {date.format(new Date(voucher.endsAt))}</span>
                </div>
              ))}
              {summary.coupons.map(coupon => (
                <div key={coupon.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <strong className="block truncate text-xs text-white">{coupon.title}</strong>
                      <span className="mt-1 block font-mono text-[9px] font-black text-amber-300">{coupon.code}</span>
                    </div>
                    <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-1 text-[8px] font-black uppercase text-amber-300">
                      {coupon.badge}
                    </span>
                  </div>
                </div>
              ))}
              {summary.vouchers.length === 0 && summary.coupons.length === 0 && (
                <p className="rounded-2xl border border-dashed border-slate-800 px-3 py-5 text-center text-[10px] text-slate-600">
                  Nenhum cupom ou voucher disponível agora.
                </p>
              )}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <History className="h-4 w-4 text-slate-400" />
              <h4 className="text-[10px] font-black uppercase text-white">Histórico</h4>
            </div>
            <div className="space-y-1.5">
              {summary.history.slice(0, 12).map(item => (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5">
                  <div className="min-w-0">
                    <span className="block truncate text-[9px] font-bold text-slate-300">{item.label}</span>
                    <span className="mt-0.5 block text-[8px] text-slate-600">{date.format(new Date(item.occurredAt))}</span>
                  </div>
                  <strong className={`shrink-0 text-xs ${item.amount >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                    {item.amount >= 0 ? '+' : ''}{item.amount}
                  </strong>
                </div>
              ))}
              {summary.history.length === 0 && (
                <p className="rounded-2xl border border-dashed border-slate-800 px-3 py-5 text-center text-[10px] text-slate-600">
                  Seu histórico com esta loja começa na primeira compra confirmada.
                </p>
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}