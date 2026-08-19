import { useEffect, useState } from 'react';
import { CheckCircle2, ClipboardList, LoaderCircle, X } from 'lucide-react';
import type { KyrubAiSetProductCompositionProposal } from '../../shared/kyrubActions';
import { executeKyrubAction } from '../actions/kyrubActionService';
import { invalidateKyrubErpContext } from '../actions/erpReadActionService';
import {
  KYRUB_AI_ACTION_PROPOSAL_EVENT,
  type KyrubAiActionProposalEventDetail,
} from '../ai/actionEvents';
import { auth } from '../utils/firebase';

type ConfirmationState = 'reviewing' | 'executing' | 'success' | 'error';

type PendingComposition = {
  conversationId: string;
  proposal: KyrubAiSetProductCompositionProposal;
  state: ConfirmationState;
  errorMessage: string;
  alreadyApplied: boolean;
};

const number = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 6,
});

const withIdempotency = (
  conversationId: string,
  proposal: KyrubAiSetProductCompositionProposal
): KyrubAiSetProductCompositionProposal => ({
  ...proposal,
  origin: proposal.origin ?? 'kyrubia',
  risk: proposal.risk ?? 'medium',
  idempotencyKey:
    proposal.idempotencyKey ??
    `kyrubia:${proposal.type}:${conversationId}:${proposal.id}`,
});

export function KyrubAiProductCompositionActionBridge() {
  const [pending, setPending] = useState<PendingComposition | null>(null);

  useEffect(() => {
    const handleProposal = (event: Event) => {
      const detail = (event as CustomEvent<KyrubAiActionProposalEventDetail>).detail;
      if (!detail || detail.proposal.type !== 'set_product_composition') return;
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
        errorMessage: 'Faça login novamente antes de confirmar a ficha técnica.',
      } : value);
      return;
    }

    const current = pending;
    setPending(value => value ? { ...value, state: 'executing', errorMessage: '' } : value);
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
          : 'Não foi possível salvar a ficha técnica.',
      } : value);
    }
  };

  return (
    <div className="fixed inset-0 z-[123] flex items-start justify-center overflow-y-auto bg-slate-950/85 p-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-sm sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={success ? 'Ficha técnica salva' : 'Confirmar ficha técnica'}
        className="w-full max-w-md overflow-hidden rounded-3xl border border-violet-500/25 bg-slate-950 shadow-2xl"
      >
        <header className="flex items-start gap-3 border-b border-slate-800 p-4">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${success ? 'bg-emerald-500/15 text-emerald-300' : 'bg-violet-500/15 text-violet-300'}`}>
            {success ? <CheckCircle2 className="h-6 w-6" /> : <ClipboardList className="h-6 w-6" />}
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-xs font-black uppercase tracking-wider text-violet-300">Kyrubia</span>
            <h2 className="mt-1 text-xl font-black text-white">
              {success ? 'Ficha técnica salva' : 'Confirmar ficha técnica'}
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
                ? 'Esta mesma ficha técnica já havia sido salva. O Kyrub não duplicou a alteração.'
                : 'A ficha técnica foi vinculada ao produto. Nenhum saldo de estoque foi consumido nesta etapa.'}
            </p>
          ) : (
            <>
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <p className="text-xs font-black uppercase tracking-wider text-violet-300">Produto</p>
                <p className="mt-1 text-base font-black text-white">{pending.proposal.productName}</p>
                <p className="mt-1 text-xs text-slate-400">
                  Rendimento: {number.format(pending.proposal.yieldQuantity)} {pending.proposal.yieldQuantity === 1 ? 'unidade' : 'unidades'}
                </p>
              </div>

              <div className="space-y-2">
                {pending.proposal.lines.map(line => (
                  <div
                    key={line.inventoryItemId}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 px-3 py-3"
                  >
                    <span className="min-w-0 text-sm font-bold text-white">{line.inventoryItemName}</span>
                    <span className="shrink-0 text-sm font-black text-emerald-300">
                      {number.format(line.quantity)} {line.unit}
                    </span>
                  </div>
                ))}
              </div>

              <p className="text-xs leading-relaxed text-slate-500">
                Ao confirmar, o Kyrub salva apenas a composição deste produto. O saldo dos insumos não é alterado agora; ele será usado pelo motor de estoque quando houver uma operação que realmente consuma a composição.
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
                    Salvando...
                  </>
                ) : 'Salvar ficha'}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
