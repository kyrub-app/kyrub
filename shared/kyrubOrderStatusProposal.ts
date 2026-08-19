import type {
  KyrubAiUpdateOrderStatusProposal,
  KyrubOrderMutableStatus,
  KyrubOrderStatus,
} from './kyrubActions';
import type {
  KyrubErpContextSnapshot,
  KyrubErpOrderSummary,
} from './kyrubErpContext';

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

const TRANSITIONS: Record<KyrubOrderStatus, KyrubOrderMutableStatus[]> = {
  pending: ['accepted', 'rejected', 'cancelled'],
  accepted: ['preparing', 'cancelled', 'completed'],
  preparing: ['ready', 'cancelled', 'completed'],
  ready: ['out_for_delivery', 'completed'],
  out_for_delivery: ['completed'],
  completed: [],
  rejected: [],
  cancelled: [],
};

const isOrderStatus = (value: string): value is KyrubOrderStatus =>
  Object.prototype.hasOwnProperty.call(TRANSITIONS, value);

const requestedStatus = (message: string): KyrubOrderMutableStatus | null => {
  const intent = normalize(message);
  if (/\b(cancele|cancelar|cancela)\b/.test(intent)) return 'cancelled';
  if (/\b(recuse|recusar|rejeite|rejeitar)\b/.test(intent)) return 'rejected';
  if (/\b(conclua|concluir|finalize|finalizar|complete|completar)\b/.test(intent)) return 'completed';
  if (
    /\b(saiu|enviar|envie|mandar|mande)\b/.test(intent) &&
    /\b(entrega|delivery)\b/.test(intent)
  ) return 'out_for_delivery';
  if (/\b(pronto|pronta)\b/.test(intent)) return 'ready';
  if (/\b(preparo|preparando|preparacao|prepare|preparar|inicie o preparo|iniciar o preparo)\b/.test(intent)) {
    return 'preparing';
  }
  if (/\b(aceite|aceitar|aceita|aprove|aprovar)\b/.test(intent)) return 'accepted';
  return null;
};

export const isKyrubOrderStatusIntent = (message: string): boolean => {
  const intent = normalize(message);
  return /\b(pedido|pedidos|comanda|comandas)\b/.test(intent) && requestedStatus(message) !== null;
};

const resolveOrder = (
  message: string,
  orders: KyrubErpOrderSummary[]
): KyrubErpOrderSummary | null => {
  const raw = message.toLocaleLowerCase('pt-BR');
  const exact = orders.filter(order => raw.includes(order.id.toLocaleLowerCase('pt-BR')));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  const compactMessage = normalize(message).replace(/[^a-z0-9]/g, '');
  const suffixMatches = orders.filter(order => {
    const compactId = normalize(order.id).replace(/[^a-z0-9]/g, '');
    if (compactId.length < 4) return false;
    const suffix = compactId.slice(-Math.min(8, compactId.length));
    return suffix.length >= 4 && compactMessage.includes(suffix);
  });
  if (suffixMatches.length === 1) return suffixMatches[0];

  return orders.length === 1 ? orders[0] : null;
};

const decisionReason = (message: string): string => {
  const match = message.match(
    /(?:porque|pois|motivo\s*[:=-]?|por causa de|raz[aã]o\s*[:=-]?)\s+(.+?)\s*$/i
  );
  return match?.[1]?.trim().replace(/[.!?]+$/g, '').slice(0, 500) ?? '';
};

const proposalId = (
  conversationId: string,
  orderId: string,
  nextStatus: string
): string => {
  const conversation = conversationId
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36) || 'conversation';
  const order = orderId
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-32) || 'order';
  return `order-status-${conversation}-${order}-${nextStatus}`.slice(0, 96);
};

export type KyrubOrderStatusBuildResult =
  | { kind: 'not_requested' }
  | { kind: 'needs_context' }
  | { kind: 'needs_order'; orders: KyrubErpOrderSummary[] }
  | { kind: 'needs_reason'; order: KyrubErpOrderSummary; nextStatus: 'cancelled' | 'rejected' }
  | { kind: 'already_current'; order: KyrubErpOrderSummary; status: KyrubOrderStatus }
  | { kind: 'invalid_transition'; order: KyrubErpOrderSummary; nextStatus: KyrubOrderMutableStatus }
  | { kind: 'proposal'; proposal: KyrubAiUpdateOrderStatusProposal };

export const buildKyrubOrderStatusProposal = (
  message: string,
  conversationId: string,
  context?: KyrubErpContextSnapshot
): KyrubOrderStatusBuildResult => {
  if (!isKyrubOrderStatusIntent(message)) return { kind: 'not_requested' };
  if (!context || context.availability.orders !== true) return { kind: 'needs_context' };

  const nextStatus = requestedStatus(message);
  if (!nextStatus) return { kind: 'not_requested' };

  const orders = context.pendingOrders.filter(order => isOrderStatus(order.status));
  const order = resolveOrder(message, orders);
  if (!order) return { kind: 'needs_order', orders };

  const currentStatus = order.status as KyrubOrderStatus;
  if (currentStatus === nextStatus) {
    return { kind: 'already_current', order, status: currentStatus };
  }
  if (!TRANSITIONS[currentStatus].includes(nextStatus)) {
    return { kind: 'invalid_transition', order, nextStatus };
  }

  const reason = decisionReason(message);
  if ((nextStatus === 'cancelled' || nextStatus === 'rejected') && !reason) {
    return { kind: 'needs_reason', order, nextStatus };
  }

  const proposal: KyrubAiUpdateOrderStatusProposal = {
    id: proposalId(conversationId, order.id, nextStatus),
    type: 'update_order_status',
    orderId: order.id,
    expectedCurrentStatus: currentStatus,
    nextStatus,
    ...(reason ? { decision: { reason } } : {}),
    requiresConfirmation: true,
    origin: 'kyrubia',
    risk: 'medium',
    inputProvenance: 'user_intent',
    impact: { entityCount: 1, reversibility: 'limited' },
  };
  return { kind: 'proposal', proposal };
};
