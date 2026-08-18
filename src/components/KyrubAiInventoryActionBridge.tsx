import { useEffect, useState } from 'react';
import {
  Boxes,
  CheckCircle2,
  LoaderCircle,
  PackagePlus,
  X,
} from 'lucide-react';
import type { KyrubAiAdjustInventoryProposal } from '../../shared/kyrubActions';
import { executeKyrubAction } from '../actions/kyrubActionService';
import { invalidateKyrubErpContext } from '../actions/erpReadActionService';
import {
  KYRUB_AI_ACTION_PROPOSAL_EVENT,
  type KyrubAiActionProposalEventDetail,
} from '../ai/actionEvents';
import { auth } from '../utils/firebase';

type ConfirmationState = 'reviewing' | 'executing' | 'success' | 'error';

type PendingInventory = {
  conversationId: string;
  proposal: KyrubAiAdjustInventoryProposal;
  state: ConfirmationState;
  errorMessage: string;
  alreadyApplied: boolean;
};

const withIdempotency = (
  conversationId: string,
  proposal: KyrubAiAdjustInventoryProposal
): KyrubAiAdjustInventoryProposal => ({
  ...proposal,
  origin: proposal.origin ?? 'kyrubia',
  risk: proposal.risk ?? 'medium',
  idempotencyKey:
    proposal.idempotencyKey ??
    `kyrubia:${proposal.type}:${conversationId}:${proposal.id}`,
});

const quantity = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 3,
});

export function KyrubAiInventoryActionBridge() {
  const [pending, setPending] = useState<PendingInventory | null>(null);

  useEffect(() => {
    const handleProposal = (event: Event) => {
      const detail = (event as CustomEvent<KyrubAiActionProposalEventDetail>).detail;
      if (!detail || detail.proposal.type !== 'adjust_inventory') return;

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

  const isWorking = pending.state === 'executing';
  const isSuccess = pending.state === 'success';
  const supplier = pending.proposal.source.label?.trim() ?? '';

  const close = () => {
    if (isWorking) return;
    setPending(null);
  };

  const confirm = async () => {
    if (isWorking) return;
    const current = pending;
    const user = auth.currentUser;
    if (!user) {
      setPending(value => value ? {
        ...value,
        state: 'error',
        errorMessage: 'Faça login novamente antes de confirmar esta entrada.',
      } : value);
      return;
    }

    setPending(value => value ? {
      ...value,
      state: 'executing',
      errorMessage: '',
    } : value);

    try {
      const result = await executeKyrubAction(user, current.proposal, true);
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
          : 'Não foi possível registrar a entrada de estoque.',
      } : value);
    }
  };

  return (
    <div className="fixed inset-0 z-[122] flex items-start justify-center overflow-y-auto bg-slate-950/85 p-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-sm sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={isSuccess ? 'Entrada de estoque registrada' : 'Confirmar entrada de estoque'}
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
              : <PackagePlus className="h-6 w-6" />}
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-xs font-black uppercase tracking-wider text-violet-300">
              Kyrubia
            </span>
            <h2 className="mt-1 text-xl font-black text-white">
              {isSuccess ? 'Estoque atualizado' : 'Confirmar entrada de estoque'}
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
                ? 'Esta mesma entrada já havia sido registrada. O Kyrub não duplicou as quantidades.'
                : `${pending.proposal.entries.length} insumo(s) foram registrados no estoque privado. Agora eles podem ser ligados à ficha técnica do X-Burger.`}
            </p>
          ) : (
            <>
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <div className="flex items-center gap-2 text-violet-300">
                  <Boxes className="h-4 w-4" />
                  <span className="text-[11px] font-black uppercase tracking-wider">
                    Entrada de estoque
                  </span>
                </div>
                {supplier && (
                  <p className="mt-2 text-xs text-slate-400">
                    Fornecedor: <span className="font-bold text-slate-200">{supplier}</span>
                  </p>
                )}
                <div className="mt-3 space-y-2">
                  {pending.proposal.entries.map((entry, index) => (
                    <div
                      key={`${entry.name}-${entry.unit}-${index}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5"
                    >
                      <span className="min-w-0 text-sm font-bold text-white">
                        {entry.name}
                      </span>
                      <span className="shrink-0 text-sm font-black text-emerald-300">
                        {quantity.format(entry.quantity)} {entry.unit}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-xs leading-relaxed text-slate-500">
                A confirmação soma estas quantidades ao estoque privado. Se um insumo ainda não existir, ele será criado. Nenhum produto será criado ou publicado e nenhum preço de venda será alterado.
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
                    Registrando...
                  </>
                ) : 'Confirmar entrada'}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
