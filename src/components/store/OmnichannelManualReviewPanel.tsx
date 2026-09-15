import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  loadOmnichannelManualReviews,
  resolveMercadoLivreManualReview,
  type MercadoLivreManualReviewAction,
  type OmnichannelManualReview,
  type OmnichannelManualReviewAuditEntry,
} from '../../utils/omnichannelOrderObservation';

type ToastType = 'success' | 'error' | 'info';

type PendingDecision = {
  inboxId: string;
  action: MercadoLivreManualReviewAction;
} | null;

const actionLabel: Record<MercadoLivreManualReviewAction, string> = {
  retry_now: 'Tentar novamente agora',
  keep_in_review: 'Manter em revisão',
  close_non_processable: 'Encerrar como não processável',
};

const actionDescription: Record<MercadoLivreManualReviewAction, string> = {
  retry_now: 'O Kyrub reabre o mesmo inbox e solicita um novo processamento. O estado comercial será relido oficialmente no Mercado Livre antes de qualquer avanço.',
  keep_in_review: 'O pedido continua sinalizado para análise humana. Nenhuma chamada ao Mercado Livre ou alteração no KDS é executada.',
  close_non_processable: 'Encerra somente esta pendência operacional local. O pedido e o status no Mercado Livre não são alterados.',
};

const auditActionLabel = (action: string): string =>
  action in actionLabel
    ? actionLabel[action as MercadoLivreManualReviewAction]
    : action || 'Decisão registrada';

const auditResultLabel = (result: string): string => {
  if (result === 'retry_requested') return 'Novo ciclo de retry solicitado';
  if (result === 'kept_in_review') return 'Mantido em revisão';
  if (result === 'closed_non_processable') return 'Encerrado como não processável';
  return result || 'Resultado registrado';
};

const formatTimestamp = (value: string): string => {
  if (!value) return 'horário indisponível';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('pt-BR');
};

export default function OmnichannelManualReviewPanel({
  user,
  storeId,
  notify,
}: {
  user: User;
  storeId: string;
  notify: (message: string, type?: ToastType) => void;
}) {
  const [reviews, setReviews] = useState<OmnichannelManualReview[]>([]);
  const [auditEntries, setAuditEntries] = useState<OmnichannelManualReviewAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [pendingDecision, setPendingDecision] = useState<PendingDecision>(null);
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [actingInboxId, setActingInboxId] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setLoadError('');
      const snapshot = await loadOmnichannelManualReviews(user, 50);
      setReviews(snapshot.manualReviews.filter(item => item.provider === 'mercado_livre'));
      setAuditEntries((snapshot.manualReviewAudit ?? []).filter(item => item.provider === 'mercado_livre'));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível carregar a fila de revisão.';
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [user.uid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const chooseAction = (review: OmnichannelManualReview, action: MercadoLivreManualReviewAction): void => {
    setPendingDecision({ inboxId: review.inboxId, action });
    setReason('');
    setAcknowledged(false);
  };

  const cancelDecision = (): void => {
    setPendingDecision(null);
    setReason('');
    setAcknowledged(false);
  };

  const applyDecision = async (review: OmnichannelManualReview): Promise<void> => {
    if (!pendingDecision || pendingDecision.inboxId !== review.inboxId) return;
    if (!acknowledged) {
      notify('Confirme que você entendeu o efeito desta decisão antes de continuar.', 'error');
      return;
    }
    if (pendingDecision.action === 'close_non_processable' && reason.trim().length < 8) {
      notify('Informe uma justificativa para encerrar este pedido como não processável.', 'error');
      return;
    }

    try {
      setActingInboxId(review.inboxId);
      const result = await resolveMercadoLivreManualReview(
        user,
        storeId,
        review.inboxId,
        pendingDecision.action,
        reason
      );
      if (result.status === 'queued') {
        notify('Nova tentativa solicitada. O Kyrub relerá o pedido no Mercado Livre antes de processar.', 'success');
      } else if (result.status === 'in_review') {
        notify('Pedido mantido em revisão humana.', 'info');
      } else {
        notify('Pendência encerrada como não processável, sem alterar o pedido no Mercado Livre.', 'success');
      }
      cancelDecision();
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível aplicar a decisão.', 'error');
    } finally {
      setActingInboxId('');
    }
  };

  return (
    <section
      className="rounded-3xl border border-amber-500/20 bg-amber-500/[0.035] p-4 sm:p-5"
      id="mercado-livre-manual-review-panel"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-amber-300">
            Pedidos · atenção humana
          </span>
          <h3 className="mt-1 text-sm font-black uppercase text-white">Revisão de entrada Mercado Livre</h3>
          <p className="mt-2 max-w-2xl text-[10px] leading-relaxed text-slate-400">
            Pedidos que esgotaram as tentativas automáticas aparecem aqui. As decisões desta área não fornecem pagamento, binding ou status comercial ao servidor.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || Boolean(actingInboxId)}
          className="min-h-10 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[9px] font-black uppercase text-slate-300 disabled:opacity-45"
          id="refresh-mercado-livre-manual-reviews"
        >
          {loading ? 'Atualizando...' : 'Atualizar fila'}
        </button>
      </div>

      {loadError && (
        <p className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/[0.05] px-4 py-3 text-[9px] leading-relaxed text-red-100">
          {loadError}
        </p>
      )}

      {!loading && !loadError && reviews.length === 0 && (
        <div className="mt-4 rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.035] p-4">
          <strong className="text-[10px] text-emerald-200">Nenhum pedido aguardando revisão manual.</strong>
          <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
            Quando um ingresso atingir o limite automático de tentativas, ele ficará visível nesta fila sem ser descartado.
          </p>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {reviews.map(review => {
          const decision = pendingDecision?.inboxId === review.inboxId ? pendingDecision.action : null;
          const acting = actingInboxId === review.inboxId;
          const attempts = review.failureCount !== null && review.failureBudget !== null
            ? `${review.failureCount}/${review.failureBudget} tentativas`
            : 'Tentativas esgotadas';

          return (
            <article
              key={review.inboxId}
              className="rounded-2xl border border-amber-500/20 bg-slate-950/55 p-4"
              data-manual-review-inbox={review.inboxId}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="font-mono text-[8px] font-black uppercase tracking-wide text-amber-300">
                    {attempts}
                  </span>
                  <h4 className="mt-1 break-all text-[11px] font-black text-white">
                    Pedido Mercado Livre {review.externalOrderId}
                  </h4>
                  <p className="mt-1 text-[9px] text-slate-500">
                    Esgotado em {formatTimestamp(review.exhaustedAt)}
                  </p>
                </div>
                <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 font-mono text-[8px] font-black uppercase text-amber-200">
                  Revisão necessária
                </span>
              </div>

              <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                <span className="font-mono text-[8px] font-black uppercase text-slate-500">Último diagnóstico</span>
                <p className="mt-1 break-words text-[9px] leading-relaxed text-slate-300">
                  {review.errorDiagnostic || review.errorCode || 'Falha transitória repetida sem diagnóstico adicional.'}
                </p>
                {review.errorCode && review.errorDiagnostic && (
                  <p className="mt-1 font-mono text-[8px] text-slate-600">{review.errorCode}</p>
                )}
              </div>

              {!decision && (
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    disabled={Boolean(actingInboxId)}
                    onClick={() => chooseAction(review, 'retry_now')}
                    className="min-h-10 rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-3 text-[9px] font-black uppercase text-cyan-100 disabled:opacity-45"
                  >
                    Tentar novamente agora
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(actingInboxId)}
                    onClick={() => chooseAction(review, 'keep_in_review')}
                    className="min-h-10 rounded-xl border border-slate-700 bg-slate-900 px-3 text-[9px] font-black uppercase text-slate-300 disabled:opacity-45"
                  >
                    Manter em revisão
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(actingInboxId)}
                    onClick={() => chooseAction(review, 'close_non_processable')}
                    className="min-h-10 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-3 text-[9px] font-black uppercase text-red-200 disabled:opacity-45"
                  >
                    Encerrar como não processável
                  </button>
                </div>
              )}

              {decision && (
                <div className="mt-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.035] p-4">
                  <span className="font-mono text-[8px] font-black uppercase tracking-wide text-cyan-300">
                    Confirmar decisão
                  </span>
                  <strong className="mt-1 block text-[10px] text-white">{actionLabel[decision]}</strong>
                  <p className="mt-2 text-[9px] leading-relaxed text-slate-400">
                    {actionDescription[decision]}
                  </p>

                  <label className="mt-3 block text-[9px] font-bold text-slate-300">
                    Justificativa {decision === 'close_non_processable' ? '(obrigatória)' : '(opcional)'}
                    <textarea
                      value={reason}
                      onChange={event => setReason(event.target.value.slice(0, 500))}
                      rows={3}
                      className="mt-2 w-full resize-none rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[10px] text-white outline-none focus:border-cyan-500/50"
                      placeholder={decision === 'close_non_processable'
                        ? 'Explique por que esta pendência não deve mais ser processada.'
                        : 'Adicione uma nota para o histórico operacional, se necessário.'}
                    />
                  </label>

                  <label className="mt-3 flex cursor-pointer items-start gap-2 text-[9px] leading-relaxed text-slate-300">
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      onChange={event => setAcknowledged(event.target.checked)}
                      className="mt-0.5 h-4 w-4"
                    />
                    <span>
                      Confirmo que esta decisão atua somente sobre o fluxo operacional do Kyrub e não autoriza inventar ou alterar pagamento, binding ou status no Mercado Livre.
                    </span>
                  </label>

                  <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={cancelDecision}
                      disabled={acting}
                      className="min-h-10 rounded-xl border border-slate-700 bg-slate-950 px-4 text-[9px] font-black uppercase text-slate-300 disabled:opacity-45"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={() => void applyDecision(review)}
                      disabled={acting || !acknowledged || (decision === 'close_non_processable' && reason.trim().length < 8)}
                      className="min-h-10 rounded-xl border border-cyan-500/25 bg-cyan-500/15 px-4 text-[9px] font-black uppercase text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {acting ? 'Aplicando...' : `Confirmar ${actionLabel[decision]}`}
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="mt-6 border-t border-slate-800 pt-5" id="mercado-livre-manual-review-audit-history">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <span className="font-mono text-[8px] font-black uppercase tracking-[0.16em] text-cyan-300">
              Trilha de auditoria
            </span>
            <h4 className="mt-1 text-[11px] font-black uppercase text-white">Histórico de decisões humanas</h4>
          </div>
          <span className="font-mono text-[8px] text-slate-600">append-only · owner scoped</span>
        </div>
        <p className="mt-2 max-w-2xl text-[9px] leading-relaxed text-slate-500">
          Este histórico é separado do estado atual do pedido. Encerrar ou reprocessar uma pendência não apaga a decisão anterior.
        </p>

        {!loading && !loadError && auditEntries.length === 0 && (
          <p className="mt-3 rounded-xl border border-slate-800 bg-slate-950/45 px-3 py-3 text-[9px] text-slate-500">
            Ainda não existem decisões humanas registradas nesta trilha.
          </p>
        )}

        <div className="mt-3 space-y-2">
          {auditEntries.slice(0, 20).map(entry => {
            const retryTransition = entry.previousRetryCycle !== null && entry.nextRetryCycle !== null
              ? `${entry.previousRetryCycle} → ${entry.nextRetryCycle}`
              : '';
            const attempts = entry.failureCount !== null && entry.failureBudget !== null
              ? `${entry.failureCount}/${entry.failureBudget}`
              : '';
            const actorLabel = entry.actorUserId && entry.actorUserId !== user.uid
              ? 'Outro usuário autorizado da loja'
              : 'Responsável autenticado da loja';

            return (
              <article
                key={entry.eventId}
                className="rounded-xl border border-slate-800 bg-slate-950/45 p-3"
                data-manual-review-audit-event={entry.eventId}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <strong className="block break-all text-[10px] text-slate-200">
                      Pedido Mercado Livre {entry.externalOrderId}
                    </strong>
                    <p className="mt-1 text-[8px] text-slate-600">
                      {formatTimestamp(entry.occurredAt)} · decisão #{entry.decisionSequence ?? '—'}
                    </p>
                  </div>
                  <span className="rounded-full border border-cyan-500/20 bg-cyan-500/[0.06] px-2 py-1 font-mono text-[7px] font-black uppercase text-cyan-200">
                    {auditResultLabel(entry.decisionResult)}
                  </span>
                </div>

                <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="font-mono text-[7px] font-black uppercase text-slate-600">Ação</dt>
                    <dd className="mt-0.5 text-[9px] text-slate-300">{auditActionLabel(entry.action)}</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[7px] font-black uppercase text-slate-600">Responsável</dt>
                    <dd className="mt-0.5 text-[9px] text-slate-300">{actorLabel}</dd>
                  </div>
                  {(retryTransition || attempts) && (
                    <div>
                      <dt className="font-mono text-[7px] font-black uppercase text-slate-600">Retry</dt>
                      <dd className="mt-0.5 text-[9px] text-slate-300">
                        {[retryTransition && `ciclo ${retryTransition}`, attempts && `${attempts} falhas`].filter(Boolean).join(' · ')}
                      </dd>
                    </div>
                  )}
                  {entry.reason && (
                    <div className={retryTransition || attempts ? '' : 'sm:col-span-2'}>
                      <dt className="font-mono text-[7px] font-black uppercase text-slate-600">Justificativa</dt>
                      <dd className="mt-0.5 break-words text-[9px] leading-relaxed text-slate-300">{entry.reason}</dd>
                    </div>
                  )}
                </dl>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
