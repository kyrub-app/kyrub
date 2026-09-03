import { useEffect, useState } from 'react';
import { CheckCircle2, Clock3, LoaderCircle, Store, X } from 'lucide-react';
import type { KyrubActionProposal } from '../../shared/kyrubActions';
import type { StoreOperationProposal, StoreOperationWeekday } from '../../shared/storeOperationAction';
import { executeKyrubAction } from '../actions/kyrubActionService';
import { invalidateKyrubErpContext } from '../actions/erpReadActionService';
import {
  KYRUB_STORE_OPERATION_PROPOSAL_EVENT,
  type KyrubStoreOperationProposalEventDetail,
} from '../ai/storeOperationEvents';
import { auth } from '../utils/firebase';
import { KyrubAiStoreConnectionOnboardingBridge } from './KyrubAiStoreConnectionOnboardingBridge';

type ConfirmationState = 'reviewing' | 'executing' | 'success' | 'error';

type PendingStoreOperation = {
  conversationId: string;
  proposal: StoreOperationProposal;
  state: ConfirmationState;
  errorMessage: string;
  alreadyApplied: boolean;
};

const STATUS_LABELS = {
  open: 'Aberta',
  delayed: 'Atendimento atrasado',
  closed: 'Fechada',
} as const;

const DAY_LABELS: Record<StoreOperationWeekday, string> = {
  monday: 'Segunda-feira',
  tuesday: 'Terça-feira',
  wednesday: 'Quarta-feira',
  thursday: 'Quinta-feira',
  friday: 'Sexta-feira',
  saturday: 'Sábado',
  sunday: 'Domingo',
};

const withIdempotency = (
  conversationId: string,
  proposal: StoreOperationProposal
): StoreOperationProposal => ({
  ...proposal,
  idempotencyKey: proposal.idempotencyKey ?? `kyrubia:${proposal.type}:${conversationId}:${proposal.id}`,
});

function KyrubAiStoreOperationConfirmationBridge() {
  const [pending, setPending] = useState<PendingStoreOperation | null>(null);

  useEffect(() => {
    const handleProposal = (event: Event) => {
      const detail = (event as CustomEvent<KyrubStoreOperationProposalEventDetail>).detail;
      if (!detail || detail.proposal.type !== 'update_store_operation') return;
      setPending({
        conversationId: detail.conversationId,
        proposal: withIdempotency(detail.conversationId, detail.proposal),
        state: 'reviewing',
        errorMessage: '',
        alreadyApplied: false,
      });
    };
    window.addEventListener(KYRUB_STORE_OPERATION_PROPOSAL_EVENT, handleProposal);
    return () => window.removeEventListener(KYRUB_STORE_OPERATION_PROPOSAL_EVENT, handleProposal);
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
        errorMessage: 'Faça login novamente antes de alterar a operação da loja.',
      } : value);
      return;
    }

    const current = pending;
    setPending(value => value ? { ...value, state: 'executing', errorMessage: '' } : value);
    try {
      const result = await executeKyrubAction(
        user,
        current.proposal as unknown as KyrubActionProposal,
        true
      );
      invalidateKyrubErpContext(user.uid);
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
          : 'Não foi possível atualizar a operação da loja.',
      } : value);
    }
  };

  return (
    <div className="fixed inset-0 z-[124] flex items-start justify-center overflow-y-auto bg-slate-950/85 p-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-sm sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={success ? 'Operação da loja atualizada' : 'Confirmar operação da loja'}
        className="w-full max-w-md overflow-hidden rounded-3xl border border-violet-500/25 bg-slate-950 shadow-2xl"
      >
        <header className="flex items-start gap-3 border-b border-slate-800 p-4">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${success ? 'bg-emerald-500/15 text-emerald-300' : 'bg-violet-500/15 text-violet-300'}`}>
            {success ? <CheckCircle2 className="h-6 w-6" /> : <Store className="h-6 w-6" />}
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-xs font-black uppercase tracking-wider text-violet-300">Kyrubia · Loja</span>
            <h2 className="mt-1 text-xl font-black text-white">
              {success ? 'Operação atualizada' : 'Confirmar alteração operacional'}
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
                : 'A operação da loja foi atualizada pelo backend autenticado.'}
            </p>
          ) : (
            <>
              {pending.proposal.status && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3">
                    <span className="block text-[9px] font-black uppercase text-slate-500">Estado conferido</span>
                    <strong className="mt-1 block text-sm text-slate-200">
                      {pending.proposal.expectedCurrentStatus
                        ? STATUS_LABELS[pending.proposal.expectedCurrentStatus]
                        : 'Não informado'}
                    </strong>
                  </div>
                  <div className="rounded-xl border border-violet-500/20 bg-violet-500/10 px-3 py-3">
                    <span className="block text-[9px] font-black uppercase text-violet-300">Novo estado</span>
                    <strong className="mt-1 block text-sm text-white">
                      {STATUS_LABELS[pending.proposal.status]}
                    </strong>
                  </div>
                </div>
              )}

              {(pending.proposal.openingHours?.length ?? 0) > 0 && (
                <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                  <div className="flex items-center gap-2 text-violet-300">
                    <Clock3 className="h-4 w-4" />
                    <span className="text-xs font-black uppercase tracking-wider">Horários</span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {pending.proposal.openingHours?.map(item => (
                      <div key={item.day} className="flex items-center justify-between gap-3 rounded-xl bg-slate-950 px-3 py-2 text-sm">
                        <strong className="text-slate-200">{DAY_LABELS[item.day]}</strong>
                        <span className="text-slate-400">
                          {item.enabled ? `${item.opensAt} às ${item.closesAt}` : 'Fechado'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-xs leading-relaxed text-slate-500">
                A confirmação altera somente o estado operacional e/ou horários informados. Configurações de integrações externas, credenciais, roteamento e IDs de parceiros não fazem parte desta ação.
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
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 py-3 text-sm font-black text-white disabled:opacity-60"
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

export function KyrubAiStoreOperationActionBridge() {
  return (
    <>
      <KyrubAiStoreConnectionOnboardingBridge />
      <KyrubAiStoreOperationConfirmationBridge />
    </>
  );
}
