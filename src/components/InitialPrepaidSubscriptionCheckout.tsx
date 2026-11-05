import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../utils/firebase';
import {
  acceptInitialPrepaidSubscription,
  checkoutInitialPrepaidSubscription,
  loadInitialPrepaidSubscriptionStatus,
  quoteInitialPrepaidSubscription,
  type InitialPrepaidSubscriptionPaymentState,
  type InitialPrepaidSubscriptionQuote,
} from '../utils/storeSubscription';

type Props = { storeId: string; productId: string; selectedMonths: 3 | 6 | 12 };
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const date = (value: string) => new Date(value).toLocaleDateString('pt-BR');

/** Buyer UI for the existing canonical subscription checkout; no payment truth is derived here. */
export function InitialPrepaidSubscriptionCheckout(props: Props) {
  const [uid, setUid] = useState<string | null>(null);
  useEffect(() => onAuthStateChanged(auth, user => setUid(user?.uid ?? null)), []);
  if (!uid) return <p className="mt-3 text-amber-300">Entre na sua conta para contratar o período pré-pago.</p>;
  return <InitialPrepaidSubscriptionSession key={JSON.stringify([uid, props.storeId, props.productId, props.selectedMonths])} {...props} buyerUid={uid} />;
}

export function InitialPrepaidSubscriptionSession({ buyerUid, ...props }: Props & { buyerUid: string }) {
  const [quote, setQuote] = useState<InitialPrepaidSubscriptionQuote | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [payment, setPayment] = useState<InitialPrepaidSubscriptionPaymentState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const activeRequest = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const current = () => alive.current && auth.currentUser?.uid === buyerUid;
  const run = async (action: 'quote' | 'checkout' | 'status') => {
    if (activeRequest.current || !current()) return;
    activeRequest.current = true; setBusy(true); setError('');
    try {
      if (action === 'quote') {
        const result = await quoteInitialPrepaidSubscription(props);
        if (!current()) return;
        setQuote(result); setAccepted(false); setPayment(null);
        if (result.status && !['quoted', 'accepted'].includes(result.status)) {
          // Reopening the cart resumes the existing attempt through a read-only
          // reconciliation. Never ask the buyer to generate another charge.
          setPayment({ state: 'recovery_required' });
          const resumed = await loadInitialPrepaidSubscriptionStatus({ storeId: props.storeId, checkoutId: result.checkoutId });
          if (current()) setPayment(resumed);
        }
      } else {
        if (!quote || (action === 'checkout' && !accepted)) return;
        if (action === 'checkout') {
          await acceptInitialPrepaidSubscription({ storeId: props.storeId, checkoutId: quote.checkoutId, acceptedTotalMinor: quote.quote.totalMinor });
          if (!current()) return;
        }
        const result = action === 'checkout'
          ? await checkoutInitialPrepaidSubscription({ storeId: props.storeId, checkoutId: quote.checkoutId })
          : await loadInitialPrepaidSubscriptionStatus({ storeId: props.storeId, checkoutId: quote.checkoutId });
        if (current()) setPayment(result);
      }
    } catch (cause) {
      if (!current()) return;
      setError(cause instanceof Error ? cause.message : 'Não foi possível consultar a contratação.');
      // A lost response never authorizes another payment creation.
      if (action !== 'quote') setPayment({ state: 'recovery_required' });
    } finally {
      activeRequest.current = false;
      if (current()) setBusy(false);
    }
  };
  return <InitialPrepaidSubscriptionCard quote={quote} payment={payment} accepted={accepted} busy={busy} error={error}
    selectedMonths={props.selectedMonths} onAccept={setAccepted} onAction={action => void run(action)} />;
}

export function InitialPrepaidSubscriptionCard({ quote, payment, accepted, busy, error, selectedMonths, onAccept, onAction }: {
  quote: InitialPrepaidSubscriptionQuote | null;
  payment: InitialPrepaidSubscriptionPaymentState | null;
  accepted: boolean; busy: boolean; error: string; selectedMonths: 3 | 6 | 12;
  onAccept: (value: boolean) => void; onAction: (action: 'quote' | 'checkout' | 'status') => void;
}) {
  const pixExpired = payment?.pix && Date.parse(payment.pix.expiresAt) <= Date.now();
  return <section className="mt-3 space-y-3 rounded-xl border border-cyan-500/30 bg-slate-950 p-3" aria-label="Contratação pré-paga por Pix">
    <p className="font-bold text-white">Contrato de {quote?.quote.months ?? selectedMonths} meses · Pix único</p>
    <p>Pagamento integral, sem parcelamento e sem renovação automática. Uma futura renovação exige novo aceite.</p>
    {!quote ? <button type="button" disabled={busy} onClick={() => onAction('quote')} className="min-h-10 rounded-lg border border-cyan-700 px-3 disabled:opacity-50">
      {busy ? 'Consultando…' : 'Consultar preço oficial do contrato'}
    </button> : <>
      <p>Total confirmado pelo servidor: <strong>{currency.format(quote.quote.totalMinor / 100)}</strong></p>
      <p>Desconto: {quote.quote.discountPercent}% · Equivalente mensal: {currency.format(quote.quote.monthlyEquivalentMinor / 100)}</p>
      {quote.status && quote.status !== 'quoted' && <p>Retomando a contratação já registrada, com suas condições originais.</p>}
      {!payment && <>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={accepted} disabled={busy} onChange={event => onAccept(event.target.checked)} />
          <span>Confirmo a contratação de {quote.quote.months} meses pelo total de {currency.format(quote.quote.totalMinor / 100)}, em pagamento único Pix e sem renovação automática.</span>
        </label>
        <button type="button" disabled={busy || !accepted} onClick={() => onAction('checkout')}
          className="min-h-10 rounded-lg bg-cyan-700 px-3 font-bold text-white disabled:opacity-50">
          {busy ? 'Processando…' : quote.status === 'accepted' ? 'Continuar contratação já aceita' : 'Confirmar contratação e gerar Pix'}
        </button>
      </>}
      {payment?.state === 'activated' ? <div role="status" className="text-emerald-300">
        <p className="font-bold">Pagamento confirmado. Assinatura e contrato ativos.</p>
        {payment.startsAt && payment.expiresAt && <p>Vigência: {date(payment.startsAt)} a {date(payment.expiresAt)}.</p>}
        <p>A contratação está registrada no ERP da loja.</p>
      </div> : payment && <>
        <p role="status" className="text-cyan-300">{payment.state === 'rejected'
          ? 'Pagamento rejeitado. Nenhum contrato foi ativado.'
          : payment.state === 'recovery_required' ? 'A contratação precisa de reconciliação. Consulte o pagamento existente.'
            : pixExpired ? 'Pix expirado. Consulte a situação antes de continuar.' : 'Aguardando pagamento Pix. A assinatura só será ativada após confirmação.'}</p>
        {payment.pix && !pixExpired && payment.state === 'awaiting_payment' && <>
          <label className="block">Pix copia e cola<textarea aria-label="Pix copia e cola" readOnly value={payment.pix.qrCode} className="mt-1 w-full rounded-lg bg-slate-900 p-2 font-mono" /></label>
          <button type="button" onClick={() => void navigator.clipboard.writeText(payment.pix!.qrCode).catch(() => undefined)} className="min-h-10 rounded-lg border border-slate-600 px-3">Copiar código Pix</button>
          <p>Validade do Pix: {new Date(payment.pix.expiresAt).toLocaleString('pt-BR')}.</p>
        </>}
        <button type="button" disabled={busy} onClick={() => onAction('status')} className="min-h-10 rounded-lg border border-cyan-700 px-3 disabled:opacity-50">
          {busy ? 'Consultando…' : 'Consultar pagamento existente'}
        </button>
      </>}
    </>}
    {error && <p role="alert" className="text-amber-300">{error}</p>}
  </section>;
}
