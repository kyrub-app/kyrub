import { useEffect, useRef, useState } from 'react';
import { BadgePercent, CheckCircle2, Clock3, LoaderCircle, TicketPercent, X } from 'lucide-react';
import type { KyrubActionProposal } from '../../shared/kyrubActions';
import type { CreateStorePromotionProposal } from '../../shared/storePromotionAction';
import { executeKyrubAction } from '../actions/kyrubActionService';
import { invalidateKyrubErpContext, readKyrubErpContext } from '../actions/erpReadActionService';
import { resolveKyrubiaDeterministicStorePromotion } from '../ai/deterministicStorePromotion';
import {
  emitKyrubStorePromotionProposal,
  KYRUB_STORE_PROMOTION_PROPOSAL_EVENT,
  type KyrubStorePromotionProposalEventDetail,
} from '../ai/storePromotionEvents';
import { auth } from '../utils/firebase';

type ConfirmationState = 'reviewing' | 'executing' | 'success' | 'error';

type PendingStorePromotion = {
  conversationId: string;
  proposal: CreateStorePromotionProposal;
  state: ConfirmationState;
  errorMessage: string;
  alreadyApplied: boolean;
};

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

const runtimeId = (prefix: string): string => {
  try {
    return `${prefix}:${globalThis.crypto.randomUUID()}`;
  } catch {
    return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
  }
};

const withIdempotency = (
  conversationId: string,
  proposal: CreateStorePromotionProposal
): CreateStorePromotionProposal => ({
  ...proposal,
  idempotencyKey:
    proposal.idempotencyKey ??
    `kyrubia:${proposal.type}:${conversationId}:${proposal.id}`,
});

const discountLabel = (proposal: CreateStorePromotionProposal): string =>
  proposal.discountType === 'percentage'
    ? `${proposal.discountValue}% de desconto`
    : `${currencyFormatter.format(proposal.discountValue)} de desconto`;

export function KyrubAiStorePromotionActionBridge() {
  const [pending, setPending] = useState<PendingStorePromotion | null>(null);
  const lastCapturedIntent = useRef<{ message: string; capturedAt: number } | null>(null);

  useEffect(() => {
    const handleProposal = (event: Event) => {
      const detail = (event as CustomEvent<KyrubStorePromotionProposalEventDetail>).detail;
      if (!detail || detail.proposal.type !== 'create_store_promotion') return;
      setPending({
        conversationId: detail.conversationId,
        proposal: withIdempotency(detail.conversationId, detail.proposal),
        state: 'reviewing',
        errorMessage: '',
        alreadyApplied: false,
      });
    };

    window.addEventListener(KYRUB_STORE_PROMOTION_PROPOSAL_EVENT, handleProposal);
    return () =>
      window.removeEventListener(KYRUB_STORE_PROMOTION_PROPOSAL_EVENT, handleProposal);
  }, []);

  useEffect(() => {
    const capturePromotionIntent = (event: Event): void => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.closest('#kyrub-ai-workspace')) return;

      const textarea = form.querySelector('textarea');
      if (!(textarea instanceof HTMLTextAreaElement)) return;
      const message = textarea.value.trim();
      if (!message) return;

      const user = auth.currentUser;
      if (!user) return;

      const now = Date.now();
      const last = lastCapturedIntent.current;
      if (last?.message === message && now - last.capturedAt < 2_000) return;
      lastCapturedIntent.current = { message, capturedAt: now };

      void readKyrubErpContext(user)
        .then(context => {
          const resolution = resolveKyrubiaDeterministicStorePromotion(
            message,
            context
          );
          if (!resolution) return;

          const requestId = runtimeId('promotion-request');
          const conversationId = runtimeId(`promotion-chat:${user.uid}`);
          emitKyrubStorePromotionProposal(
            conversationId,
            requestId,
            resolution.proposal
          );
        })
        .catch(error => {
          console.warn('[Kyrubia] Não foi possível preparar a promoção solicitada.', error);
        });
    };

    document.addEventListener('submit', capturePromotionIntent, true);
    return () => document.removeEventListener('submit', capturePromotionIntent, true);
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
      setPending(value =>
        value
          ? {
              ...value,
              state: 'error',
              errorMessage: 'Faça login novamente antes de publicar a promoção.',
            }
          : value
      );
      return;
    }

    const current = pending;
    setPending(value =>
      value ? { ...value, state: 'executing', errorMessage: '' } : value
    );

    try {
      const result = await executeKyrubAction(
        user,
        current.proposal as unknown as KyrubActionProposal,
        true
      );
      invalidateKyrubErpContext(user.uid);
      setPending(value =>
        value
          ? {
              ...value,
              state: 'success',
              errorMessage: '',
              alreadyApplied: result.status === 'already_applied',
            }
          : value
      );
    } catch (error) {
      setPending(value =>
        value
          ? {
              ...value,
              state: 'error',
              errorMessage:
                error instanceof Error
                  ? error.message
                  : 'Não foi possível publicar a promoção.',
            }
          : value
      );
    }
  };

  return (
    <div className="fixed inset-0 z-[126] flex items-start justify-center overflow-y-auto bg-slate-950/85 p-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-sm sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={success ? 'Promoção publicada' : 'Confirmar promoção'}
        className="w-full max-w-md overflow-hidden rounded-3xl border border-emerald-500/25 bg-slate-950 shadow-2xl"
      >
        <header className="flex items-start gap-3 border-b border-slate-800 p-4">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
              success
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'bg-emerald-500/15 text-emerald-300'
            }`}
          >
            {success ? (
              <CheckCircle2 className="h-6 w-6" />
            ) : (
              <TicketPercent className="h-6 w-6" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-xs font-black uppercase tracking-wider text-emerald-300">
              Kyrubia · Promoção
            </span>
            <h2 className="mt-1 text-xl font-black text-white">
              {success ? 'Promoção publicada' : 'Confirmar promoção'}
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
                ? 'Esta mesma promoção já havia sido publicada. O Kyrub não duplicou a ação.'
                : `A promoção “${pending.proposal.badge}” foi publicada pelo backend autenticado.`}
            </p>
          ) : (
            <>
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                <div className="flex items-center gap-2 text-emerald-300">
                  <BadgePercent className="h-4 w-4" />
                  <span className="text-xs font-black uppercase tracking-wider">Benefício</span>
                </div>
                <strong className="mt-2 block text-lg text-white">
                  {discountLabel(pending.proposal)}
                </strong>
                <span className="mt-1 block text-sm text-slate-300">
                  {pending.proposal.productLabel}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3">
                  <span className="block text-[9px] font-black uppercase text-slate-500">Cupom</span>
                  <strong className="mt-1 block break-all text-sm text-slate-200">
                    {pending.proposal.code}
                  </strong>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3">
                  <span className="block text-[9px] font-black uppercase text-slate-500">Uso por cliente</span>
                  <strong className="mt-1 block text-sm text-slate-200">
                    {pending.proposal.maxRedemptionsPerBuyer === 0
                      ? 'Sem limite'
                      : `${pending.proposal.maxRedemptionsPerBuyer}×`}
                  </strong>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <div className="flex items-center gap-2 text-emerald-300">
                  <Clock3 className="h-4 w-4" />
                  <span className="text-xs font-black uppercase tracking-wider">Validade</span>
                </div>
                <p className="mt-2 text-sm text-slate-300">
                  {dateTimeFormatter.format(new Date(pending.proposal.startsAt))} até{' '}
                  {dateTimeFormatter.format(new Date(pending.proposal.endsAt))}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {pending.proposal.maxRedemptions === 0
                    ? 'Sem limite global de resgates.'
                    : `Limite global: ${pending.proposal.maxRedemptions} resgates.`}
                </p>
              </div>

              <p className="text-xs leading-relaxed text-slate-500">
                A confirmação publica o cupom para os produtos indicados. O desconto continua sendo calculado pelo backend e só é consumido depois da confirmação autoritativa do pagamento.
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
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-60"
              >
                {working ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    Publicando...
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
