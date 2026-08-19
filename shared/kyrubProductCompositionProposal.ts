import type { KyrubErpContextSnapshot, KyrubErpInventorySummary } from './kyrubErpContext';
import type {
  KyrubAiSetProductCompositionProposal,
  KyrubInventoryUnit,
  KyrubProductCompositionLine,
} from './kyrubActions';

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeUnit = (value: string): KyrubInventoryUnit | null => {
  const unit = normalize(value).replace(/\s+/g, '');
  if (['un', 'und', 'unid', 'unidade', 'unidades'].includes(unit)) return 'un';
  if (unit === 'kg') return 'kg';
  if (unit === 'g') return 'g';
  if (unit === 'l') return 'l';
  if (unit === 'ml') return 'ml';
  return null;
};

const parseNumber = (value: string): number | null => {
  const compact = value.replace(/\s+/g, '').trim();
  if (!compact) return null;
  const normalized = compact.includes(',') && compact.includes('.')
    ? compact.replace(/\./g, '').replace(',', '.')
    : compact.replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const convertQuantity = (
  quantity: number,
  from: KyrubInventoryUnit,
  to: KyrubInventoryUnit
): number | null => {
  if (from === to) return quantity;
  if (from === 'g' && to === 'kg') return quantity / 1000;
  if (from === 'kg' && to === 'g') return quantity * 1000;
  if (from === 'ml' && to === 'l') return quantity / 1000;
  if (from === 'l' && to === 'ml') return quantity * 1000;
  return null;
};

const matchInventoryItem = (
  label: string,
  inventory: KyrubErpInventorySummary[]
): KyrubErpInventorySummary | null => {
  const target = normalize(label.replace(/^(?:de|do|da|dos|das)\s+/i, ''));
  if (!target) return null;
  const exact = inventory.filter(item => normalize(item.name) === target);
  if (exact.length === 1) return exact[0];
  const partial = inventory.filter(item => {
    const name = normalize(item.name);
    return name.includes(target) || target.includes(name);
  });
  return partial.length === 1 ? partial[0] : null;
};

const parseYield = (message: string): number => {
  const match = message.match(/(?:rende|rendimento|produz)\s*[:=-]?\s*(\d[\d.,]*)\s*(?:un|und|unid|unidade|unidades)?\b/i);
  return match?.[1] ? parseNumber(match[1]) ?? 1 : 1;
};

const looksLikeCompositionLine = (line: string): boolean =>
  /^\s*[-•]?\s*\d[\d.,]*\s*(?:un(?:d|id)?|unidade(?:s)?|kg|g|l|ml)\b/i.test(line) &&
  !/^\s*[-•]?\s*\d[\d.,]*\s*(?:un(?:d|id)?|unidade(?:s)?)?\s*(?:[-–—:;]|\s+)?\s*(?:rendimento|rende|produz)\b/i.test(line);

const parseCompositionLine = (
  line: string,
  inventory: KyrubErpInventorySummary[]
): KyrubProductCompositionLine | null => {
  const match = line.match(/^\s*[-•]?\s*(\d[\d.,]*)\s*(un(?:d|id)?|unidade(?:s)?|kg|g|l|ml)\s*(?:[-–—:;]|\s+de\s+|\s+)?\s*(.+?)\s*$/i);
  if (!match) return null;
  const quantity = parseNumber(match[1]);
  const fromUnit = normalizeUnit(match[2]);
  const label = match[3]?.trim() ?? '';
  if (!quantity || !fromUnit || !label) return null;
  if (/^(?:rendimento|rende|produz)\b/i.test(label)) return null;

  const item = matchInventoryItem(label, inventory);
  if (!item) return null;
  const canonicalQuantity = convertQuantity(quantity, fromUnit, item.unit);
  if (!canonicalQuantity || canonicalQuantity <= 0) return null;

  return {
    inventoryItemId: item.id,
    inventoryItemName: item.name,
    quantity: Math.round(canonicalQuantity * 1_000_000) / 1_000_000,
    unit: item.unit,
  };
};

const resolveTargetProduct = (
  message: string,
  context: KyrubErpContextSnapshot
) => {
  const intent = normalize(message);
  const candidates = context.products
    .filter(product => !product.isService)
    .filter(product => {
      const name = normalize(product.name);
      const withoutCode = name.replace(/^\d+\s+/, '');
      return intent.includes(name) || (withoutCode.length >= 3 && intent.includes(withoutCode));
    })
    .sort((left, right) => normalize(right.name).length - normalize(left.name).length);

  if (candidates.length === 0) return null;
  const bestLength = normalize(candidates[0].name).replace(/^\d+\s+/, '').length;
  const equallySpecific = candidates.filter(product =>
    normalize(product.name).replace(/^\d+\s+/, '').length === bestLength
  );
  return equallySpecific.length === 1 ? equallySpecific[0] : null;
};

export const isKyrubProductCompositionIntent = (message: string): boolean => {
  const intent = normalize(message);
  return /\b(ficha tecnica|receita|composicao)\b/.test(intent) &&
    /\b(crie|criar|cadastre|cadastrar|monte|montar|defina|definir|configure|configurar|faca|fazer)\b/.test(intent);
};

export type KyrubProductCompositionBuildResult =
  | { kind: 'not_requested' }
  | { kind: 'needs_context'; reason: 'products' | 'inventory' }
  | { kind: 'needs_product' }
  | { kind: 'needs_lines' }
  | { kind: 'proposal'; proposal: KyrubAiSetProductCompositionProposal };

export const buildKyrubProductCompositionProposal = (
  message: string,
  conversationId: string,
  context?: KyrubErpContextSnapshot
): KyrubProductCompositionBuildResult => {
  if (!isKyrubProductCompositionIntent(message)) return { kind: 'not_requested' };
  if (!context?.availability.products) return { kind: 'needs_context', reason: 'products' };
  if (context.availability.inventory !== true) return { kind: 'needs_context', reason: 'inventory' };

  const product = resolveTargetProduct(message, context);
  if (!product) return { kind: 'needs_product' };

  const inventory = context.inventory ?? [];
  const candidateLines = message
    .split(/\r?\n/)
    .filter(looksLikeCompositionLine);
  if (candidateLines.length === 0) return { kind: 'needs_lines' };

  const parsedLines = candidateLines.map(line => parseCompositionLine(line, inventory));
  if (parsedLines.some(line => line === null)) return { kind: 'needs_lines' };

  const lines = parsedLines.filter(
    (line): line is KyrubProductCompositionLine => Boolean(line)
  );
  const unique = new Map(lines.map(line => [line.inventoryItemId, line]));
  if (unique.size === 0 || unique.size !== lines.length) return { kind: 'needs_lines' };

  const compactConversationId = conversationId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48);
  const proposal: KyrubAiSetProductCompositionProposal = {
    id: `product-composition-${compactConversationId || 'conversation'}-${Date.now()}`,
    type: 'set_product_composition',
    productId: product.id,
    productName: product.name,
    kind: 'recipe',
    yieldQuantity: parseYield(message),
    lines: [...unique.values()],
    requiresConfirmation: true,
    origin: 'kyrubia',
    risk: 'medium',
    inputProvenance: 'user_intent',
    impact: { entityCount: unique.size, reversibility: 'limited' },
  };
  return { kind: 'proposal', proposal };
};
