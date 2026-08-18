import type {
  KyrubErpContextSnapshot,
  KyrubErpInventoryItemSummary,
} from './kyrubErpContext';
import { normalizeKyrubiaIntentText } from './kyrubiaIntentRouter';

export type KyrubiaInventoryReadResult = {
  reply: string;
  items: KyrubErpInventoryItemSummary[];
};

const INVENTORY_NOUNS = /\b(insumo|insumos|ingrediente|ingredientes|materia prima|materias primas|inventario)\b/;
const STOCK_QUERY = /\b(estoque|saldo|quantidade|quanto|quantos|quantas|tenho|tem|possui|consulte|consultar|veja|verifique|listar|liste|mostre)\b/;

const formatQuantity = (value: number): string =>
  value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

const normalizedInventoryName = (item: KyrubErpInventoryItemSummary): string =>
  normalizeKyrubiaIntentText(item.name);

const requestedItemsFromMessage = (
  intent: string,
  items: KyrubErpInventoryItemSummary[]
): KyrubErpInventoryItemSummary[] => {
  const explicit = items.filter(item => {
    const name = normalizedInventoryName(item);
    return Boolean(name) && intent.includes(name);
  });
  if (explicit.length > 0) return explicit;
  return INVENTORY_NOUNS.test(intent) ? items : [];
};

export const resolveKyrubiaInventoryRead = (
  message: string,
  context?: KyrubErpContextSnapshot
): KyrubiaInventoryReadResult | null => {
  const intent = normalizeKyrubiaIntentText(message);
  if (!intent || !STOCK_QUERY.test(intent)) return null;

  const inventoryItems = context?.inventoryItems ?? [];
  const mentionsInventory = INVENTORY_NOUNS.test(intent);
  const mentionsKnownItem = inventoryItems.some(item => {
    const name = normalizedInventoryName(item);
    return Boolean(name) && intent.includes(name);
  });
  if (!mentionsInventory && !mentionsKnownItem) return null;

  if (!context) {
    return {
      reply: 'Não consegui consultar o inventário privado nesta solicitação. Tente novamente em instantes.',
      items: [],
    };
  }
  if (context.availability.inventory !== true) {
    return {
      reply: 'O inventário privado de insumos está temporariamente indisponível para consulta.',
      items: [],
    };
  }

  const requested = requestedItemsFromMessage(intent, inventoryItems);
  if (requested.length === 0) {
    return {
      reply: inventoryItems.length === 0
        ? 'Seu inventário privado não possui insumos cadastrados nesta leitura.'
        : 'Não encontrei esses insumos no inventário privado nesta leitura. O catálogo de produtos é separado do estoque de insumos.',
      items: [],
    };
  }

  const lines = requested
    .map(item => `- ${item.name} — ${formatQuantity(item.currentQuantity)} ${item.unit}`)
    .join('\n');
  const truncated = context.inventoryTruncated === true
    ? '\n\nA leitura do inventário foi limitada; podem existir outros insumos além dos mostrados.'
    : '';

  return {
    reply: `Consultei o inventário privado de insumos:\n${lines}${truncated}`,
    items: requested,
  };
};
