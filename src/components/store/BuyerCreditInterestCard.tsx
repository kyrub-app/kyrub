import { useCallback, useEffect, useState } from 'react';
import { Gift, LoaderCircle } from 'lucide-react';
import { auth } from '../../utils/firebase';

type CreditInterestStatus = 'awaiting_response' | 'interested' | 'prefers_refund';
type Proposal = {
  schemaVersion: 1;
  storeId: string;
  orderId: string;
  buyerId: string;
  amountMinor: number;
  status: CreditInterestStatus;
  creditIssued: false;
};

const amount = (minor: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(minor / 100);
const endpoint = '/api/health?transport=store-promotions&surface=credit-interest';

export function BuyerCreditInterestCard({ storeId, buyerId }: {
  storeId: string;
  buyerId: string;
}) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [busyOrderId, setBusyOrderId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const call = useCallback(async (path: string, body?: Record<string, unknown>) => {
    const user = auth.currentUser;
    if (!user || user.uid !== buyerId) throw new Error('Entre na sua conta para consultar a proposta.');
    const token = await user.getIdToken();
    const response = await fetch(endpoint + '&path=' + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: 'Bearer ' + token,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? {body: JSON.stringify(body)} : {}),
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({})) as {
      proposals?: Proposal[];
      proposal?: Proposal;
      error?: string;
    };
    if (!response.ok) {
      throw new Error(payload.error || 'Não foi possível consultar a proposta.');
    }
    return payload;
  }, [buyerId]);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError('');
    void call('mine&storeId=' + encodeURIComponent(storeId))
      .then(payload => {
        if (!disposed) setProposals((payload.proposals ?? []).filter(
          item => item.storeId === storeId && item.buyerId === buyerId && item.creditIssued === false
        ));
      })
      .catch(fetchError => {
        if (!disposed) setError(fetchError instanceof Error ? fetchError.message : 'Não foi possível consultar propostas.');
      })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [buyerId, call, storeId]);

  const respond = async (proposal: Proposal, choice: 'interested' | 'prefers_refund') => {
    if (busyOrderId) return;
    setBusyOrderId(proposal.orderId);
    setError('');
    try {
      const response = await call('respond', { storeId, orderId: proposal.orderId, choice });
      if (!response.proposal) throw new Error('A resposta não foi confirmada.');
      setProposals(previous => previous.map(item =>
        item.orderId === proposal.orderId ? response.proposal! : item
      ));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível registrar a resposta.');
    } finally {
      setBusyOrderId('');
    }
  };

  if (loading || (proposals.length === 0 && !error)) return null;

  return (
    <section className="mx-auto mt-4 w-full max-w-5xl space-y-3 px-4" aria-label="Consultas de crédito para pedidos cancelados">
      {proposals.map(proposal => (
        <article key={proposal.orderId} className="rounded-2xl border border-amber-500/35 bg-slate-900 p-4">
          <div className="flex items-center gap-2 text-amber-200">
            <Gift className="h-4 w-4" />
            <strong className="text-xs">Consulta sobre crédito por pedido cancelado</strong>
          </div>
          <p className="mt-2 text-xs text-slate-200">
            A loja gostaria de saber se você tem interesse em negociar um cupom para uma compra futura,
            tomando como referência o pagamento de <strong>{amount(proposal.amountMinor)}</strong>.
          </p>
          <p className="mt-2 text-[11px] leading-5 text-slate-400">
            Isto ainda não é um cupom e não constitui aceite definitivo de compensação.
            Nenhum crédito foi emitido e o pagamento não foi estornado nem considerado quitado.
            As condições e a possibilidade de utilização terão de ser confirmadas com você antes de qualquer acordo.
          </p>
          {proposal.status === 'awaiting_response' ? (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <button type="button" disabled={Boolean(busyOrderId)}
                onClick={() => void respond(proposal, 'interested')}
                className="min-h-11 flex-1 rounded-xl bg-amber-500 px-3 text-xs font-bold text-slate-950 disabled:opacity-50">
                {busyOrderId === proposal.orderId && <LoaderCircle className="mr-1 inline h-4 w-4 animate-spin" />}
                Tenho interesse em negociar crédito
              </button>
              <button type="button" disabled={Boolean(busyOrderId)}
                onClick={() => void respond(proposal, 'prefers_refund')}
                className="min-h-11 flex-1 rounded-xl border border-slate-700 px-3 text-xs font-bold text-slate-200 disabled:opacity-50">
                Prefiro devolução do pagamento
              </button>
            </div>
          ) : (
            <p className="mt-3 rounded-xl border border-slate-700 bg-slate-950 p-3 text-[11px] text-slate-200" role="status">
              {proposal.status === 'interested'
                ? 'Interesse registrado. Ainda não há cupom emitido nem acordo financeiro concluído.'
                : 'Preferência pelo reembolso registrada. O pagamento segue aguardando a devolução no fluxo financeiro.'}
            </p>
          )}
        </article>
      ))}
      {error && <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">{error}</p>}
    </section>
  );
}
