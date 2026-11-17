import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { doc, onSnapshot, type Timestamp } from 'firebase/firestore';
import { db } from '../../utils/firebase';

interface TransferState {
  status: string;
  toCourierId: string;
  targetVehicle: string;
  fromConfirmed: boolean;
  toConfirmed: boolean;
  expiresAtEpochMs: number;
}

type TargetVehicle = 'bicycle' | 'motorcycle' | 'car';

export function AdminSupervisedTransferPanel({
  user, deliveryId, incidentStatus,
}: { user: User; deliveryId: string; incidentStatus: string }) {
  const [transfer, setTransfer] = useState<TransferState | null>(null);
  const [recipientId, setRecipientId] = useState('');
  const [vehicle, setVehicle] = useState<TargetVehicle>('bicycle');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => onSnapshot(doc(db, 'deliveryCustodyTransfers', deliveryId),
    snapshot => {
      const data = snapshot.data() as Record<string, unknown> | undefined;
      if (!data) { setTransfer(null); return; }
      const expiresAt = data.expiresAt as Timestamp | undefined;
      setTransfer({
        status: typeof data.status === 'string' ? data.status : '',
        toCourierId: typeof data.toCourierId === 'string' ? data.toCourierId : '',
        targetVehicle: typeof data.targetVehicle === 'string' ? data.targetVehicle : '',
        fromConfirmed: Boolean(data.fromConfirmedAt),
        toConfirmed: Boolean(data.toConfirmedAt),
        expiresAtEpochMs: typeof expiresAt?.toMillis === 'function' ? expiresAt.toMillis() : 0,
      });
    },
    () => setMessage('Não foi possível consultar o protocolo privado.')
  ), [deliveryId]);

  const act = async (kind: 'propose' | 'attest') => {
    if (busy) return;
    if (kind === 'propose' && !/^[a-zA-Z0-9_-]{1,128}$/.test(recipientId.trim())) {
      setMessage('Informe o UID do substituto cadastrado.');
      return;
    }
    const note = window.prompt(kind === 'propose'
      ? 'Informe o motivo da substituição e a supervisão logística (10–500 caracteres):'
      : 'Descreva a revisão das DUAS declarações individuais. Isto não altera a atribuição, o GPS ou os pagamentos (10–500 caracteres):')?.trim();
    if (!note) return;
    if (note.length < 10 || note.length > 500) {
      setMessage('A justificativa deve ter de 10 a 500 caracteres.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const token = await user.getIdToken();
      const suffix = kind === 'attest' ? '/attest' : '';
      const response = await fetch(
        `/api/delivery-opportunities/admin/compliance-incidents/${encodeURIComponent(deliveryId)}/supervised-handoff${suffix}`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify(kind === 'propose'
            ? {toCourierId: recipientId.trim(), targetVehicle: vehicle, reason: note}
            : {note}),
        }
      );
      const result = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) throw new Error(
        typeof result.error === 'string' ? result.error : 'A operação foi recusada.'
      );
      setMessage(kind === 'propose'
        ? 'Substituto indicado. Aguarde os dois reconhecimentos individuais.'
        : 'Evidências revisadas. A transferência operacional e a remuneração continuam bloqueadas.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'A operação não foi concluída.');
    } finally {
      setBusy(false);
    }
  };

  if (!['awaiting_supervised_handoff','transfer_evidence_confirmed_pending_reconciliation'].includes(incidentStatus)) return null;
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
      <h4 className="text-[10px] font-black text-amber-200">Protocolo de entrega supervisionada</h4>
      <p className="text-[9px] text-slate-400">
        Confirmações independentes do entregador original e do substituto, seguidas de revisão do supervisor.
        O protocolo NÃO muda a responsabilidade operacional nem libera remuneração.
      </p>
      {message && <p className="rounded-lg bg-amber-500/10 p-2 text-[9px] text-amber-100">{message}</p>}
      {!transfer && incidentStatus === 'awaiting_supervised_handoff' ? (
        <>
          <label className="block text-[9px] text-slate-300">
            UID do substituto habilitado
            <input value={recipientId} onChange={event => setRecipientId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-[10px] text-white"
              placeholder="UID autenticado" />
          </label>
          <label className="block text-[9px] text-slate-300">
            Modalidade aprovada do substituto
            <select value={vehicle} onChange={event => setVehicle(event.target.value as TargetVehicle)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-[10px] text-white">
              <option value="bicycle">Bicicleta</option>
              <option value="motorcycle">Motocicleta</option>
              <option value="car">Carro</option>
            </select>
          </label>
          <button type="button" disabled={busy} onClick={() => void act('propose')}
            className="rounded-lg bg-amber-500 px-3 py-2 text-[9px] font-black text-slate-950 disabled:opacity-50">
            Indicar substituto (sem reatribuição)
          </button>
        </>
      ) : transfer ? (
        <>
          <p className="text-[9px] text-slate-300">
            Substituto: {transfer.toCourierId} · {transfer.targetVehicle}
          </p>
          <p className="text-[9px] text-slate-300">
            Original declarou entrega: {transfer.fromConfirmed ? 'sim' : 'não'}.
            Substituto declarou recebimento: {transfer.toConfirmed ? 'sim' : 'não'}.
          </p>
          {transfer.status === 'awaiting_supervisor_review'
            && transfer.fromConfirmed && transfer.toConfirmed
            && transfer.expiresAtEpochMs > Date.now() && (
            <button type="button" disabled={busy} onClick={() => void act('attest')}
              className="rounded-lg bg-teal-500 px-3 py-2 text-[9px] font-black text-slate-950 disabled:opacity-50">
              Revisar duas declarações
            </button>
          )}
          {transfer.expiresAtEpochMs <= Date.now()
            && transfer.status !== 'evidence_recorded_pending_reconciliation' && (
            <p className="text-[9px] text-red-300">
              Prazo de confirmação expirado. Solicite nova decisão da logística.
            </p>
          )}
          {transfer.status === 'evidence_recorded_pending_reconciliation' && (
            <p className="rounded-lg border border-red-500/20 bg-red-500/10 p-2 text-[9px] text-red-200">
              Evidências registradas. Atribuição, GPS e pagamento exigem conciliação controlada.
              Não considerar a corrida reatribuída.
            </p>
          )}
        </>
      ) : (
        <p className="text-[9px] text-red-200">Protocolo indisponível; não autorize transferência por esta tela.</p>
      )}
    </div>
  );
}
