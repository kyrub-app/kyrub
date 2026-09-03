import type { User } from 'firebase/auth';
import {
  loadMercadoLivreConflictResolutionQueue,
  loadMercadoLivreSyncReviewQueue,
  type MercadoLivreConflictResolutionItem,
  type MercadoLivreSyncReviewItem,
} from './storeConnections';

export interface NinetyNineFoodBlockedOrder {
  orderId: string;
  externalOrderId: string;
  displayId: string;
  customerName: string;
  blockedState:
    | 'blocked_insufficient_atp'
    | 'blocked_product_binding_unresolved'
    | 'blocked_authority_unresolved';
  blockedDetail: string;
  unresolvedExternalProductIds?: string[];
  canonicalProductIds?: string[];
  inventoryItemId?: string;
  requiredQuantity?: number | null;
  availableQuantity?: number | null;
  status: string;
}

export interface NinetyNineFoodReservationPreflightLine {
  inventoryItemId: string;
  requiredQuantity: number;
  availableQuantity: number;
  shortageQuantity: number;
}

export interface NinetyNineFoodReservationPreflight {
  orderId: string;
  state:
    | 'binding_unresolved'
    | 'insufficient_atp'
    | 'authority_unresolved'
    | 'ready_for_retry'
    | 'already_reserved'
    | 'not_applicable';
  canonicalProductIds: string[];
  unresolvedExternalProductIds: string[];
  lines: NinetyNineFoodReservationPreflightLine[];
  checkedAt: string;
}

export interface NinetyNineFoodInventoryAuthorityDiagnostic {
  orderId: string;
  state:
    | 'resolved'
    | 'no_active_owner'
    | 'multiple_active_owners'
    | 'inventory_document_missing';
  activeOwnerCount: number;
  inventoryDocumentExists: boolean;
  checkedAt: string;
}

export type StoreChannelOperationalItem = {
  id: string;
  provider: 'mercado_livre' | '99food';
  severity: 'critical' | 'review';
  kind:
    | 'mercado_livre_sync_review'
    | 'mercado_livre_conflict'
    | '99food_insufficient_atp'
    | '99food_binding_unresolved'
    | '99food_authority_unresolved';
  title: string;
  detail: string;
  evidence?: string[];
  reference: string;
  actionTarget: 'mercado_livre' | '99food';
  remediationTarget?: '99food_binding' | 'kyrub_inventory';
  remediationExternalProductIds?: string[];
  remediationInventoryItemId?: string;
};

export type StoreChannelOperationalQueue = {
  items: StoreChannelOperationalItem[];
  sourceErrors: Array<'mercado_livre_review' | 'mercado_livre_conflict' | '99food_blocked_orders'>;
};

const authorizedNinetyNineFoodRequest = async <T>(
  user: User,
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  const token = await user.getIdToken();
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(path, { ...init, headers, cache: 'no-store' });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string' && payload.error.trim()
        ? payload.error.trim()
        : `A operação 99Food não pôde ser concluída (${response.status}).`
    );
  }
  return payload as T;
};

const loadNinetyNineFoodBlockedOrders = async (
  user: User
): Promise<{ items: NinetyNineFoodBlockedOrder[] }> => {
  const payload = await authorizedNinetyNineFoodRequest<{ items?: unknown }>(
    user,
    '/api/integrations/99food/blocked-orders'
  );
  const items = Array.isArray(payload.items) ? payload.items : [];
  return { items: items as NinetyNineFoodBlockedOrder[] };
};

export const preflightNinetyNineFoodBlockedOrderReservation = async (
  user: User,
  orderId: string
): Promise<NinetyNineFoodReservationPreflight> => {
  const encodedOrderId = encodeURIComponent(orderId.trim());
  if (!encodedOrderId) throw new Error('Pedido 99Food inválido para verificar o ATP.');
  return authorizedNinetyNineFoodRequest<NinetyNineFoodReservationPreflight>(
    user,
    `/api/integrations/99food/blocked-orders/${encodedOrderId}/preflight`
  );
};

export const diagnoseNinetyNineFoodBlockedOrderInventoryAuthority = async (
  user: User,
  orderId: string
): Promise<NinetyNineFoodInventoryAuthorityDiagnostic> => {
  const encodedOrderId = encodeURIComponent(orderId.trim());
  if (!encodedOrderId) throw new Error('Pedido 99Food inválido para diagnosticar a autoridade de estoque.');
  return authorizedNinetyNineFoodRequest<NinetyNineFoodInventoryAuthorityDiagnostic>(
    user,
    `/api/integrations/99food/blocked-orders/${encodedOrderId}/authority-diagnostic`
  );
};

export const retryNinetyNineFoodBlockedOrderReservation = async (
  user: User,
  orderId: string
): Promise<{ orderId: string; state: unknown }> => {
  const encodedOrderId = encodeURIComponent(orderId.trim());
  if (!encodedOrderId) throw new Error('Pedido 99Food inválido para nova tentativa de reserva.');
  return authorizedNinetyNineFoodRequest<{ orderId: string; state: unknown }>(
    user,
    `/api/integrations/99food/blocked-orders/${encodedOrderId}/retry-reservation`,
    { method: 'POST' }
  );
};

export const buildStoreChannelOperationalItems = (input: {
  mercadoLivreReview: MercadoLivreSyncReviewItem[];
  mercadoLivreConflicts: MercadoLivreConflictResolutionItem[];
  ninetyNineFoodBlocked: NinetyNineFoodBlockedOrder[];
}): StoreChannelOperationalItem[] => {
  const conflictProposalIds = new Set(input.mercadoLivreConflicts.map(item => item.proposalId));
  const items: StoreChannelOperationalItem[] = [];

  for (const conflict of input.mercadoLivreConflicts) {
    const blockedReason = conflict.baselineStatus === 'baseline_unavailable'
      ? 'O baseline histórico não está disponível; o Kyrub bloqueou qualquer sobrescrita por inferência.'
      : `Kyrub e Mercado Livre alteraram campos desde o último baseline (${conflict.resolvableFields.join(', ') || 'sem campo resolvível automaticamente'}).`;
    items.push({
      id: `mercado-livre-conflict:${conflict.proposalId}`,
      provider: 'mercado_livre',
      severity: 'critical',
      kind: 'mercado_livre_conflict',
      title: `Conflito no produto ${conflict.canonicalProductId}`,
      detail: blockedReason,
      reference: conflict.proposalId,
      actionTarget: 'mercado_livre',
    });
  }

  for (const review of input.mercadoLivreReview) {
    if (conflictProposalIds.has(review.proposal.id)) continue;
    items.push({
      id: `mercado-livre-review:${review.proposal.id}`,
      provider: 'mercado_livre',
      severity: 'review',
      kind: 'mercado_livre_sync_review',
      title: review.snapshot.item.title || `Item ${review.snapshot.item.externalId}`,
      detail: 'O Mercado Livre notificou uma mudança e o Kyrub reconsultou o item pela API. A alteração aguarda revisão humana antes de qualquer aplicação.',
      reference: review.proposal.id,
      actionTarget: 'mercado_livre',
    });
  }

  for (const order of input.ninetyNineFoodBlocked) {
    const bindingBlocked = order.blockedState === 'blocked_product_binding_unresolved';
    const authorityBlocked = order.blockedState === 'blocked_authority_unresolved';
    const unresolvedExternalProductIds = order.unresolvedExternalProductIds ?? [];
    const canonicalProductIds = order.canonicalProductIds ?? [];
    const inventoryItemId = order.inventoryItemId ?? '';
    const requiredQuantity = order.requiredQuantity ?? null;
    const availableQuantity = order.availableQuantity ?? null;
    const evidence: string[] = [];
    if (bindingBlocked && unresolvedExternalProductIds.length > 0) {
      evidence.push(`Produtos externos sem binding: ${unresolvedExternalProductIds.join(', ')}`);
    }
    if (!bindingBlocked && canonicalProductIds.length > 0) {
      evidence.push(`Produtos Kyrub envolvidos: ${canonicalProductIds.join(', ')}`);
    }
    if (!bindingBlocked && !authorityBlocked && inventoryItemId) {
      evidence.push(`Item de estoque com ATP insuficiente: ${inventoryItemId}`);
    }
    if (
      !bindingBlocked &&
      !authorityBlocked &&
      requiredQuantity !== null &&
      availableQuantity !== null
    ) {
      evidence.push(`Necessário: ${requiredQuantity} · disponível: ${availableQuantity}`);
    }

    items.push({
      id: `99food-blocked:${order.orderId}`,
      provider: '99food',
      severity: 'critical',
      kind: authorityBlocked
        ? '99food_authority_unresolved'
        : bindingBlocked
          ? '99food_binding_unresolved'
          : '99food_insufficient_atp',
      title: `Pedido 99Food ${order.displayId || order.externalOrderId || order.orderId}`,
      detail: authorityBlocked
        ? 'O Kyrub não conseguiu resolver uma única autoridade canônica de estoque para a loja. Nenhum owner ou inventário alternativo foi escolhido por inferência.'
        : bindingBlocked
          ? 'A linha externa ainda não possui binding ativo para um produto canônico Kyrub. Nenhuma reserva foi inferida por nome ou SKU.'
          : 'O pedido não conseguiu reservar disponibilidade suficiente no ATP canônico. O estoque físico não foi inventado nem sobrescrito.',
      evidence,
      reference: order.orderId,
      actionTarget: '99food',
      remediationTarget: authorityBlocked
        ? undefined
        : bindingBlocked
          ? '99food_binding'
          : 'kyrub_inventory',
      remediationExternalProductIds: bindingBlocked ? unresolvedExternalProductIds : undefined,
      remediationInventoryItemId: !bindingBlocked && !authorityBlocked && inventoryItemId
        ? inventoryItemId
        : undefined,
    });
  }

  return items.sort((left, right) => {
    const severity = (left.severity === 'critical' ? 0 : 1) - (right.severity === 'critical' ? 0 : 1);
    if (severity !== 0) return severity;
    return left.id.localeCompare(right.id, 'pt-BR');
  });
};

export const loadStoreChannelOperationalQueue = async (
  user: User,
  storeId: string
): Promise<StoreChannelOperationalQueue> => {
  const [reviewResult, conflictResult, blockedResult] = await Promise.allSettled([
    loadMercadoLivreSyncReviewQueue(user, storeId, 50),
    loadMercadoLivreConflictResolutionQueue(user, storeId, 50),
    loadNinetyNineFoodBlockedOrders(user),
  ]);

  const sourceErrors: StoreChannelOperationalQueue['sourceErrors'] = [];
  if (reviewResult.status === 'rejected') sourceErrors.push('mercado_livre_review');
  if (conflictResult.status === 'rejected') sourceErrors.push('mercado_livre_conflict');
  if (blockedResult.status === 'rejected') sourceErrors.push('99food_blocked_orders');

  return {
    items: buildStoreChannelOperationalItems({
      mercadoLivreReview: reviewResult.status === 'fulfilled' ? reviewResult.value.items : [],
      mercadoLivreConflicts: conflictResult.status === 'fulfilled' ? conflictResult.value.items : [],
      ninetyNineFoodBlocked: blockedResult.status === 'fulfilled' ? blockedResult.value.items : [],
    }),
    sourceErrors,
  };
};
