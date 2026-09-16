import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  loadStoreAdministrativeAudit,
  type StoreAdministrativeAuditDomain,
  type StoreAdministrativeAuditEvent,
} from '../../utils/storeAdministrativeAudit';

type DomainFilter = 'all' | StoreAdministrativeAuditDomain;

const domainLabel: Record<StoreAdministrativeAuditDomain, string> = {
  governance: 'Governança',
  inventory: 'Estoque',
  orders: 'Pedidos',
  integrations: 'Integrações',
  finance: 'Financeiro',
  users: 'Usuários',
  ai: 'Kyrubia / IA',
  store: 'Loja',
};

const actionLabel: Record<string, string> = {
  deactivate_additional_owner_membership: 'Owner adicional desativado',
  activate_canonical_owner_membership: 'Owner canônico ativado',
  link_existing_canonical_store: 'Loja canônica vinculada',
  activate_canonical_owner: 'Autoridade do owner ativada',
  initialize_empty_inventory: 'Estoque físico inicializado',
  retry_now: 'Nova tentativa solicitada',
  keep_in_review: 'Mantido em revisão',
  close_non_processable: 'Encerrado como não processável',
  manual_retry_queue_failure: 'Falha ao reenviar tentativa',
  '99food_product_binding_created': 'Binding 99Food criado',
  '99food_product_binding_reactivated': 'Binding 99Food reativado',
  '99food_product_binding_deactivated': 'Binding 99Food desativado',
  reject_order: 'Pedido 99Food rejeitado',
  retry_blocked_order_reservation_requested: 'Retry de reserva 99Food solicitado',
  retry_blocked_order_reservation_completed: 'Retry de reserva 99Food concluído',
  retry_blocked_order_reservation_failed: 'Retry de reserva 99Food falhou',
};

const resultLabel: Record<string, string> = {
  applied: 'Aplicado',
  retry_requested: 'Retry solicitado',
  retry_completed: 'Retry concluído',
  retry_failed: 'Retry falhou',
  kept_in_review: 'Em revisão',
  closed_non_processable: 'Encerrado',
  queue_failed: 'Falha na fila',
  provider_write_succeeded: 'Aplicado no 99Food',
  reconciliation_required: 'Reconciliação necessária',
  executing: 'Em processamento',
};

const formatTimestamp = (value: string): string => {
  if (!value) return 'Horário indisponível';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Horário indisponível' : parsed.toLocaleString('pt-BR');
};

const subjectLabel = (event: StoreAdministrativeAuditEvent): string => {
  if (event.subjectType === 'external_order' && event.subjectId) return `Pedido externo ${event.subjectId}`;
  if (event.subjectType === 'external_product_binding' && event.subjectId) return `Produto externo ${event.subjectId}`;
  if (event.subjectType === 'inventory_authority') return 'Autoridade de estoque';
  if (event.subjectType === 'store_membership') return 'Acesso administrativo da loja';
  return 'Operação da loja';
};

const evidenceLines = (event: StoreAdministrativeAuditEvent): string[] => {
  const metadata = event.metadata ?? {};
  const lines: string[] = [];
  const provider = typeof metadata.provider === 'string' ? metadata.provider : '';
  if (provider === 'mercado_livre') lines.push('Canal: Mercado Livre');
  if (provider === '99food') lines.push('Canal: 99Food');
  const failureCount = typeof metadata.failureCount === 'number' ? metadata.failureCount : null;
  const failureBudget = typeof metadata.failureBudget === 'number' ? metadata.failureBudget : null;
  if (failureCount !== null && failureBudget !== null) {
    lines.push(`Falhas antes da decisão: ${failureCount}/${failureBudget}`);
  }
  const retryCycle = typeof metadata.retryCycle === 'number' ? metadata.retryCycle : null;
  if (retryCycle !== null) lines.push(`Ciclo de retry: ${retryCycle}`);
  const stateBefore = typeof metadata.stateBefore === 'string' ? metadata.stateBefore : '';
  if (stateBefore) lines.push(`Estado anterior: ${stateBefore}`);
  const blockedState = typeof metadata.blockedState === 'string' ? metadata.blockedState : '';
  if (blockedState) lines.push(`Bloqueio anterior: ${blockedState}`);
  const blockedStateBefore = typeof metadata.blockedStateBefore === 'string' ? metadata.blockedStateBefore : '';
  if (blockedStateBefore) lines.push(`Bloqueio antes do retry: ${blockedStateBefore}`);
  const reconciliationState = typeof metadata.reconciliationState === 'string' ? metadata.reconciliationState : '';
  if (reconciliationState) lines.push(`Reconciliação: ${reconciliationState}`);
  const stateAfter = typeof metadata.stateAfter === 'string' ? metadata.stateAfter : '';
  if (stateAfter) lines.push(`Estado após retry: ${stateAfter}`);
  const retryAttemptId = typeof metadata.retryAttemptId === 'string' ? metadata.retryAttemptId : '';
  if (retryAttemptId) lines.push(`Tentativa: ${retryAttemptId}`);
  const canonicalProductId = typeof metadata.canonicalProductId === 'string' ? metadata.canonicalProductId : '';
  if (canonicalProductId) lines.push(`Produto Kyrub: ${canonicalProductId}`);
  const previousCanonicalProductId = typeof metadata.previousCanonicalProductId === 'string'
    ? metadata.previousCanonicalProductId
    : '';
  if (previousCanonicalProductId) lines.push(`Produto Kyrub anterior: ${previousCanonicalProductId}`);
  const canonicalProductCount = typeof metadata.canonicalProductCount === 'number' ? metadata.canonicalProductCount : null;
  if (canonicalProductCount !== null) lines.push(`Produtos Kyrub resolvidos: ${canonicalProductCount}`);
  const unresolvedExternalProductCount = typeof metadata.unresolvedExternalProductCount === 'number'
    ? metadata.unresolvedExternalProductCount
    : null;
  if (unresolvedExternalProductCount !== null) {
    lines.push(`Produtos externos ainda sem binding: ${unresolvedExternalProductCount}`);
  }
  const inventoryItemId = typeof metadata.inventoryItemId === 'string' ? metadata.inventoryItemId : '';
  if (inventoryItemId) lines.push(`Item de estoque: ${inventoryItemId}`);
  const revision = typeof metadata.revision === 'number' ? metadata.revision : null;
  if (revision !== null) lines.push(`Revisão do binding: ${revision}`);
  const attempts = typeof metadata.attempts === 'number' ? metadata.attempts : null;
  if (attempts !== null) lines.push(`Tentativas: ${attempts}`);
  const errorCode = typeof metadata.errorCode === 'string' ? metadata.errorCode : '';
  if (errorCode) lines.push(`Diagnóstico: ${errorCode}`);
  return lines;
};

export default function StoreAdministrativeAuditWorkspace({
  user,
  storeId,
}: {
  user: User;
  storeId: string;
}) {
  const [items, setItems] = useState<StoreAdministrativeAuditEvent[]>([]);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<DomainFilter>('all');

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError('');
      const snapshot = await loadStoreAdministrativeAudit(user, storeId, 80);
      setItems(snapshot.items);
      setSourceWarnings(snapshot.sourceWarnings);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar a auditoria da loja.');
    } finally {
      setLoading(false);
    }
  }, [storeId, user.uid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const availableDomains = useMemo(() => {
    const domains = new Set(items.map(item => item.domain));
    return (Object.keys(domainLabel) as StoreAdministrativeAuditDomain[])
      .filter(domain => domains.has(domain));
  }, [items]);

  const visibleItems = useMemo(
    () => filter === 'all' ? items : items.filter(item => item.domain === filter),
    [filter, items]
  );

  return (
    <div className="space-y-5" id="store-administrative-audit-workspace">
      <section className="rounded-3xl border border-cyan-500/20 bg-cyan-500/[0.035] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-cyan-300">
              ADM do lojista · somente leitura
            </span>
            <h3 className="mt-1 text-base font-black text-white">Ações & Auditoria da Loja</h3>
            <p className="mt-2 max-w-2xl text-[10px] leading-relaxed text-slate-400">
              Linha do tempo administrativa formada apenas por evidências reais dos módulos. Cada domínio continua responsável por executar e registrar sua própria ação; esta tela somente normaliza e apresenta o histórico.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="min-h-10 rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-4 text-[9px] font-black uppercase text-cyan-100 disabled:opacity-45"
            id="refresh-store-administrative-audit"
          >
            {loading ? 'Atualizando...' : 'Atualizar histórico'}
          </button>
        </div>
      </section>

      {sourceWarnings.length > 0 && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] px-4 py-3 text-[9px] leading-relaxed text-amber-100" role="status">
          Uma ou mais fontes de auditoria estão temporariamente indisponíveis. O histórico abaixo continua mostrando as fontes que puderam ser verificadas.
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.05] px-4 py-3 text-[9px] leading-relaxed text-red-100" role="alert">
          {error}
        </div>
      )}

      {!error && (
        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`min-h-9 rounded-xl border px-3 text-[8px] font-black uppercase ${
                filter === 'all'
                  ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-100'
                  : 'border-slate-800 bg-slate-950 text-slate-500'
              }`}
            >
              Tudo ({items.length})
            </button>
            {availableDomains.map(domain => (
              <button
                key={domain}
                type="button"
                onClick={() => setFilter(domain)}
                className={`min-h-9 rounded-xl border px-3 text-[8px] font-black uppercase ${
                  filter === domain
                    ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-100'
                    : 'border-slate-800 bg-slate-950 text-slate-500'
                }`}
              >
                {domainLabel[domain]} ({items.filter(item => item.domain === domain).length})
              </button>
            ))}
          </div>

          {!loading && visibleItems.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-800 bg-slate-950/60 px-4 py-8 text-center">
              <strong className="text-[10px] text-slate-300">Nenhuma evidência administrativa encontrada.</strong>
              <p className="mt-1 text-[9px] leading-relaxed text-slate-600">
                O Kyrub não cria registros fictícios para preencher esta linha do tempo.
              </p>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {visibleItems.map(event => {
                const evidence = evidenceLines(event);
                return (
                  <article key={`${event.sourceRef}:${event.id}`} className="rounded-2xl border border-slate-800 bg-slate-950/65 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="font-mono text-[8px] font-black uppercase tracking-wide text-cyan-300">
                          {domainLabel[event.domain] ?? 'Loja'} · {event.actorLabel}
                        </span>
                        <h4 className="mt-1 text-[11px] font-black text-white">
                          {actionLabel[event.action] ?? (event.action.replaceAll('_', ' ') || 'Ação administrativa')}
                        </h4>
                        <p className="mt-1 text-[9px] text-slate-500">
                          {formatTimestamp(event.occurredAt)} · {subjectLabel(event)}
                        </p>
                      </div>
                      <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 font-mono text-[8px] font-black uppercase text-slate-300">
                        {resultLabel[event.result] ?? (event.result.replaceAll('_', ' ') || 'Registrado')}
                      </span>
                    </div>

                    {event.reason && (
                      <p className="mt-3 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-[9px] leading-relaxed text-slate-300">
                        {event.reason}
                      </p>
                    )}

                    {evidence.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {evidence.map(line => (
                          <span key={line} className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-[8px] text-slate-500">
                            {line}
                          </span>
                        ))}
                      </div>
                    )}

                    <p className="mt-3 font-mono text-[7px] uppercase tracking-wide text-slate-700">
                      Autoridade: {event.authority || 'não informada'} · Fonte: {event.sourceKind}
                    </p>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
