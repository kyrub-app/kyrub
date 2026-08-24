import type {
  KyrubAiAdjustInventoryProposal,
  KyrubInventoryAdjustmentEntry,
  KyrubInventoryUnit,
} from './kyrubActions';
import {
  buildKyrubInventorySetupWorkflow,
  type KyrubInventorySetupCarrier,
} from './kyrubInventorySetupWorkflow.js';

const normalizeText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');

const hasInventoryContext = (message: string): boolean =>
  /\b(nota fiscal|nf\b|fornecedor|entrada de estoque|dar entrada|recebi essa nota|recebi|estoque)\b/.test(
    normalizeText(message)
  );

export const isKyrubInventoryIntakeIntent = (message: string): boolean => {
  const hasQuantityLine = /\b\d+[\d.,]*\s*(un|und|unid|unidade|unidades|kg|g|l|ml)\b/i.test(message);
  const hasNaturalCount = /\brecebi\s+\d+[\d.,]*\s+[a-záàâãéêíóôõúç]/i.test(message);
  return hasInventoryContext(message) && (hasQuantityLine || hasNaturalCount);
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
    .replace(/^\s*(?:de|do|da|dos|das)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);

const singularizeCountName = (value: string): string => {
  const name = cleanItemName(value);
  const normalized = normalizeText(name).trim();
  if (normalized === 'paes') return 'Pão';
  if (normalized === 'hamburgueres') return 'Hambúrguer';
  if (/ões$/i.test(name)) return name.replace(/ões$/i, 'ão');
  if (/s$/i.test(name) && name.length > 3) return name.slice(0, -1);
  return name;
};

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

const intakeClauseFrom = (message: string): string => {
  const received = message.match(
    /\brecebi\s+(.+?)(?=\.\s*(?:d[eê]|separe|separar|monte|crie|fa[cç]a)|;\s*(?:d[eê]|separe|separar|monte|crie|fa[cç]a)|$)/i
  );
  return received?.[1]?.trim() ?? '';
};

const parsedInlineEntry = (raw: string): KyrubInventoryAdjustmentEntry | null => {
  const term = raw.trim().replace(/^[,;\s]+|[,;.\s]+$/g, '');
  if (!term) return null;

  const explicit = term.match(
    /^(\d[\d.,]*)\s*(un(?:d|id)?|unidade(?:s)?|kg|g|l|ml)\s+(?:de\s+)?(.+)$/i
  );
  if (explicit) {
    const quantity = parseBrazilianFiscalNumber(explicit[1]);
    const unit = normalizeUnit(explicit[2]);
    const name = cleanItemName(explicit[3]);
    return quantity && unit && name ? { name, quantity, unit } : null;
  }

  const count = term.match(/^(\d[\d.,]*)\s+(.+)$/i);
  if (!count) return null;
  const quantity = parseBrazilianFiscalNumber(count[1]);
  const name = singularizeCountName(count[2]);
  return quantity && name ? { name, quantity, unit: 'un' } : null;
};

const parseInlineIntakeEntries = (message: string): KyrubInventoryAdjustmentEntry[] => {
  const clause = intakeClauseFrom(message);
  if (!clause) return [];
  return clause
    .split(/\s*,\s*|\s+e\s+(?=\d)/i)
    .map(parsedInlineEntry)
    .filter((entry): entry is KyrubInventoryAdjustmentEntry => Boolean(entry));
};

const dedupeEntries = (
  entries: KyrubInventoryAdjustmentEntry[]
): KyrubInventoryAdjustmentEntry[] => {
  const result: KyrubInventoryAdjustmentEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = `${normalizeText(entry.name).replace(/\s+/g, ' ').trim()}::${entry.unit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result.slice(0, 60);
};

export const parseKyrubInventoryIntakeEntries = (
  message: string
): KyrubInventoryAdjustmentEntry[] => {
  const lineEntries = message
    .split(/\r?\n/)
    .map(parsedEntryFromLine)
    .filter((entry): entry is KyrubInventoryAdjustmentEntry => Boolean(entry));
  const inlineEntries = parseInlineIntakeEntries(message);
  return dedupeEntries([...lineEntries, ...inlineEntries]);
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
): KyrubInventorySetupCarrier | null => {
  if (!isKyrubInventoryIntakeIntent(message)) return null;
  const entries = parseKyrubInventoryIntakeEntries(message);
  if (entries.length === 0) return null;

  const normalized = normalizeText(message);
  const label = supplierLabelFrom(message);
  const proposal: KyrubAiAdjustInventoryProposal = {
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
    inputProvenance: /\b(nota fiscal|nf\b)\b/.test(normalized)
      ? 'document_content'
      : 'user_intent',
    impact: {
      entityCount: entries.length,
      reversibility: 'limited',
    },
  };

  const setupWorkflow = buildKyrubInventorySetupWorkflow(
    message,
    conversationId,
    proposal
  );
  return setupWorkflow ? { ...proposal, setupWorkflow } : proposal;
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
