import { useEffect, useState } from 'react';
import { CheckCircle2, ClipboardCheck, LoaderCircle, X } from 'lucide-react';
import type {
  KyrubAiUpdateOrderStatusProposal,
  KyrubOrderStatus,
} from '../../shared/kyrubActions';
import { executeKyrubAction } from '../actions/kyrubActionService';
import {
  KYRUB_AI_ACTION_PROPOSAL_EVENT,
  type KyrubAiActionProposalEventDetail,
} from '../ai/actionEvents';
import { auth } from '../utils/firebase';

type ConfirmationState = 'reviewing' | 'executing' | 'success' | 'error';

type PendingOrderStatus = {
  conversationId: string;
  proposal: KyrubAiUpdateOrderStatusProposal;
  state: ConfirmationState;
  errorMessage: string;
  alreadyApplied: boolean;
};

const STATUS_LABELS: Record<KyrubOrderStatus, string> = {
  pending: 'Pendente',
  accepted: 'Aceito',
  preparing: 'Em preparo',
  ready: 'Pronto',
  out_for_delivery: 'Saiu para entrega',
  completed: 'Concluído',
  rejected: 'Recusado',
  cancelled: 'Cancelado',
};

const withIdempotency = (
  conversationId: string,
  proposal: KyrubAiUpdateOrderStatusProposal
): KyrubAiUpdateOrderStatusProposal => ({
  ...proposal,
  origin: proposal.origin ?? 'kyrubia',
  risk: proposal.risk ?? 'medium',
  idempotencyKey:
    proposal.idempotencyKey ??
    `kyrubia:${proposal.type}:${conversationId}:${proposal.id}`,
});

export function KyrubAiOrderStatusActionBridge() {
  const [pending, setPending] = useState<PendingOrderStatus | null>(null);

  useEffect(() => {
    const handleProposal = (event: Event) => {
      const detail = (event as CustomEvent<KyrubAiActionProposalEventDetail>).detail;
      if (!detail || detail.proposal.type !== 'update_order_status') return;
      setPending({
        conversationId: detail.conversationId,
        proposal: withIdempotency(detail.conversationId, detail.proposal),
        state: 'reviewing',
        errorMessage: '',
        alreadyApplied: false,
      });
    };
    window.addEventListener(KYRUB_AI_ACTION_PROPOSAL_EVENT, handleProposal);
    return () => window.removeEventListener(KYRUB_AI_ACTION_PROPOSAL_EVENT, handleProposal);
  }, []);

  if (!pending) return null;

  const working = pending.state === 'executing';
  const success = pending.state === 'success';
  const close = () => {
    if (!working) setPending(null);
  };

  const confirm = async () => {
    if (working) return;
    const user = auth.currentUser;
    if (!user) {
      setPending(value => value ? {
        ...value,
        state: 'error',
        errorMessage: 'Faça login novamente antes de alterar o pedido.',
      } : value);
      return;
    }

    const current = pending;
    setPending(value => value ? { ...value, state: 'executing', errorMessage: '' } : value);
    try {
      const result = await executeKyrubAction(user, current.proposal, true);
      setPending(value => value ? {
        ...value,
        state: 'success',
        errorMessage: '',
        alreadyApplied: result.status === 'already_applied',
      } : value);
    } catch (error) {
      setPending(value => value ? {
        ...value,
        state: 'error',
        errorMessage: error instanceof Error
          ? error.message
          : 'Não foi possível atualizar o pedido.',
      } : value);
    }
  };

  return (
    <div className="fixed inset-0 z-[124] flex items-start justify-center overflow-y-auto bg-slate-950/85 p-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-sm sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={success ? 'Pedido atualizado' : 'Confirmar alteração do pedido'}
        className="w-full max-w-md overflow-hidden rounded-3xl border border-cyan-500/25 bg-slate-950 shadow-2xl"
      >
        <header className="flex items-start gap-3 border-b border-slate-800 p-4">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${success ? 'bg-emerald-500/15 text-emerald-300' : 'bg-cyan-500/15 text-cyan-300'}`}>
            {success ? <CheckCircle2 className="h-6 w-6" /> : <ClipboardCheck className="h-6 w-6" />}
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-xs font-black uppercase tracking-wider text-cyan-300">Kyrubia · Pedido</span>
            <h2 className="mt-1 text-xl font-black text-white">
              {success ? 'Pedido atualizado' : 'Confirmar alteração'}
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={working}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-400 disabled:opacity-40"
            aria-label="Fechar confirmação"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 p-4">
          {success ? (
            <p className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-4 text-sm leading-relaxed text-emerald-100">
              {pending.alreadyApplied
                ? 'Esta mesma alteração já havia sido aplicada. O Kyrub não repetiu a operação.'
                : `Pedido atualizado para “${STATUS_LABELS[pending.proposal.nextStatus]}”. O motor de estoque e integrações foi executado pelo mesmo fluxo autoritativo do painel manual.`}
            </p>
          ) : (
            <>
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <p className="text-xs font-black uppercase tracking-wider text-cyan-300">Pedido</p>
                <p className="mt-1 break-all text-base font-black text-white">{pending.proposal.orderId}</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3">
                  <span className="block text-[9px] font-black uppercase text-slate-500">Status conferido</span>
                  <strong className="mt-1 block text-sm text-slate-200">
                    {STATUS_LABELS[pending.proposal.expectedCurrentStatus]}
                  </strong>
                </div>
                <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-3">
                  <span className="block text-[9px] font-black uppercase text-cyan-300">Novo status</span>
                  <strong className="mt-1 block text-sm text-white">
                    {STATUS_LABELS[pending.proposal.nextStatus]}
                  </strong>
                </div>
              </div>

              {pending.proposal.decision?.reason && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-3">
                  <span className="block text-[9px] font-black uppercase text-amber-300">Motivo</span>
                  <p className="mt-1 text-sm text-amber-100">{pending.proposal.decision.reason}</p>
                  {pending.proposal.decision.alternative && (
                    <p className="mt-2 text-xs text-amber-200/80">
                      Alternativa: {pending.proposal.decision.alternative}
                    </p>
                  )}
                </div>
              )}

              <p className="text-xs leading-relaxed text-slate-500">
                Ao confirmar, o Kyrub altera o pedido pelo backend autenticado. Se este status acionar consumo ou estorno de estoque, a movimentação ocorrerá na mesma operação de negócio já usada pelo painel manual. Se o pedido tiver mudado desde a proposta, a execução será recusada e a Kyrubia precisará relê-lo.
              </p>

              {pending.state === 'error' && (
                <p className="rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {pending.errorMessage}
                </p>
              )}
            </>
          )}
        </div>

        <footer className="flex gap-3 border-t border-slate-800 p-4">
          {success ? (
            <button
              type="button"
              onClick={() => setPending(null)}
              className="w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-black text-slate-950"
            >
              Concluído
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={close}
                disabled={working}
                className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-black text-slate-300 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirm()}
                disabled={working}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-60"
              >
                {working ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    Atualizando...
                  </>
                ) : 'Confirmar'}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}