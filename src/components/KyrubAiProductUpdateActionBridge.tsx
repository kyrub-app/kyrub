import { useEffect, useState } from 'react';
import { CheckCircle2, LoaderCircle, Pencil, X } from 'lucide-react';
import type { KyrubAiUpdateProductProposal } from '../../shared/kyrubActions';
import { executeKyrubAction } from '../actions/kyrubActionService';
import { invalidateKyrubErpContext } from '../actions/erpReadActionService';
import {
  KYRUB_AI_ACTION_PROPOSAL_EVENT,
  type KyrubAiActionProposalEventDetail,
} from '../ai/actionEvents';
import { auth } from '../utils/firebase';

type ConfirmationState = 'reviewing' | 'executing' | 'success' | 'error';

type PendingProductUpdate = {
  conversationId: string;
  proposal: KyrubAiUpdateProductProposal;
  state: ConfirmationState;
  errorMessage: string;
  alreadyApplied: boolean;
};

const withIdempotency = (
  conversationId: string,
  proposal: KyrubAiUpdateProductProposal
): KyrubAiUpdateProductProposal => ({
  ...proposal,
  origin: proposal.origin ?? 'kyrubia',
  risk: proposal.risk ?? 'medium',
  idempotencyKey:
    proposal.idempotencyKey ??
    `kyrubia:${proposal.type}:${conversationId}:${proposal.id}`,
});

export function KyrubAiProductUpdateActionBridge() {
  const [pending, setPending] = useState<PendingProductUpdate | null>(null);

  useEffect(() => {
    const handleProposal = (event: Event) => {
      const detail = (event as CustomEvent<KyrubAiActionProposalEventDetail>).detail;
      if (!detail || detail.proposal.type !== 'update_product') return;

      setPending({
        conversationId: detail.conversationId,
        proposal: withIdempotency(detail.conversationId, detail.proposal),
        state: 'reviewing',
        errorMessage: '',
        alreadyApplied: false,
      });
    };

    window.addEventListener(KYRUB_AI_ACTION_PROPOSAL_EVENT, handleProposal);
    return () =>
      window.removeEventListener(KYRUB_AI_ACTION_PROPOSAL_EVENT, handleProposal);
  }, []);

  if (!pending) return null;

  const close = () => {
    if (pending.state === 'executing') return;
    setPending(null);
  };

  const confirm = async () => {
    if (pending.state === 'executing') return;
    setPending(current => current ? {
      ...current,
      state: 'executing',
      errorMessage: '',
    } : current);

    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('Faça login novamente antes de confirmar esta alteração.');
      }

      const result = await executeKyrubAction(user, pending.proposal, true);
      invalidateKyrubErpContext(user.uid);
      setPending(current => current ? {
        ...current,
        state: 'success',
        errorMessage: '',
        alreadyApplied: result.status === 'already_applied',
      } : current);
    } catch (error) {
      setPending(current => current ? {
        ...current,
        state: 'error',
        errorMessage: error instanceof Error
          ? error.message
          : 'Não foi possível atualizar o produto.',
      } : current);
    }
  };

  const isWorking = pending.state === 'executing';
  const isSuccess = pending.state === 'success';
  const nextName = pending.proposal.patch.name ?? '';

  return (
    <div className="fixed inset-0 z-[121] flex items-start justify-center overflow-y-auto bg-slate-950/85 p-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-sm sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={isSuccess ? 'Produto atualizado' : 'Confirmar alteração do produto'}
        className="w-full max-w-md overflow-hidden rounded-3xl border border-violet-500/25 bg-slate-950 shadow-2xl"
      >
        <header className="flex items-start gap-3 border-b border-slate-800 p-4">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
            isSuccess
              ? 'bg-emerald-500/15 text-emerald-300'
              : 'bg-violet-500/15 text-violet-300'
          }`}>
            {isSuccess
              ? <CheckCircle2 className="h-6 w-6" />
              : <Pencil className="h-6 w-6" />}
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-xs font-black uppercase tracking-wider text-violet-300">
              Kyrubia
            </span>
            <h2 className="mt-1 text-xl font-black text-white">
              {isSuccess ? 'Produto atualizado' : 'Confirmar alteração do produto'}
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={isWorking}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-400 disabled:opacity-40"
            aria-label="Fechar confirmação"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 p-4">
          {isSuccess ? (
            <p className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-4 text-sm leading-relaxed text-emerald-100">
              {pending.alreadyApplied
                ? 'Essa alteração já havia sido aplicada. Nenhuma mudança duplicada foi executada.'
                : 'O nome do produto foi atualizado pelo executor oficial do Kyrub e será sincronizado no catálogo da sua loja.'}
            </p>
          ) : (
            <>
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <span className="text-[11px] font-black uppercase text-slate-500">
                  Produto identificado
                </span>
                <p className="mt-1 text-sm text-slate-300">
                  {pending.proposal.expectedCurrentName}
                </p>
                <span className="mt-4 block text-[11px] font-black uppercase text-slate-500">
                  Novo nome
                </span>
                <p className="mt-1 text-lg font-black text-white">{nextName}</p>
              </div>
              <p className="text-xs leading-relaxed text-slate-500">
                Nada será alterado antes da confirmação. O servidor revalidará que este identificador ainda pertence à sua loja e que o nome atual continua sendo o mostrado acima.
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
          {isSuccess ? (
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
                disabled={isWorking}
                className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-black text-slate-300 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirm()}
                disabled={isWorking}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 py-3 text-sm font-black text-white disabled:opacity-60"
              >
                {isWorking ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    Salvando...
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
