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

export type KyrubOrderReadFocus =
  | 'overview'
  | 'items'
  | 'payment'
  | 'fulfillment'
  | 'customer_note';

export const isKyrubOrderDetailReadIntent = (message: string): boolean => {
  const intent = normalize(message);
  if (!/\b(pedido|pedidos|comanda|comandas)\b/.test(intent)) return false;
  const asksRead = /\b(detalhes?|detalhe|mostre|mostrar|veja|ver|consulte|consultar|qual|quais|quanto|o que|itens?|produtos?|pagamento|pago|entrega|retirada|mesa|observacao|observacoes|nota)\b/.test(intent);
  const mutation = /\b(aceite|aceitar|recuse|recusar|rejeite|rejeitar|cancele|cancelar|prepare|preparar|pronto|conclua|concluir|finalize|finalizar|envie|enviar)\b/.test(intent);
  return asksRead && !mutation;
};

export const resolveKyrubOrderReadFocus = (message: string): KyrubOrderReadFocus => {
  const intent = normalize(message);
  if (/\b(item|itens|produto|produtos|o que tem|o que foi pedido)\b/.test(intent)) return 'items';
  if (/\b(pagamento|pago|pagou|falta pagar|valor pago)\b/.test(intent)) return 'payment';
  if (/\b(entrega|retirada|mesa|local|endereco|endereço)\b/.test(intent)) return 'fulfillment';
  if (/\b(observacao|observacoes|nota do cliente|recado)\b/.test(intent)) return 'customer_note';
  return 'overview';
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

export type KyrubOrderReadResolution =
  | { kind: 'not_requested' }
  | { kind: 'needs_context' }
  | { kind: 'needs_order'; orders: KyrubErpOrderSummary[] }
  | { kind: 'resolved'; order: KyrubErpOrderSummary; focus: KyrubOrderReadFocus };

export const resolveKyrubOrderDetailRead = (
  message: string,
  context?: KyrubErpContextSnapshot
): KyrubOrderReadResolution => {
  if (!isKyrubOrderDetailReadIntent(message)) return { kind: 'not_requested' };
  if (!context || context.availability.orders !== true) return { kind: 'needs_context' };
  const order = resolveOrder(message, context.pendingOrders);
  if (!order) return { kind: 'needs_order', orders: context.pendingOrders };
  return {
    kind: 'resolved',
    order,
    focus: resolveKyrubOrderReadFocus(message),
  };
};
