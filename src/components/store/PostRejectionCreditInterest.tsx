import { useState } from 'react';
import { Gift, LoaderCircle } from 'lucide-react';
import { auth } from '../../utils/firebase';

type OfferResponse = {
  proposal?: {
    status: string;
    amountMinor: number;
    bonusPercent: number;
    bonusMinor: number;
    proposedCreditMinor: number;
    creditIssued: false;
  };
  error?: string;
};

const money = (minor: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(minor / 100);

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
  const [error, setError] = useState('');
  const [result, setResult] = useState<OfferResponse['proposal'] | null>(null);

  const offer = async (): Promise<void> => {
    if (busy || result) return;
    setBusy(true);
    setError('');
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Entre na sua conta para consultar o comprador.');
      const response = await fetch(
        '/api/health?transport=store-promotions&surface=credit-interest&path=offer',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${await user.getIdToken()}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ storeId, orderId, bonusPercent }),
          cache: 'no-store',
        },
      );
      const payload = await response.json().catch(() => ({})) as OfferResponse;
      if (!response.ok || !payload.proposal) {
        throw new Error(payload.error || 'Não foi possível consultar o comprador.');
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
        Como o pedido já foi recusado, você pode perguntar se o comprador
        deseja negociar uma compensação em reais, com bônus opcional pelo transtorno.
        Não é preciso reabrir o pedido nem escolher um produto.
      </p>
      {!result && (
        <>
          <label className="block text-[11px] font-bold text-slate-200">
            Bônus de boa vontade (0% a 100%)
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              inputMode="numeric"
              value={bonusPercent}
              onChange={event => {
                const value = Number(event.target.value);
                setBonusPercent(Number.isFinite(value) ? Math.max(0, Math.min(100, Math.trunc(value))) : 0);
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
        <p role="status" className="text-[11px] leading-relaxed text-amber-200">
          Consulta registrada. Valor pago: {money(result.amountMinor)}.
          Bônus de {result.bonusPercent}%: {money(result.bonusMinor)}.
          Crédito proposto: {money(result.proposedCreditMinor)}.
          Nenhum crédito foi emitido e o reembolso continua pendente.
        </p>
      )}
      {error && <p role="alert" className="text-[11px] text-red-300">{error}</p>}
      <p className="text-[10px] leading-relaxed text-slate-400">
        Esta etapa apenas consulta interesse. O acordo final precisa de aceite expresso,
        emissão de saldo segura e checkout compatível. O pagamento nunca é marcado como estornado aqui.
      </p>
    </section>
  );
}
