import type {
  KyrubErpContextSnapshot,
  KyrubErpInventoryItemSummary,
} from './kyrubErpContext';

export type KyrubiaInventoryReadResult = {
  reply: string;
  items: KyrubErpInventoryItemSummary[];
};

const INVENTORY_NOUNS = /\b(insumo|insumos|ingrediente|ingredientes|materia prima|materias primas|inventario)\b/;
const STOCK_QUERY = /\b(estoque|saldo|quantidade|quanto|quantos|quantas|tenho|tem|possui|consulte|consultar|veja|verifique|listar|liste|mostre)\b/;

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

const formatQuantity = (value: number): string =>
  value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

export const buildKyrubiaInventoryReadHints = (
  items: KyrubErpInventoryItemSummary[],
  itemCount = items.length
): string[] => {
  const header = itemCount === 0
    ? 'Inventário privado consultado: nenhum insumo cadastrado. Produtos do catálogo são dados separados.'
    : `Inventário privado consultado: ${itemCount} ${itemCount === 1 ? 'insumo' : 'insumos'}. Insumos não são produtos do catálogo.`;

  return [
    header,
    ...items.slice(0, 6).map(item =>
      `Inventário privado (insumo; não é produto do catálogo): ${item.name} — ${formatQuantity(item.currentQuantity)} ${item.unit}.`
    ),
  ];
};

export const resolveKyrubiaInventoryRead = (
  message: string,
  context: KyrubErpContextSnapshot | undefined
): KyrubiaInventoryReadResult | null => {
  const intent = normalize(message);
  if (!INVENTORY_NOUNS.test(intent) || !STOCK_QUERY.test(intent)) return null;

  if (!context) {
    return {
      reply: 'Não consegui consultar o inventário privado de insumos nesta solicitação.',
      items: [],
    };
  }

  if (context.availability.inventory === false) {
    return {
      reply: 'O inventário privado de insumos está indisponível agora. Não vou usar o estoque dos produtos do catálogo como substituto.',
      items: [],
    };
  }

  const items = context.inventoryItems ?? [];
  const itemCount = context.inventoryItemCount ?? items.length;
  if (itemCount === 0 || items.length === 0) {
    return {
      reply: 'Não há insumos cadastrados no inventário privado da sua loja. Isso é separado dos produtos do catálogo.',
      items: [],
    };
  }

  const listed = items
    .slice(0, 20)
    .map(item => `- ${item.name}: ${formatQuantity(item.currentQuantity)} ${item.unit}`)
    .join('\n');
  const truncated = Boolean(context.inventoryTruncated || itemCount > items.length);

  return {
    reply: `Consultei o inventário privado de insumos da sua loja.\n\n${listed}${truncated ? '\n\nHá mais insumos cadastrados do que os exibidos neste snapshot.' : ''}\n\nEsses itens são insumos do inventário, não produtos do catálogo.`,
    items,
  };
};