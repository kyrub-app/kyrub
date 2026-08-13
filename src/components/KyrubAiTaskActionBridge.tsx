import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  ListTodo,
  LoaderCircle,
  X,
} from 'lucide-react';
import type { KyrubAiCreateTaskProposal } from '../../shared/kyrubActions';
import { executeKyrubAction } from '../actions/kyrubActionService';
import {
  KYRUB_AI_ACTION_PROPOSAL_EVENT,
  type KyrubAiActionProposalEventDetail,
} from '../ai/actionEvents';
import { auth } from '../utils/firebase';

type ConfirmationState = 'reviewing' | 'executing' | 'success' | 'error';

type PendingTask = {
  conversationId: string;
  requestId: string;
  proposal: KyrubAiCreateTaskProposal;
  state: ConfirmationState;
  errorMessage: string;
  alreadyApplied: boolean;
};

const withIdempotency = (
  conversationId: string,
  proposal: KyrubAiCreateTaskProposal
): KyrubAiCreateTaskProposal => ({
  ...proposal,
  origin: proposal.origin ?? 'kyrubia',
  risk: proposal.risk ?? 'low',
  inputProvenance: proposal.inputProvenance ?? 'user_intent',
  impact: proposal.impact ?? { entityCount: 1, reversibility: 'easy' },
  idempotencyKey:
    proposal.idempotencyKey ??
    `kyrubia:create_task:${conversationId}:${proposal.id}`,
});

const formatReminder = (value: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]} às ${match[4]}:${match[5]}`;
};

export function KyrubAiTaskActionBridge() {
  const [pending, setPending] = useState<PendingTask | null>(null);

  useEffect(() => {
    const handleProposal = (event: Event) => {
      const detail = (event as CustomEvent<KyrubAiActionProposalEventDetail>).detail;
      if (!detail || detail.proposal.type !== 'create_task') return;

      setPending({
        conversationId: detail.conversationId,
        requestId: detail.requestId,
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

  const isWorking = pending.state === 'executing';
  const isSuccess = pending.state === 'success';

  const close = () => {
    if (isWorking) return;
    setPending(null);
  };

  const confirm = async () => {
    if (isWorking) return;

    setPending(current => current ? {
      ...current,
      state: 'executing',
      errorMessage: '',
    } : current);

    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('Faça login novamente antes de confirmar esta tarefa.');
      }

      const result = await executeKyrubAction(user, pending.proposal, true);
      setPending(current => current ? {
        ...current,
        state: 'success',
        alreadyApplied: result.status === 'already_applied',
      } : current);
    } catch (error) {
      setPending(current => current ? {
        ...current,
        state: 'error',
        errorMessage:
          error instanceof Error
            ? error.message
            : 'Não foi possível criar a tarefa agora.',
      } : current);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-slate-950/85 p-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-sm sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={isSuccess ? 'Tarefa criada' : 'Confirmar nova tarefa'}
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
              : <ListTodo className="h-6 w-6" />}
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-xs font-black uppercase tracking-wider text-violet-300">
              Kyrubia
            </span>
            <h2 className="mt-1 text-xl font-black text-white">
              {isSuccess ? 'Tarefa criada' : 'Confirmar nova tarefa'}
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
                ? 'Esta tarefa já havia sido criada por esta ação. Nenhuma duplicata foi gerada.'
                : 'A tarefa foi criada pelo executor oficial do Kyrub e será exibida na sua área de Notas/Tarefas pela sincronização em nuvem.'}
            </p>
          ) : (
            <>
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <span className="text-[11px] font-black uppercase text-slate-500">
                  Tarefa
                </span>
                <h3 className="mt-1 text-lg font-black text-white">
                  {pending.proposal.title}
                </h3>
                <span className="mt-4 block text-[11px] font-black uppercase text-slate-500">
                  Pedido original
                </span>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
                  {pending.proposal.content}
                </p>
                {pending.proposal.reminderDateTime && (
                  <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300">
                    <Clock3 className="h-4 w-4 text-violet-300" />
                    <span>
                      Lembrete: {formatReminder(pending.proposal.reminderDateTime)}
                    </span>
                  </div>
                )}
              </div>
              <p className="text-xs leading-relaxed text-slate-500">
                Nada será salvo antes da confirmação. A tarefa será criada somente para a sua conta. Compartilhamento com outros usuários não é concedido por este fluxo.
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
                    Criando...
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
