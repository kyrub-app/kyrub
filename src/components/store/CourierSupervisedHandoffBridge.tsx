import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { collection, limit, onSnapshot, query, where, type Timestamp } from 'firebase/firestore';
import { ArrowLeftRight, ShieldAlert } from 'lucide-react';
import { auth, db } from '../../utils/firebase';

interface FinancialTerms {
  deliveryId: string;
  status: string;
  fromCourierId: string;
  toCourierId: string;
  amountMinor: number;
  outgoingMinor: number;
  incomingMinor: number;
  outgoingAccepted: boolean;
  incomingAccepted: boolean;
  expiresAtEpochMs: number;
}
const termsFrom = (id: string, data: Record<string, unknown>): FinancialTerms => ({
  deliveryId: id,
  status: typeof data.status === 'string' ? data.status : '',
  fromCourierId: typeof data.fromCourierId === 'string' ? data.fromCourierId : '',
  toCourierId: typeof data.toCourierId === 'string' ? data.toCourierId : '',
  amountMinor: typeof data.amountMinor === 'number' ? data.amountMinor : 0,
  outgoingMinor: typeof data.outgoingMinor === 'number' ? data.outgoingMinor : 0,
  incomingMinor: typeof data.incomingMinor === 'number' ? data.incomingMinor : 0,
  outgoingAccepted: Boolean(data.outgoingAcceptedAt),
  incomingAccepted: Boolean(data.incomingAcceptedAt),
  expiresAtEpochMs: data.expiresAt && typeof data.expiresAt === 'object'
    && 'toMillis' in data.expiresAt
      ? (data.expiresAt as Timestamp).toMillis() : 0,
});
const currency = (minor: number): string => (minor / 100).toLocaleString(
  'pt-BR', { style: 'currency', currency: 'BRL' }
);

interface Transfer {
  id: string;
  fromCourierId: string;
  toCourierId: string;
  targetVehicle: string;
  status: string;
  fromConfirmedAt: boolean;
  toConfirmedAt: boolean;
  expiresAtEpochMs: number;
}

const toTransfer = (id: string, data: Record<string, unknown>): Transfer => ({
  id,
  fromCourierId: typeof data.fromCourierId === 'string' ? data.fromCourierId : '',
  toCourierId: typeof data.toCourierId === 'string' ? data.toCourierId : '',
  targetVehicle: typeof data.targetVehicle === 'string' ? data.targetVehicle : '',
  status: typeof data.status === 'string' ? data.status : '',
  fromConfirmedAt: Boolean(data.fromConfirmedAt),
  toConfirmedAt: Boolean(data.toConfirmedAt),
  expiresAtEpochMs: data.expiresAt && typeof data.expiresAt === 'object'
    && 'toMillis' in data.expiresAt
      ? (data.expiresAt as Timestamp).toMillis() : 0,
});

export function CourierSupervisedHandoffBridge() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [outgoing, setOutgoing] = useState<Transfer[]>([]);
  const [incoming, setIncoming] = useState<Transfer[]>([]);
  const [outgoingTerms, setOutgoingTerms] = useState<FinancialTerms[]>([]);
  const [incomingTerms, setIncomingTerms] = useState<FinancialTerms[]>([]);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => onAuthStateChanged(auth, next => {
    setUser(next);
    setOutgoing([]);
    setIncoming([]);
    setOutgoingTerms([]);
    setIncomingTerms([]);
    setBusy('');
    setMessage('');
    setDismissed(false);
  }), []);

  useEffect(() => {
    if (!user) return;
    const from = onSnapshot(query(
      collection(db, 'deliveryCustodyTransfers'),
      where('fromCourierId','==',user.uid), limit(25)
    ), snapshot => setOutgoing(snapshot.docs.map(item =>
      toTransfer(item.id, item.data() as Record<string, unknown>)
    )), () => setMessage('Solicitações de transferência indisponíveis.'));
    const to = onSnapshot(query(
      collection(db, 'deliveryCustodyTransfers'),
      where('toCourierId','==',user.uid), limit(25)
    ), snapshot => setIncoming(snapshot.docs.map(item =>
      toTransfer(item.id, item.data() as Record<string, unknown>)
    )), () => setMessage('Solicitações de transferência indisponíveis.'));
    const termsFromUser = onSnapshot(query(
      collection(db, 'deliveryFinancialReconciliations'),
      where('fromCourierId','==',user.uid), limit(25)
    ), snapshot => setOutgoingTerms(snapshot.docs.map(item =>
      termsFrom(item.id, item.data() as Record<string, unknown>)
    )), () => setMessage('Não foi possível consultar as parcelas propostas.'));
    const termsToUser = onSnapshot(query(
      collection(db, 'deliveryFinancialReconciliations'),
      where('toCourierId','==',user.uid), limit(25)
    ), snapshot => setIncomingTerms(snapshot.docs.map(item =>
      termsFrom(item.id, item.data() as Record<string, unknown>)
    )), () => setMessage('Não foi possível consultar as parcelas propostas.'));
    return () => { from(); to(); termsFromUser(); termsToUser(); };
  }, [user?.uid]);

  const visible = useMemo(() => Array.from(
    new Map([...outgoing,...incoming].map(item => [item.id, item])).values()
  ).filter(item =>
    ['awaiting_participant_confirmations','awaiting_supervisor_review','evidence_recorded_pending_reconciliation'].includes(item.status)
  ).slice(0, 6), [incoming, outgoing]);

  const financialTerms = useMemo(() => new Map(
    [...outgoingTerms, ...incomingTerms].map(item => [item.deliveryId, item])
  ), [outgoingTerms, incomingTerms]);

  const acceptTerms = async (item: FinancialTerms, party: 'from' | 'to') => {
    if (!user || busy) return;
    const amount = party === 'from' ? item.outgoingMinor : item.incomingMinor;
    const confirmed = window.confirm(
      `Você concorda com a proposta de remuneração de ${currency(amount)} para sua participação, total da entrega ${currency(item.amountMinor)}? Sua declaração não gera pagamento, Pix ou autorização para prosseguir a corrida.`
    );
    if (!confirmed) return;
    setBusy(item.deliveryId); setMessage('');
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/delivery-opportunities/${encodeURIComponent(item.deliveryId)}/remuneration/accept-terms`,
        { method:'POST', headers: { authorization: `Bearer ${token}`, 'content-type':'application/json' },
          body: '{}' }
      );
      const result = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof result.error === 'string'
        ? result.error : 'O aceite financeiro não foi autorizado.');
      setMessage('Sua concordância foi registrada. A revisão independente e a conciliação econômica ainda são necessárias.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível aceitar os termos.');
    } finally { setBusy(''); }
  };

  const acknowledge = async (item: Transfer, party: 'from' | 'to') => {
    if (!user || busy) return;
    const statement = party === 'from' ? 'physically_handed_over' : 'physically_received';
    const confirmed = window.confirm(party === 'from'
      ? 'Confirme somente se você ENTREGOU FISICAMENTE o pacote à pessoa indicada, na presença da logística. Isto NÃO libera o pagamento nem altera automaticamente o responsável no Kyrub.'
      : 'Confirme somente se você RECEBEU FISICAMENTE o pacote da pessoa indicada e conferiu a encomenda. Isto NÃO libera o transporte ou pagamento antes da conciliação logística.');
    if (!confirmed) return;
    setBusy(item.id);
    setMessage('');
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/delivery-opportunities/${encodeURIComponent(item.id)}/supervised-handoff/acknowledge`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ statement }),
        }
      );
      const result = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) throw new Error(
        typeof result.error === 'string' ? result.error : 'Não foi possível registrar a declaração.'
      );
      setMessage('Sua declaração foi registrada de forma auditável. Aguarde a revisão do supervisor.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'A confirmação falhou.');
    } finally {
      setBusy('');
    }
  };

  if (!user || visible.length === 0) return null;
  if (dismissed) {
    return (
      <button type="button" onClick={() => setDismissed(false)}
        className="fixed bottom-20 left-3 z-[191] flex items-center gap-2 rounded-xl border border-amber-500/30 bg-slate-950 px-3 py-3 text-[10px] font-black text-amber-200 shadow-2xl sm:bottom-5 sm:left-5">
        <ArrowLeftRight className="h-4 w-4" />
        Reabrir transferência supervisionada ({visible.length})
      </button>
    );
  }
  return (
    <aside className="fixed bottom-20 left-3 z-[191] max-h-[55vh] w-[min(92vw,340px)] overflow-y-auto rounded-3xl border border-amber-500/30 bg-slate-950/95 p-4 text-white shadow-2xl backdrop-blur-lg sm:bottom-5 sm:left-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[11px] font-black text-amber-200">
          <ArrowLeftRight className="h-4 w-4" />
          Transferência supervisionada
        </h3>
        <button type="button" onClick={() => setDismissed(true)}
          className="rounded-lg border border-slate-700 px-2 py-1 text-[9px] text-slate-300">
          Minimizar
        </button>
      </div>
      <p className="mt-2 text-[9px] leading-relaxed text-slate-400">
        Cada participante confirma somente sua própria ação. Um supervisor precisa revisar o registro.
        Isso não substitui a transferência operacional nem a conciliação financeira.
      </p>
      {message && <p className="mt-3 rounded-lg bg-amber-500/10 p-2 text-[9px] text-amber-100">{message}</p>}
      <div className="mt-3 space-y-3">
        {visible.map(item => {
          const party = item.fromCourierId === user.uid ? 'from' : 'to';
          const confirmed = party === 'from' ? item.fromConfirmedAt : item.toConfirmedAt;
          const expired = item.expiresAtEpochMs <= Date.now();
          return (
            <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3">
              <p className="truncate text-[9px] font-bold text-white">Entrega {item.id}</p>
              <p className="mt-1 text-[9px] text-slate-400">
                {party === 'from' ? 'Você entrega para' : 'Você recebe de'}{' '}
                {party === 'from' ? item.toCourierId : item.fromCourierId}
                {' · '}modalidade do substituto: {item.targetVehicle}
              </p>
              <p className="mt-1 text-[9px] text-slate-400">
                Entrega física declarada: {item.fromConfirmedAt ? 'sim' : 'não'}.
                Recebimento declarado: {item.toConfirmedAt ? 'sim' : 'não'}.
              </p>
              {financialTerms.get(item.id) && (() => {
                const financial = financialTerms.get(item.id)!;
                const accepted = party === 'from'
                  ? financial.outgoingAccepted : financial.incomingAccepted;
                const amount = party === 'from'
                  ? financial.outgoingMinor : financial.incomingMinor;
                const termsExpired = financial.expiresAtEpochMs <= Date.now();
                return (
                  <div className="mt-3 rounded-lg border border-cyan-500/25 bg-cyan-500/5 p-2">
                    <p className="text-[9px] font-black text-cyan-200">
                      Proposta de remuneração: {currency(amount)}
                    </p>
                    <p className="mt-1 text-[9px] text-slate-300">
                      Total autorizado: {currency(financial.amountMinor)}.
                      Original: {currency(financial.outgoingMinor)}.
                      Substituto: {currency(financial.incomingMinor)}.
                    </p>
                    <p className="mt-1 text-[9px] text-slate-400">
                      {financial.status === 'approved_pending_manual_execution'
                        ? 'Termos revisados; pagamento continua bloqueado.'
                        : accepted ? 'Você aceitou sua parcela; aguarde a outra parte e o revisor.'
                          : termsExpired ? 'Proposta expirada; procure a logística.'
                            : 'Leia os termos. Sua decisão exige autenticação própria.'}
                    </p>
                    {financial.status === 'awaiting_courier_terms' && !accepted && !termsExpired && (
                      <button type="button" disabled={busy === item.id}
                        onClick={() => void acceptTerms(financial, party)}
                        className="mt-2 w-full rounded-lg border border-cyan-500/30 px-3 py-2 text-[9px] font-black text-cyan-200 disabled:opacity-50">
                        Concordo com minha parcela (sem pagamento)
                      </button>
                    )}
                  </div>
                );
              })()}
              {item.status === 'awaiting_participant_confirmations' && !confirmed && !expired ? (
                <button type="button" disabled={busy === item.id}
                  onClick={() => void acknowledge(item, party)}
                  className="mt-2 w-full rounded-xl bg-amber-500 px-3 py-2 text-[9px] font-black text-slate-950 disabled:opacity-50">
                  {busy === item.id ? 'Registrando...' : party === 'from'
                    ? 'Declaro que entreguei fisicamente' : 'Declaro que recebi fisicamente'}
                </button>
              ) : (
                <p className="mt-2 flex gap-1 text-[9px] text-amber-200">
                  <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                  {expired && item.status === 'awaiting_participant_confirmations'
                    ? 'Prazo expirado. Contate a logística.'
                    : item.status === 'evidence_recorded_pending_reconciliation'
                      ? 'Declarações revisadas. Aguarde definição de custódia e remuneração.'
                      : 'Aguarde as demais confirmações e a revisão logística.'}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
