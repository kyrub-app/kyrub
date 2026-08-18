import type { KyrubErpInventoryItemSummary } from './kyrubErpContext';

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
