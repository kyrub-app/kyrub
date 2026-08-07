import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  FileText,
  LoaderCircle,
  X,
} from 'lucide-react';
import type { KyrubAiCreateNoteProposal } from '../../shared/aiConsultant';
import {
  KYRUB_AI_ACTION_PROPOSAL_EVENT,
  type KyrubAiActionProposalEventDetail,
} from '../ai/actionEvents';
import { executeConfirmedCreateNoteAction } from '../actions/noteActionService';
import { auth } from '../utils/firebase';

type ConfirmationState =
  | 'reviewing'
  | 'executing'
  | 'success'
  | 'error';

type PendingNoteAction = {
  conversationId: string;
  requestId: string;
  proposal: KyrubAiCreateNoteProposal;
  state: ConfirmationState;
  errorMessage: string;
  alreadyApplied: boolean;
};

export function KyrubAiNoteActionBridge() {
  const [pending, setPending] = useState<PendingNoteAction | null>(null);

  useEffect(() => {
    const handleProposal = (event: Event) => {
      const detail = (event as CustomEvent<KyrubAiActionProposalEventDetail>).detail;
      if (!detail || detail.proposal.type !== 'create_note') return;

      setPending({
        conversationId: detail.conversationId,
        requestId: detail.requestId,
        proposal: {
          ...detail.proposal,
          origin: detail.proposal.origin ?? 'kyrubia',
          risk: detail.proposal.risk ?? 'low',
          idempotencyKey:
            detail.proposal.idempotencyKey ??
            `kyrubia:create_note:${detail.conversationId}:${detail.proposal.id}`,
        },
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
        throw new Error('Faça login novamente antes de confirmar a criação da nota.');
      }

      const result = await executeConfirmedCreateNoteAction(
        user,
        pending.proposal
      );

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
          : 'Não foi possível criar a nota.',
      } : current);
    }
  };

  const isWorking = pending.state === 'executing';
  const isSuccess = pending.state === 'success';

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-slate-950/85 p-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-sm sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Confirmar criação de nota pela Kyrubia"
        className="w-full max-w-md overflow-hidden rounded-3xl border border-violet-500/25 bg-slate-950 shadow-2xl"
      >
        <header className="flex items-start gap-3 border-b border-slate-800 p-4">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
            isSuccess
              ? 'bg-emerald-500/15 text-emerald-300'
              : 'bg-violet-500/15 text-violet-300'
          }`}>
            {isSuccess ? (
              <CheckCircle2 className="h-6 w-6" />
            ) : (
              <FileText className="h-6 w-6" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-xs font-black uppercase tracking-wider text-violet-300">
              Kyrubia
            </span>
            <h2 className="mt-1 text-xl font-black text-white">
              {isSuccess ? 'Nota criada' : 'Confirmar nova nota'}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setPending(null)}
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
                ? 'Esta ação já havia sido concluída. Nenhuma nota duplicada foi criada.'
                : 'A nota foi criada pelo serviço oficial do Kyrub e será exibida na guia Notas pela sincronização em nuvem.'}
            </p>
          ) : (
            <>
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <span className="text-[11px] font-black uppercase text-slate-500">
                  Título
                </span>
                <h3 className="mt-1 text-lg font-black text-white">
                  {pending.proposal.title}
                </h3>
                <span className="mt-4 block text-[11px] font-black uppercase text-slate-500">
                  Conteúdo
                </span>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
                  {pending.proposal.content}
                </p>
                {pending.proposal.checklist.length > 0 && (
                  <div className="mt-4">
                    <span className="text-[11px] font-black uppercase text-slate-500">
                      Checklist
                    </span>
                    <div className="mt-2 space-y-2">
                      {pending.proposal.checklist.map((item, index) => (
                        <div
                          key={`${pending.proposal.id}-${index}`}
                          className="flex gap-2 text-sm text-slate-300"
                        >
                          <span className="text-violet-300">☐</span>
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <p className="text-xs leading-relaxed text-slate-500">
                Nada será salvo antes da confirmação. A nota continuará privada e não será publicada no feed.
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
                onClick={() => setPending(null)}
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
                    Criando...
                  </>
                ) : (
                  'Confirmar'
                )}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
