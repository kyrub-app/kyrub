import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  AlertTriangle,
  ArrowDownRight,
  CircleAlert,
  LoaderCircle,
  PackageSearch,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Wrench,
  X,
} from 'lucide-react';
import { requestNinetyNineFoodBindingRemediation } from '../../utils/ninetyNineFoodBindingRemediation';
import { requestPhysicalInventoryFocus } from '../../utils/physicalInventoryRemediation';
import {
  loadStoreChannelOperationalQueue,
  preflightNinetyNineFoodBlockedOrderReservation,
  retryNinetyNineFoodBlockedOrderReservation,
  type NinetyNineFoodReservationPreflight,
  type StoreChannelOperationalItem,
} from '../../utils/storeChannelOperations';

const labels: Record<StoreChannelOperationalItem['kind'], string> = {
  mercado_livre_sync_review: 'Revisão manual',
  mercado_livre_conflict: 'Conflito',
  '99food_insufficient_atp': 'ATP insuficiente',
  '99food_binding_unresolved': 'Binding não resolvido',
};

const openChannel = (target: StoreChannelOperationalItem['actionTarget']): void => {
  const element = target === 'mercado_livre'
    ? document.getElementById('kyrub-mercado-livre-channel-detail')
    : document.getElementById('kyrub-99food-channel-detail')
      ?? document.querySelector<HTMLElement>('[data-integration-id="99food"]');
  element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const openBindingRemediation = (externalProductIds: string[]): void => {
  if (externalProductIds.length === 0) return;
  requestNinetyNineFoodBindingRemediation(externalProductIds);
  const element = document.getElementById('kyrub-99food-product-binding-workspace')
    ?? document.getElementById('kyrub-99food-channel-detail');
  element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const openInventoryRemediation = (inventoryItemId: string): void => {
  const normalized = inventoryItemId.trim();
  if (!normalized) return;
  requestPhysicalInventoryFocus(normalized);
  document
    .getElementById('kyrub-physical-inventory-workspace')
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const openRemediation = (item: StoreChannelOperationalItem): void => {
  const target = item.remediationTarget;
  if (!target) return;

  if (target === '99food_binding') {
    if (item.remediationExternalProductIds?.length) {
      requestNinetyNineFoodBindingRemediation(item.remediationExternalProductIds);
    }
    const element = document.getElementById('kyrub-99food-product-binding-workspace')
      ?? document.getElementById('kyrub-99food-channel-detail');
    element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  if (target === 'kyrub_inventory') {
    if (item.remediationInventoryItemId) {
      requestPhysicalInventoryFocus(item.remediationInventoryItemId);
    }
    document
      .getElementById('kyrub-physical-inventory-workspace')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};

const preflightTone = (
  preflight: NinetyNineFoodReservationPreflight
): string => {
  if (preflight.state === 'ready_for_retry' || preflight.state === 'already_reserved') {
    return 'border-emerald-500/20 bg-emerald-500/5 text-emerald-100';
  }
  if (preflight.state === 'insufficient_atp' || preflight.state === 'binding_unresolved') {
    return 'border-amber-500/20 bg-amber-500/5 text-amber-100';
  }
  return 'border-slate-700 bg-slate-950/60 text-slate-300';
};

export default function StoreChannelOperationsQueue({ user, storeId }: { user: User; storeId: string }) {
  const [items, setItems] = useState<StoreChannelOperationalItem[]>([]);
  const [sourceErrors, setSourceErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [confirmRetryOrderId, setConfirmRetryOrderId] = useState('');
  const [retryingOrderId, setRetryingOrderId] = useState('');
  const [preflightingOrderId, setPreflightingOrderId] = useState('');
  const [preflightByOrder, setPreflightByOrder] = useState<Record<string, NinetyNineFoodReservationPreflight>>({});
  const [preflightErrorByOrder, setPreflightErrorByOrder] = useState<Record<string, string>>({});
  const [actionFeedback, setActionFeedback] = useState('');
  const [actionError, setActionError] = useState('');
  const criticalCount = useMemo(() => items.filter(item => item.severity === 'critical').length, [items]);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setPreflightByOrder({});
    setPreflightErrorByOrder({});
    try {
      const result = await loadStoreChannelOperationalQueue(user, storeId);
      setItems(result.items);
      setSourceErrors(result.sourceErrors);
    } finally {
      setLoaded(true);
      setLoading(false);
    }
  }, [storeId, user]);

  useEffect(() => { void refresh(); }, [refresh]);

  const preflightReservation = async (item: StoreChannelOperationalItem): Promise<void> => {
    if (item.provider !== '99food') return;
    setConfirmRetryOrderId('');
    setPreflightingOrderId(item.reference);
    setPreflightErrorByOrder(previous => ({ ...previous, [item.reference]: '' }));
    try {
      const result = await preflightNinetyNineFoodBlockedOrderReservation(
        user,
        item.reference
      );
      setPreflightByOrder(previous => ({ ...previous, [item.reference]: result }));
    } catch (error) {
      setPreflightByOrder(previous => {
        const next = { ...previous };
        delete next[item.reference];
        return next;
      });
      setPreflightErrorByOrder(previous => ({
        ...previous,
        [item.reference]: error instanceof Error
          ? error.message
          : 'Não foi possível verificar o ATP atual deste pedido.',
      }));
    } finally {
      setPreflightingOrderId('');
    }
  };

  const retryReservation = async (item: StoreChannelOperationalItem): Promise<void> => {
    if (item.provider !== '99food') return;
    if (confirmRetryOrderId !== item.reference) {
      setConfirmRetryOrderId(item.reference);
      setActionFeedback('');
      setActionError('');
      return;
    }

    setRetryingOrderId(item.reference);
    setActionFeedback('');
    setActionError('');
    try {
      await retryNinetyNineFoodBlockedOrderReservation(user, item.reference);
      setConfirmRetryOrderId('');
      setActionFeedback(
        'O Kyrub reprocessou a reserva interna deste pedido e atualizou a fila. Se o bloqueio continuar, o pedido permanece aqui. Nenhum status foi enviado à 99Food.'
      );
      await refresh();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'Não foi possível tentar a reserva novamente.'
      );
    } finally {
      setRetryingOrderId('');
    }
  };

  return (
    <section className="rounded-3xl border border-amber-500/20 bg-amber-500/[0.035] p-5" aria-label="Pendências dos canais">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-300">Operação omnichannel</span>
          <h3 className="mt-1 flex items-center gap-2 text-lg font-black text-white"><AlertTriangle className="h-5 w-5" /> Pendências dos canais</h3>
          <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-slate-400">
            Reúne estados autoritativos que precisam de atenção. A fila encaminha para o módulo correto e só oferece uma ação interna quando já existe contrato explícito de autoridade.
          </p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading || Boolean(retryingOrderId) || Boolean(preflightingOrderId)}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-300 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3"><span className="block text-[9px] font-black uppercase text-slate-500">Pendências</span><strong className="mt-1 block text-lg text-amber-300">{items.length}</strong></div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3"><span className="block text-[9px] font-black uppercase text-slate-500">Bloqueios/conflitos</span><strong className="mt-1 block text-lg text-rose-300">{criticalCount}</strong></div>
      </div>

      {sourceErrors.length > 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3 text-[10px] text-amber-100">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>A visão está parcial porque {sourceErrors.length} fonte(s) não responderam. Os itens exibidos continuam válidos.</span>
        </div>
      )}

      {actionFeedback && (
        <p className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-[10px] leading-relaxed text-emerald-200" aria-live="polite">
          {actionFeedback}
        </p>
      )}
      {actionError && (
        <p className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-3 text-[10px] leading-relaxed text-rose-200" aria-live="polite">
          {actionError}
        </p>
      )}

      <div className="mt-4 space-y-2">
        {!loaded || (loading && items.length === 0) ? (
          <p className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4 text-[10px] text-slate-500">Consultando filas autoritativas dos canais…</p>
        ) : items.length === 0 && sourceErrors.length === 0 ? (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-emerald-300">
            <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /><strong className="text-xs">Nenhuma pendência encontrada.</strong></div>
          </div>
        ) : items.map(item => {
          const canRetryReservation = item.provider === '99food';
          const retryArmed = confirmRetryOrderId === item.reference;
          const retrying = retryingOrderId === item.reference;
          const preflighting = preflightingOrderId === item.reference;
          const preflight = preflightByOrder[item.reference];
          const preflightError = preflightErrorByOrder[item.reference] ?? '';
          const remediationLabel = item.remediationTarget === '99food_binding'
            ? 'Corrigir binding'
            : item.remediationTarget === 'kyrub_inventory'
              ? 'Abrir estoque'
              : '';
          return (
            <article key={item.id} className={`rounded-2xl border p-4 ${item.severity === 'critical' ? 'border-rose-500/20 bg-rose-500/[0.045]' : 'border-amber-500/20 bg-amber-500/[0.035]'}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className="text-[9px] font-black uppercase text-slate-500">{item.provider === 'mercado_livre' ? 'Mercado Livre' : '99Food'}</span><span className="rounded-full border border-slate-700 px-2 py-0.5 text-[8px] font-black uppercase text-slate-300">{labels[item.kind]}</span></div>
                  <strong className="mt-2 block text-xs text-white">{item.title}</strong>
                  <p className="mt-1 text-[10px] leading-relaxed text-slate-400">{item.detail}</p>
                  {item.evidence && item.evidence.length > 0 && (
                    <div className="mt-2 space-y-1 rounded-xl border border-slate-800 bg-slate-950/50 p-2.5">
                      <span className="block text-[8px] font-black uppercase tracking-wider text-slate-500">Evidência do bloqueio</span>
                      {item.evidence.map(line => (
                        <p key={line} className="break-all text-[9px] leading-relaxed text-slate-300">{line}</p>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 break-all text-[9px] text-slate-600">Ref. {item.reference}</p>
                  {item.remediationTarget && (
                    <p className="mt-2 text-[9px] leading-relaxed text-cyan-200/80">
                      {item.remediationTarget === '99food_binding'
                        ? 'Próximo passo: o Kyrub pode levar o ID externo exato até a bancada; você ainda precisa escolher o produto canônico e confirmar o vínculo.'
                        : 'Próximo passo: abra o estoque físico canônico; quando houver um inventoryItemId exato, o Kyrub destaca somente aquele insumo/componente. Depois da correção explícita do saldo, verifique o ATP antes de decidir por uma nova tentativa.'}
                    </p>
                  )}

                  {preflight && (
                    <div className={`mt-3 rounded-xl border p-3 text-[9px] leading-relaxed ${preflightTone(preflight)}`} aria-live="polite">
                      {preflight.state === 'binding_unresolved' && (
                        <>
                          <strong className="block">Binding ainda pendente nesta leitura.</strong>
                          <span className="mt-1 block break-all">
                            Produtos externos sem vínculo: {preflight.unresolvedExternalProductIds.join(', ') || 'não identificados'}.
                          </span>
                          {preflight.unresolvedExternalProductIds.length > 0 && (
                            <button
                              type="button"
                              onClick={() => openBindingRemediation(preflight.unresolvedExternalProductIds)}
                              disabled={Boolean(retryingOrderId) || Boolean(preflightingOrderId)}
                              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-violet-500/25 bg-violet-500/10 px-2.5 py-1.5 text-[8px] font-black uppercase text-violet-200 disabled:opacity-40"
                            >
                              <Wrench className="h-3 w-3" /> Corrigir binding atual
                            </button>
                          )}
                        </>
                      )}
                      {preflight.state === 'insufficient_atp' && (
                        <>
                          <strong className="block">O ATP ainda não está suficiente.</strong>
                          <div className="mt-2 space-y-2">
                            {preflight.lines.filter(line => line.shortageQuantity > 0).map(line => (
                              <div key={line.inventoryItemId} className="flex flex-col gap-1.5 rounded-lg border border-amber-400/15 bg-slate-950/35 p-2 sm:flex-row sm:items-center sm:justify-between">
                                <span className="break-all">
                                  {line.inventoryItemId}: necessário {line.requiredQuantity}, disponível {line.availableQuantity}, faltam {line.shortageQuantity}.
                                </span>
                                <button
                                  type="button"
                                  onClick={() => openInventoryRemediation(line.inventoryItemId)}
                                  disabled={Boolean(retryingOrderId) || Boolean(preflightingOrderId)}
                                  className="inline-flex shrink-0 items-center justify-center gap-1 rounded-lg border border-cyan-500/25 bg-cyan-500/10 px-2 py-1.5 text-[8px] font-black uppercase text-cyan-200 disabled:opacity-40"
                                >
                                  <PackageSearch className="h-3 w-3" /> Abrir item
                                </button>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                      {preflight.state === 'ready_for_retry' && (
                        <>
                          <strong className="block">ATP suficiente nesta leitura.</strong>
                          <span className="mt-1 block">
                            O preflight não criou reserva e não garante que a disponibilidade continuará igual. Se quiser executar a tentativa, use “Tentar reservar novamente” separadamente.
                          </span>
                        </>
                      )}
                      {preflight.state === 'already_reserved' && (
                        <>
                          <strong className="block">Já existe uma reserva ativa para este pedido.</strong>
                          <span className="mt-1 block">Atualize a fila antes de qualquer nova ação; o preflight não alterou essa reserva.</span>
                        </>
                      )}
                      {preflight.state === 'not_applicable' && (
                        <>
                          <strong className="block">Reserva de insumos não aplicável nesta leitura.</strong>
                          <span className="mt-1 block">Nenhum item composto exigiu reserva física. O preflight não mudou o pedido.</span>
                        </>
                      )}
                    </div>
                  )}

                  {preflightError && (
                    <p className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-[9px] leading-relaxed text-rose-100" aria-live="polite">
                      {preflightError}
                    </p>
                  )}

                  {retryArmed && canRetryReservation && (
                    <p className="mt-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-2.5 text-[9px] leading-relaxed text-cyan-100">
                      Confirme somente depois de corrigir o binding ou disponibilizar ATP. A nova tentativa pode criar a reserva canônica do pedido, mas não rejeita o pedido e não envia status à 99Food. Um preflight anterior é apenas informativo e pode ficar desatualizado.
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2 sm:max-w-[310px] sm:justify-end">
                  {item.remediationTarget && (
                    <button
                      type="button"
                      onClick={() => openRemediation(item)}
                      disabled={Boolean(retryingOrderId) || Boolean(preflightingOrderId)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-violet-500/25 bg-violet-500/10 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-violet-300 disabled:opacity-40"
                    >
                      {item.remediationTarget === '99food_binding'
                        ? <Wrench className="h-3.5 w-3.5" />
                        : <PackageSearch className="h-3.5 w-3.5" />}
                      {remediationLabel}
                    </button>
                  )}
                  {canRetryReservation && (
                    <>
                      <button
                        type="button"
                        onClick={() => void preflightReservation(item)}
                        disabled={Boolean(preflightingOrderId) || Boolean(retryingOrderId) || loading}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-slate-200 disabled:opacity-40"
                      >
                        {preflighting
                          ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                          : <ShieldCheck className="h-3.5 w-3.5" />}
                        {preflighting ? 'Verificando…' : 'Verificar ATP'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void retryReservation(item)}
                        disabled={Boolean(retryingOrderId) || Boolean(preflightingOrderId) || loading}
                        className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-[9px] font-black uppercase tracking-wider disabled:opacity-40 ${retryArmed ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-cyan-500/25 bg-cyan-500/10 text-cyan-300'}`}
                      >
                        {retrying ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                        {retrying ? 'Tentando…' : retryArmed ? 'Confirmar nova tentativa' : 'Tentar reservar novamente'}
                      </button>
                      {retryArmed && !retrying && (
                        <button
                          type="button"
                          onClick={() => setConfirmRetryOrderId('')}
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-slate-400"
                        >
                          <X className="h-3.5 w-3.5" /> Cancelar
                        </button>
                      )}
                    </>
                  )}
                  <button type="button" onClick={() => openChannel(item.actionTarget)} disabled={Boolean(retryingOrderId) || Boolean(preflightingOrderId)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-slate-300 disabled:opacity-40">
                    <ArrowDownRight className="h-3.5 w-3.5" /> Abrir canal
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <p className="mt-4 text-[10px] leading-relaxed text-slate-600">
        O preflight é somente leitura e pode ficar desatualizado logo após a consulta. Ele não cria reserva nem autoriza uma tentativa. A fila nunca aprova mudanças do Mercado Livre, rejeita pedidos ou escreve em provedores; o único write aqui continua sendo a nova tentativa explicitamente confirmada da reserva interna Kyrub para um pedido 99Food ainda bloqueado.
      </p>
    </section>
  );
}
