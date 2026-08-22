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

const hasInventoryContext = (message: string): boolean =>
  /\b(nota fiscal|nf\b|fornecedor|entrada de estoque|dar entrada|recebi essa nota|estoque)\b/.test(
    normalizeText(message)
  );

export const isKyrubInventoryIntakeIntent = (message: string): boolean => {
  const hasQuantityLine = /\b\d+[\d.,]*\s*(un|und|unid|unidade|unidades|kg|g|l|ml)\b/i.test(message);
  return hasInventoryContext(message) && hasQuantityLine;
};

export const isKyrubInventoryAttachmentIntakeIntent = (
  message: string
): boolean => {
  const normalized = normalizeText(message);
  const hasMutationRequest =
    /\b(atualiz\w*|ajust\w*|dar entrada|de entrada|registre\w*|adicione\w*|inclua\w*|lance\w*|reponha\w*|repor|coloque\w*)\b/.test(normalized);
  return hasInventoryContext(message) && hasMutationRequest;
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
    .replace(/^[-–—:;*•\s]+/, '')
    .replace(/[-–—:;*•\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);

const stripListMarker = (value: string): string =>
  value.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();

const parsedEntryFromLine = (
  rawLine: string
): KyrubInventoryAdjustmentEntry | null => {
  const line = stripListMarker(rawLine);
  const quantityFirst = line.match(
    /^(\d[\d.,]*)\s*(UN(?:D|ID)?|UNIDADE(?:S)?|KG|G|L|ML)\s*(?:de\s+|[-–—:;]\s*|\s+)(.+?)\s*$/i
  );
  if (quantityFirst) {
    const quantity = parseBrazilianFiscalNumber(quantityFirst[1]);
    const unit = normalizeUnit(quantityFirst[2]);
    const name = cleanItemName(quantityFirst[3]);
    return quantity && unit && name ? { name, quantity, unit } : null;
  }

  const nameFirst = line.match(
    /^(.+?)\s*(?:[-–—:;]\s*|\s{2,})(\d[\d.,]*)\s*(UN(?:D|ID)?|UNIDADE(?:S)?|KG|G|L|ML)\s*$/i
  );
  if (!nameFirst) return null;
  const name = cleanItemName(nameFirst[1]);
  const quantity = parseBrazilianFiscalNumber(nameFirst[2]);
  const unit = normalizeUnit(nameFirst[3]);
  return quantity && unit && name ? { name, quantity, unit } : null;
};

export const parseKyrubInventoryIntakeEntries = (
  message: string
): KyrubInventoryAdjustmentEntry[] => {
  const entries: KyrubInventoryAdjustmentEntry[] = [];
  const seen = new Set<string>();

  for (const line of message.split(/\r?\n/)) {
    const entry = parsedEntryFromLine(line);
    if (!entry) continue;

    const key = `${normalizeText(entry.name)}::${entry.unit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }

  return entries.slice(0, 60);
};

const actionIdFor = (conversationId: string): string => {
  const compact = conversationId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48);
  return `inventory-intake-${compact || 'conversation'}-${Date.now()}`;
};

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const attachmentActionIdFor = (
  conversationId: string,
  attachmentIds: string[],
  entries: KyrubInventoryAdjustmentEntry[]
): string => {
  const compact = conversationId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40);
  const fingerprint = JSON.stringify({
    attachmentIds: [...attachmentIds].sort(),
    entries: entries.map(entry => ({
      name: normalizeText(entry.name).replace(/\s+/g, ' ').trim(),
      quantity: entry.quantity,
      unit: entry.unit,
    })),
  });
  return `inventory-document-${compact || 'conversation'}-${stableHash(fingerprint)}`;
};

const supplierLabelFrom = (message: string): string => {
  const supplierLine = message
    .split(/\r?\n/)
    .find(line => /^\s*(?:[-*•]\s*)?fornecedor\s*:/i.test(line));
  return supplierLine?.split(':').slice(1).join(':').trim().slice(0, 180) ?? '';
};

export const buildKyrubInventoryIntakeProposal = (
  message: string,
  conversationId: string
): KyrubAiAdjustInventoryProposal | null => {
  if (!isKyrubInventoryIntakeIntent(message)) return null;
  const entries = parseKyrubInventoryIntakeEntries(message);
  if (entries.length === 0) return null;

  const normalized = normalizeText(message);
  const label = supplierLabelFrom(message);

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

export const buildKyrubInventoryAttachmentIntakeProposal = (
  userMessage: string,
  observedDocumentText: string,
  conversationId: string,
  attachmentIds: string[]
): KyrubAiAdjustInventoryProposal | null => {
  if (!isKyrubInventoryAttachmentIntakeIntent(userMessage)) return null;
  if (attachmentIds.length === 0) return null;

  const entries = parseKyrubInventoryIntakeEntries(observedDocumentText);
  if (entries.length === 0) return null;
  const label = supplierLabelFrom(observedDocumentText);

  return {
    id: attachmentActionIdFor(conversationId, attachmentIds, entries),
    type: 'adjust_inventory',
    mode: 'increment',
    entries,
    source: {
      kind: 'supplier_invoice',
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
