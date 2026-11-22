import { useCallback, useEffect, useState } from 'react';
import { Gift, LoaderCircle } from 'lucide-react';
import { auth } from '../../utils/firebase';

type Proposal = {
  status: 'awaiting_response' | 'interested' | 'prefers_refund';
  amountMinor: number;
  bonusPercent: number;
  bonusMinor: number;
  proposedCreditMinor: number;
  creditIssued: false;
};
type OfferResponse = { proposal?: Proposal | null; error?: string; code?: string };

// Server error codes identify which safety check blocked the consultation.
// Show an actionable message instead of treating every 409 as identical.
const creditInterestErrorMessage = (response: OfferResponse): string => {
  const details: Record<string, string> = {
    CREDIT_INTEREST_ORDER_NOT_ELIGIBLE: 'O pedido ou o estado do reembolso não permite esta consulta. Confira a cobrança e o histórico.',
    CREDIT_INTEREST_REFUND_EVIDENCE_REQUIRED: 'A tentativa de reembolso que falhou ainda precisa de comprovação auditada. Confira o histórico do reembolso.',
    CREDIT_INTEREST_REFUND_UNRESOLVED: 'Existe um histórico de reembolso pendente ou inconclusivo. Nenhuma proposta será enviada até esclarecer o estado financeiro.',
    CREDIT_INTEREST_PROVIDER_NOT_CONCLUSIVE: 'A nova consulta ao Mercado Pago não comprovou ausência de reembolso. Confira diretamente no Mercado Pago (somente leitura).',
    CREDIT_INTEREST_PAYMENT_UNVERIFIED: 'O pagamento canônico ainda não pôde ser identificado com segurança. Confira a cobrança e o histórico.',
    CREDIT_INTEREST_PAYMENT_CHANGED: 'O pagamento foi alterado desde a verificação inicial. É necessário conferir o histórico antes de nova consulta.',
    CREDIT_INTEREST_PROPOSAL_CONFLICT: 'Já existe uma proposta com condições diferentes para este pedido. Atualize a resposta antes de qualquer tentativa.',
  };
  const code = response.code?.trim() ?? '';
  const message = details[code] ?? response.error ?? 'Não foi possível consultar o comprador.';
  return /^[A-Z][A-Z0-9_]{2,90}$/.test(code) ? message + ' (Código: ' + code + ')' : message;
};

const money = (minor: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(minor / 100);

const endpoint = '/api/health?transport=store-promotions&surface=credit-interest';

/**
 * Consultation only, for an order already rejected/cancelled. Refusal is
 * never reverted and no coupon, credit balance or refund is created here.
 */
export function PostRejectionCreditInterest({
  storeId,
  orderId,
}: { storeId: string; orderId: string }) {
  const [bonusPercent, setBonusPercent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(true);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Proposal | null>(null);

  const checkStatus = useCallback(async (): Promise<Proposal | null> => {
    const user = auth.currentUser;
    if (!user) throw new Error('Entre na sua conta para consultar o comprador.');
    const query = new URLSearchParams({
      transport: 'store-promotions',
      surface: 'credit-interest',
      path: 'status',
      storeId,
      orderId,
    });
    const response = await fetch('/api/health?' + query.toString(), {
      method: 'GET',
      headers: {authorization: 'Bearer ' + await user.getIdToken()},
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({})) as OfferResponse;
    if (!response.ok) throw new Error(payload.error || 'Não foi possível consultar o retorno da compradora.');
    return payload.proposal ?? null;
  }, [storeId, orderId]);

  useEffect(() => {
    let active = true;
    setLookupBusy(true);
    setError('');
    setResult(null);
    void checkStatus()
      .then(proposal => { if (active) setResult(proposal); })
      .catch(caught => {
        if (active) setError(caught instanceof Error ? caught.message : 'Consulta indisponível.');
      })
      .finally(() => { if (active) setLookupBusy(false); });
    return () => { active = false; };
  }, [checkStatus]);

  const refresh = async (): Promise<void> => {
    if (busy || lookupBusy) return;
    setLookupBusy(true);
    setError('');
    try {
      setResult(await checkStatus());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Consulta indisponível.');
    } finally {
      setLookupBusy(false);
    }
  };

  const offer = async (): Promise<void> => {
    if (busy || lookupBusy || result || error) return;
    setBusy(true);
    setError('');
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Entre na sua conta para consultar o comprador.');
      const response = await fetch(endpoint + '&path=offer', {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + await user.getIdToken(),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ storeId, orderId, bonusPercent }),
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({})) as OfferResponse;
      if (!response.ok || !payload.proposal) {
        throw new Error(creditInterestErrorMessage(payload));
      }
      setResult(payload.proposal);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Consulta não enviada.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-4 space-y-3 rounded-2xl border border-amber-500/30 bg-slate-950 p-3">
      <div className="flex items-center gap-2 text-amber-200">
        <Gift className="h-4 w-4" />
        <strong className="text-[11px]">Alternativa: consultar interesse em crédito para esta loja</strong>
      </div>
      <p className="text-[11px] leading-relaxed text-slate-300">
        Este pedido já foi recusado. Você pode consultar a compradora sobre
        uma compensação em reais, sem reabrir o pedido ou escolher um produto.
      </p>
      {lookupBusy && (
        <p className="flex items-center gap-2 text-[11px] text-slate-400">
          <LoaderCircle className="h-4 w-4 animate-spin" /> Conferindo propostas existentes...
        </p>
      )}
      {!lookupBusy && !result && !error && (
        <>
          <label className="block text-[11px] font-bold text-slate-200">
            Bônus de boa vontade (0% a 100%)
            <input type="number" min={0} max={100} step={1} inputMode="numeric"
              value={bonusPercent}
              onChange={event => {
                const value = Number(event.target.value);
                setBonusPercent(Number.isFinite(value)
                  ? Math.max(0, Math.min(100, Math.trunc(value))) : 0);
              }}
              className="mt-2 block min-h-10 w-24 rounded-xl border border-slate-700 bg-slate-900 px-3 text-xs text-white"
            />
          </label>
          <button type="button" disabled={busy} onClick={() => void offer()}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/15 px-3 text-[11px] font-bold text-amber-100 disabled:opacity-50">
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
            Consultar interesse do comprador
          </button>
        </>
      )}
      {result && (
        <div role="status" className="space-y-2 text-[11px] leading-relaxed text-amber-200">
          <p>
            Proposta registrada. Valor pago: {money(result.amountMinor)}.
            Bônus de {result.bonusPercent}%: {money(result.bonusMinor)}.
            Crédito proposto: {money(result.proposedCreditMinor)}.
          </p>
          <p>
            {result.status === 'interested'
              ? 'A compradora demonstrou interesse em negociar crédito.'
              : result.status === 'prefers_refund'
                ? 'A compradora prefere receber o reembolso do pagamento original.'
                : 'Aguardando uma resposta da compradora.'}
          </p>
          <p className="text-slate-400">
            Nenhum crédito foi emitido e o reembolso continua pendente.
          </p>
        </div>
      )}
      <button type="button" onClick={() => void refresh()} disabled={busy || lookupBusy}
        className="min-h-10 w-full rounded-xl border border-slate-700 px-3 text-[11px] font-bold text-slate-300 disabled:opacity-50">
        Atualizar resposta da compradora
      </button>
      {error && (
        <div role="alert" className="space-y-1 text-[11px] text-red-300">
          <p>{error}</p>
          <p className="text-slate-300">Nenhuma proposta é considerada enviada por este erro. Utilize os diagnósticos somente leitura antes de tentar novamente.</p>
        </div>
      )}
      <p className="text-[10px] leading-relaxed text-slate-400">
        Esta etapa apenas consulta interesse. O acordo definitivo, o saldo utilizável
        e a integração ao checkout ainda precisam de homologação.
        O pagamento nunca é marcado como estornado aqui.
      </p>
    </section>
  );
}
