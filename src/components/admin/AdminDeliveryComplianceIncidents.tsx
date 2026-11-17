import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { collection, getDocs, limit, onSnapshot, query, where, type Timestamp } from 'firebase/firestore';
import { AlertTriangle, ClipboardList } from 'lucide-react';
import { db } from '../../utils/firebase';
import { AdminSupervisedTransferPanel } from './AdminSupervisedTransferPanel';
import { AdminDeliveryFinancialReconciliationPanel } from './AdminDeliveryFinancialReconciliationPanel';

type IncidentDecision =
  | 'release_for_new_acceptance'
  | 'request_supervised_handoff'
  | 'close_after_buyer_confirmation';

interface Incident {
  id: string;
  courierId: string;
  storeId: string;
  status: string;
  deliveryStatusAtReview: string;
  decision: string;
  reason: string;
  resolvedBy: string;
}

interface IncidentEvent {
  id: string;
  operatorId: string;
  decision: string;
  reason: string;
  createdAt: string;
}

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const PENDING = ['awaiting_logistics_review', 'awaiting_supervised_handoff'];

export function AdminDeliveryComplianceIncidents({ user }: { user: User }) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [busy, setBusy] = useState('');
  const [historyBusy, setHistoryBusy] = useState('');
  const [history, setHistory] = useState<Record<string, IncidentEvent[]>>({});
  const [message, setMessage] = useState('');

  useEffect(() => onSnapshot(
    query(collection(db, 'deliveryComplianceIncidents'), limit(100)),
    snapshot => setIncidents(snapshot.docs.map(item => {
      const data = item.data() as Record<string, unknown>;
      return {
        id: item.id,
        courierId: clean(data.courierId),
        storeId: clean(data.storeId),
        status: clean(data.status),
        deliveryStatusAtReview: clean(data.deliveryStatusAtReview),
        decision: clean(data.decision),
        reason: clean(data.reason),
        resolvedBy: clean(data.resolvedBy),
      };
    })),
    error => {
      console.warn('Logistics compliance incident queue unavailable.', error);
      setMessage('Não foi possível consultar a fila privada de incidentes.');
    }
  ), []);

  const ordered = useMemo(() => [...incidents].sort((a,b) => {
    const priority = (value: Incident): number =>
      value.status === 'awaiting_logistics_review' ? 0
        : value.status === 'awaiting_supervised_handoff' ? 1 : 2;
    return priority(a) - priority(b) || a.id.localeCompare(b.id);
  }), [incidents]);

  const resolve = async (incident: Incident, decision: IncidentDecision) => {
    if (busy || !PENDING.includes(incident.status)) return;
    const instructions = decision === 'release_for_new_acceptance'
      ? 'Liberar para novo aceite SOMENTE se ainda estiver na loja, sem coleta. Informe a justificativa logística (mínimo 10 caracteres):'
      : decision === 'request_supervised_handoff'
        ? 'Encaminhar transferência física supervisionada. NÃO transfere a atribuição nem autoriza condução. Informe o plano de segurança (mínimo 10 caracteres):'
        : 'Encerrar o incidente SOMENTE após confirmação de recebimento pelo comprador. Informe a justificativa (mínimo 10 caracteres):';
    const reason = window.prompt(instructions)?.trim();
    if (!reason) return;
    if (reason.length < 10 || reason.length > 500) {
      setMessage('A justificativa deve conter entre 10 e 500 caracteres.');
      return;
    }
    setBusy(incident.id);
    setMessage('');
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/delivery-opportunities/admin/compliance-incidents/${encodeURIComponent(incident.id)}/resolve`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ decision, reason }),
        }
      );
      const result = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) throw new Error(clean(result.error) || 'Operação rejeitada pelo servidor.');
      setHistory(previous => {
        const copy = { ...previous };
        delete copy[incident.id];
        return copy;
      });
      setMessage(decision === 'release_for_new_acceptance'
        ? 'Pedido liberado para um novo aceite. A atribuição, GPS e código anteriores foram invalidados.'
        : decision === 'request_supervised_handoff'
          ? 'Transferência supervisionada registrada. A atribuição original e o rastreio foram preservados.'
          : 'Incidente encerrado com base na confirmação real do comprador.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível tratar o incidente.');
    } finally {
      setBusy('');
    }
  };

  const loadHistory = async (incidentId: string) => {
    if (historyBusy) return;
    setHistoryBusy(incidentId);
    try {
      const snapshot = await getDocs(query(
        collection(db, 'deliveryComplianceIncidentEvents'),
        where('deliveryId', '==', incidentId),
        limit(30)
      ));
      setHistory(previous => ({
        ...previous,
        [incidentId]: snapshot.docs.map(item => {
          const data = item.data() as Record<string, unknown>;
          const stamp = data.createdAt as Timestamp | undefined;
          return {
            id: item.id,
            operatorId: clean(data.operatorId),
            decision: clean(data.decision),
            reason: clean(data.reason),
            createdAt: stamp && typeof stamp.toDate === 'function'
              ? stamp.toDate().toLocaleString('pt-BR') : 'Data não disponível',
          };
        }),
      }));
    } catch {
      setMessage('Não foi possível consultar o histórico protegido.');
    } finally {
      setHistoryBusy('');
    }
  };

  return (
    <section className="mt-6 rounded-3xl border border-orange-500/20 bg-slate-950 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 text-orange-300" />
        <div>
          <h3 className="text-sm font-black text-white">Incidentes de entregas — revisão logística</h3>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
            Sem reatribuição automática de pacotes já coletados. A liberação antes da coleta
            reinicia o aceite e invalida o código antigo; após a coleta, é necessária transferência
            física supervisionada. Somente o comprador confirma a conclusão da entrega.
          </p>
        </div>
      </div>
      {message && (
        <p className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[10px] text-amber-100">
          {message}
        </p>
      )}
      {ordered.length === 0 ? (
        <p className="mt-4 text-[10px] text-slate-500">Nenhum incidente de motofrete nesta fila.</p>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {ordered.map(incident => (
            <article key={incident.id} className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900 p-3">
              <p className="truncate text-[10px] font-bold text-slate-100">
                Entrega {incident.id}
              </p>
              <p className="mt-1 text-[9px] text-slate-400">
                Entregador {incident.courierId} · Loja {incident.storeId}
              </p>
              <p className="mt-1 text-[9px] text-orange-300">
                {incident.status === 'awaiting_logistics_review' ? 'Revisão pendente'
                  : incident.status === 'awaiting_supervised_handoff' ? 'Transferência supervisionada pendente'
                    : incident.status === 'transfer_evidence_confirmed_pending_reconciliation'
                      ? 'Declarações revisadas — conciliação pendente'
                    : incident.status === 'released_for_new_acceptance' ? 'Liberado para novo aceite'
                      : incident.status === 'closed_after_buyer_confirmation' ? 'Encerrado após confirmação'
                        : incident.status}
                {' · '}Fase inicial: {incident.deliveryStatusAtReview}
              </p>
              {PENDING.includes(incident.status) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {incident.status === 'awaiting_logistics_review' && (
                    <>
                      <button type="button" disabled={busy === incident.id}
                        onClick={() => void resolve(incident, 'release_for_new_acceptance')}
                        className="rounded-lg border border-teal-500/30 px-2 py-2 text-[9px] text-teal-200 disabled:opacity-50">
                        Liberar novo aceite (sem coleta)
                      </button>
                      <button type="button" disabled={busy === incident.id}
                        onClick={() => void resolve(incident, 'request_supervised_handoff')}
                        className="rounded-lg border border-orange-500/30 px-2 py-2 text-[9px] text-orange-200 disabled:opacity-50">
                        Solicitar transferência supervisionada
                      </button>
                    </>
                  )}
                  <button type="button" disabled={busy === incident.id}
                    onClick={() => void resolve(incident, 'close_after_buyer_confirmation')}
                    className="rounded-lg border border-slate-600 px-2 py-2 text-[9px] text-slate-200 disabled:opacity-50">
                    Encerrar após confirmação do comprador
                  </button>
                </div>
              )}
              <AdminSupervisedTransferPanel
                user={user} deliveryId={incident.id} incidentStatus={incident.status}
              />
              <AdminDeliveryFinancialReconciliationPanel
                user={user} deliveryId={incident.id} incidentStatus={incident.status}
              />
              {incident.reason && (
                <p className="mt-2 text-[9px] text-slate-400">Decisão: {incident.reason} · {incident.resolvedBy}</p>
              )}
              <button type="button" disabled={historyBusy === incident.id}
                onClick={() => void loadHistory(incident.id)}
                className="mt-3 flex items-center gap-1 text-[9px] text-cyan-300 disabled:opacity-50">
                <ClipboardList className="h-3.5 w-3.5" />
                {historyBusy === incident.id ? 'Consultando...' : 'Consultar eventos imutáveis'}
              </button>
              {history[incident.id] && (
                <div className="mt-2 max-h-28 space-y-1 overflow-y-auto rounded-lg bg-slate-950 p-2">
                  {history[incident.id].length === 0
                    ? <p className="text-[9px] text-slate-500">Sem decisões registradas neste fluxo.</p>
                    : history[incident.id].map(item => (
                      <p key={item.id} className="text-[9px] text-slate-300">
                        {item.createdAt} · {item.operatorId} · {item.decision} · {item.reason}
                      </p>
                    ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {ordered.length >= 100 && (
        <p className="mt-3 text-[9px] text-amber-300">
          Lista limitada a 100 incidentes. Utilize o histórico e a triagem para evitar omissões.
        </p>
      )}
    </section>
  );
}
