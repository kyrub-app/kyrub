import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { doc, onSnapshot, type Timestamp } from 'firebase/firestore';
import { db } from '../../utils/firebase';

type FinanceRecord = {
  status: string;
  operatorId: string;
  fromCourierId: string;
  toCourierId: string;
  amountMinor: number;
  outgoingMinor: number;
  incomingMinor: number;
  outgoingAccepted: boolean;
  incomingAccepted: boolean;
  unresolvedObligationCount: number;
  expiresAtEpochMs: number;
};

const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const number = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) ? value : 0;
const currency = (minor: number) => (minor / 100).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
const cents = (text: string): number | null => {
  if (!/^\d{1,10}$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};

export function AdminDeliveryFinancialReconciliationPanel({
  user, deliveryId, incidentStatus,
}: { user: User; deliveryId: string; incidentStatus: string }) {
  const [value, setValue] = useState<FinanceRecord | null>(null);
  const [readTotal, setReadTotal] = useState<number | null>(null);
  const [unresolved, setUnresolved] = useState(0);
  const [outgoingText, setOutgoingText] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => onSnapshot(doc(db,'deliveryFinancialReconciliations',deliveryId),
    snapshot => {
      const data = snapshot.data() as Record<string, unknown> | undefined;
      if (!data) { setValue(null); return; }
      const expire = data.expiresAt as Timestamp | undefined;
      const ids = Array.isArray(data.unresolvedObligationIds) ? data.unresolvedObligationIds : [];
      setValue({
        status: clean(data.status),
        operatorId: clean(data.operatorId),
        fromCourierId: clean(data.fromCourierId),
        toCourierId: clean(data.toCourierId),
        amountMinor: number(data.amountMinor),
        outgoingMinor: number(data.outgoingMinor),
        incomingMinor: number(data.incomingMinor),
        outgoingAccepted: Boolean(data.outgoingAcceptedAt),
        incomingAccepted: Boolean(data.incomingAcceptedAt),
        unresolvedObligationCount: ids.length,
        expiresAtEpochMs: typeof expire?.toMillis === 'function' ? expire.toMillis() : 0,
      });
    }, error => {
      console.warn('Financial reconciliation private read failed.', error);
      setMessage('A conciliação privada está indisponível.');
    }
  ), [deliveryId]);

  const request = async (path: string, method: 'GET'|'POST', payload?: object) => {
    const token = await user.getIdToken();
    const response = await fetch(
      `/api/delivery-opportunities/admin/compliance-incidents/${encodeURIComponent(deliveryId)}/remuneration/${path}`,
      { method, headers: { authorization: `Bearer ${token}`,
        ...(method === 'POST' ? {'content-type':'application/json'} : {}) },
        ...(method === 'POST' ? { body: JSON.stringify(payload ?? {}) } : {}) }
    );
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(clean(data.error) || 'Conciliação indisponível.');
    return data;
  };

  const preflight = async () => {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      const result = await request('preflight','GET');
      if (!Number.isSafeInteger(result.totalMinor) || Number(result.totalMinor) <= 0) {
        throw new Error('Valor oficial não encontrado.');
      }
      setReadTotal(Number(result.totalMinor));
      setUnresolved(number(result.unresolvedObligationCount));
      setOutgoingText(String(Number(result.totalMinor) / 2 | 0));
      if (number(result.unresolvedObligationCount) > 0) {
        setMessage('Existem obrigações pendentes que exigirão conciliação financeira separada. Nenhuma será quitada automaticamente.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Fonte financeira indisponível.');
    } finally { setBusy(false); }
  };

  const propose = async () => {
    if (busy || readTotal === null) return;
    const outgoingMinor = cents(outgoingText);
    if (outgoingMinor === null || outgoingMinor > readTotal
      || reason.trim().length < 10 || reason.trim().length > 500) {
      setMessage('Divisão inválida em centavos ou justificativa fora de 10–500 caracteres.');
      return;
    }
    setBusy(true); setMessage('');
    try {
      await request('propose','POST', {
        outgoingMinor,
        incomingMinor: readTotal - outgoingMinor,
        reason: reason.trim(),
      });
      setMessage('Termos registrados. Os dois entregadores precisam aceitar sua parcela antes da revisão independente.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível propor a divisão.');
    } finally { setBusy(false); }
  };

  const approve = async () => {
    if (busy) return;
    const justification = window.prompt('Descreva sua revisão independente do valor oficial, evidências e pendências (10–500 caracteres). Isto NÃO libera pagamento nem reatribuição:')?.trim();
    if (!justification) return;
    if (justification.length < 10 || justification.length > 500) {
      setMessage('A justificativa deve ter entre 10 e 500 caracteres.'); return;
    }
    setBusy(true); setMessage('');
    try {
      await request('approve','POST',{reason:justification});
      setMessage('Divisão aprovada para conciliação manual; nenhuma obrigação foi criada, liberada ou liquidada.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'A revisão foi recusada.');
    } finally { setBusy(false); }
  };

  if (incidentStatus !== 'transfer_evidence_confirmed_pending_reconciliation') return null;
  const chosen = cents(outgoingText);
  const expired = Boolean(value && value.expiresAtEpochMs <= Date.now());
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
      <p className="text-[10px] font-black text-cyan-200">Conciliação de remuneração — sem execução financeira</p>
      <p className="text-[9px] text-slate-400">
        Use exclusivamente o valor capturado no ERP. Os dois entregadores aceitam suas parcelas
        e outro administrador revisa. Pagamento, repasse e troca do responsável permanecem bloqueados.
      </p>
      {message && <p className="rounded-lg bg-amber-500/10 p-2 text-[9px] text-amber-100">{message}</p>}
      {!value ? (
        <>
          <button type="button" disabled={busy} onClick={() => void preflight()}
            className="rounded-lg border border-cyan-500/30 px-3 py-2 text-[9px] text-cyan-200 disabled:opacity-50">
            Consultar valor oficial da entrega
          </button>
          {readTotal !== null && (
            <div className="space-y-2">
              <p className="text-[10px] text-white">Remuneração autorizada: <strong>{currency(readTotal)}</strong></p>
              <label className="block text-[9px] text-slate-300">
                Parcela do entregador original (centavos inteiros)
                <input inputMode="numeric" value={outgoingText}
                  onChange={event => setOutgoingText(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
              </label>
              <p className="text-[9px] text-slate-300">
                Original: {chosen !== null && chosen <= readTotal ? currency(chosen) : 'Inválido'}
                {' · '}Substituto: {chosen !== null && chosen <= readTotal
                  ? currency(readTotal - chosen) : 'Inválido'}
              </p>
              {unresolved > 0 && <p className="text-[9px] text-amber-200">
                {unresolved} obrigação(ões) econômica(s) pendente(s), fora desta divisão.
              </p>}
              <textarea value={reason} onChange={event => setReason(event.target.value)}
                placeholder="Justifique a divisão e o encaminhamento financeiro"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-[10px] text-white"
                rows={2} maxLength={500} />
              <button type="button" disabled={busy || chosen === null || chosen > readTotal}
                onClick={() => void propose()}
                className="rounded-lg bg-cyan-500 px-3 py-2 text-[9px] font-black text-slate-950 disabled:opacity-50">
                Registrar proposta sem movimentação
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-[9px] text-slate-300">
            Valor oficial: {currency(value.amountMinor)}.
            Original: {currency(value.outgoingMinor)}.
            Substituto: {currency(value.incomingMinor)}.
          </p>
          <p className="text-[9px] text-slate-300">
            Aceite original: {value.outgoingAccepted ? 'sim' : 'não'}.
            Aceite substituto: {value.incomingAccepted ? 'sim' : 'não'}.
            {' '}Situação: {value.status}.
          </p>
          {value.unresolvedObligationCount > 0 && <p className="text-[9px] text-amber-200">
            Existem {value.unresolvedObligationCount} obrigações pendentes separadas.
            A aprovação da divisão não as altera.
          </p>}
          {value.status === 'awaiting_independent_review' && value.operatorId !== user.uid && !expired && (
            <button type="button" disabled={busy} onClick={() => void approve()}
              className="rounded-lg bg-teal-500 px-3 py-2 text-[9px] font-black text-slate-950 disabled:opacity-50">
              Revisar independentemente — sem pagamento
            </button>
          )}
          {expired && value.status !== 'approved_pending_manual_execution' && (
            <p className="text-[9px] text-red-200">Termos expirados. Solicite revisão logística; não prossiga automaticamente.</p>
          )}
          {value.status === 'approved_pending_manual_execution' && (
            <p className="rounded-lg border border-red-500/25 bg-red-500/10 p-2 text-[9px] text-red-200">
              Termos aprovados apenas para execução manual controlada. O sistema não efetuou repasses
              nem reatribuiu a entrega; é indispensável conciliar as obrigações pendentes.
            </p>
          )}
        </>
      )}
    </div>
  );
}
