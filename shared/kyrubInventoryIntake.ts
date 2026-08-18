import type {
  KyrubAiAdjustInventoryProposal,
  KyrubInventoryAdjustmentEntry,
  KyrubInventoryUnit,
} from './kyrubActions';

const normalizeText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');

export const isKyrubInventoryIntakeIntent = (message: string): boolean => {
  const normalized = normalizeText(message);
  const hasStockContext = /\b(nota fiscal|nf\b|fornecedor|entrada de estoque|dar entrada|recebi essa nota|estoque)\b/.test(normalized);
  const hasQuantityLine = /\b\d+[\d.,]*\s*(un|und|unid|unidade|unidades|kg|g|l|ml)\b/i.test(message);
  return hasStockContext && hasQuantityLine;
};

export const parseBrazilianFiscalNumber = (raw: string): number | null => {
  const compact = raw.replace(/\s+/g, '').trim();
  if (!compact) return null;

  let normalized = compact;
  if (compact.includes(',') && compact.includes('.')) {
    normalized = compact.replace(/\./g, '').replace(',', '.');
  } else if (compact.includes(',')) {
    normalized = compact.replace(',', '.');
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const normalizeUnit = (raw: string): KyrubInventoryUnit | null => {
  const unit = normalizeText(raw).replace(/\./g, '').trim();
  if (['un', 'und', 'unid', 'unidade', 'unidades'].includes(unit)) return 'un';
  if (unit === 'kg') return 'kg';
  if (unit === 'g') return 'g';
  if (unit === 'l') return 'l';
  if (unit === 'ml') return 'ml';
  return null;
};

const cleanItemName = (value: string): string =>
  value
    .replace(/^[-–—:;\s]+/, '')
    .replace(/[-–—:;\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);

export const parseKyrubInventoryIntakeEntries = (
  message: string
): KyrubInventoryAdjustmentEntry[] => {
  const entries: KyrubInventoryAdjustmentEntry[] = [];
  const seen = new Set<string>();

  for (const line of message.split(/\r?\n/)) {
    const match = line.match(
      /^\s*(\d[\d.,]*)\s*(UN(?:D|ID)?|UNIDADE(?:S)?|KG|G|L|ML)\s*(?:[-–—:;]|\s)+\s*(.+?)\s*$/i
    );
    if (!match) continue;

    const quantity = parseBrazilianFiscalNumber(match[1]);
    const unit = normalizeUnit(match[2]);
    const name = cleanItemName(match[3]);
    if (!quantity || !unit || !name) continue;

    const key = `${normalizeText(name)}::${unit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ name, quantity, unit });
  }

  return entries.slice(0, 60);
};

const actionIdFor = (conversationId: string): string => {
  const compact = conversationId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48);
  return `inventory-intake-${compact || 'conversation'}-${Date.now()}`;
};

export const buildKyrubInventoryIntakeProposal = (
  message: string,
  conversationId: string
): KyrubAiAdjustInventoryProposal | null => {
  if (!isKyrubInventoryIntakeIntent(message)) return null;
  const entries = parseKyrubInventoryIntakeEntries(message);
  if (entries.length === 0) return null;

  const normalized = normalizeText(message);
  const supplierLine = message
    .split(/\r?\n/)
    .find(line => /^\s*fornecedor\s*:/i.test(line));
  const label = supplierLine?.split(':').slice(1).join(':').trim();

  return {
    id: actionIdFor(conversationId),
    type: 'adjust_inventory',
    mode: 'increment',
    entries,
    source: {
      kind: /\b(nota fiscal|nf\b)\b/.test(normalized)
        ? 'supplier_invoice'
        : 'inventory_intake_text',
      ...(label ? { label } : {}),
    },
    requiresConfirmation: true,
    origin: 'kyrubia',
    risk: 'medium',
    inputProvenance: 'document_content',
    impact: {
      entityCount: entries.length,
      reversibility: 'limited',
    },
  };
};
