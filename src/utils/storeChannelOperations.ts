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
  blockedState: 'blocked_insufficient_atp' | 'blocked_product_binding_unresolved';
  blockedDetail: string;
  status: string;
}

export type StoreChannelOperationalItem = {
  id: string;
  provider: 'mercado_livre' | '99food';
  severity: 'critical' | 'review';
  kind:
    | 'mercado_livre_sync_review'
    | 'mercado_livre_conflict'
    | '99food_insufficient_atp'
    | '99food_binding_unresolved';
  title: string;
  detail: string;
  reference: string;
  actionTarget: 'mercado_livre' | '99food';
};

export type StoreChannelOperationalQueue = {
  items: StoreChannelOperationalItem[];
  sourceErrors: Array<'mercado_livre_review' | 'mercado_livre_conflict' | '99food_blocked_orders'>;
};

const loadNinetyNineFoodBlockedOrders = async (
  user: User
): Promise<{ items: NinetyNineFoodBlockedOrder[] }> => {
  const token = await user.getIdToken();
  const response = await fetch('/api/integrations/99food/blocked-orders', {
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string' && payload.error.trim()
        ? payload.error.trim()
        : `Não foi possível consultar pedidos bloqueados da 99Food (${response.status}).`
    );
  }
  const items = Array.isArray(payload.items) ? payload.items : [];
  return { items: items as NinetyNineFoodBlockedOrder[] };
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
    items.push({
      id: `99food-blocked:${order.orderId}`,
      provider: '99food',
      severity: 'critical',
      kind: bindingBlocked ? '99food_binding_unresolved' : '99food_insufficient_atp',
      title: `Pedido 99Food ${order.displayId || order.externalOrderId || order.orderId}`,
      detail: bindingBlocked
        ? 'A linha externa ainda não possui binding ativo para um produto canônico Kyrub. Nenhuma reserva foi inferida por nome ou SKU.'
        : 'O pedido não conseguiu reservar disponibilidade suficiente no ATP canônico. O estoque físico não foi inventado nem sobrescrito.',
      reference: order.orderId,
      actionTarget: '99food',
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
