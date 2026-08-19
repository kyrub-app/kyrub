import type {
  KyrubAiAdjustInventoryProposal,
  KyrubInventoryAdjustmentEntry,
  KyrubInventoryAdjustmentMode,
  KyrubInventoryAdjustmentSourceKind,
  KyrubInventoryMovementKind,
  KyrubInventoryUnit,
} from './kyrubActions';

export type KyrubInventoryMovementIntent = {
  mode: KyrubInventoryAdjustmentMode;
  movementKind: KyrubInventoryMovementKind;
  sourceKind: KyrubInventoryAdjustmentSourceKind;
};

const normalizeText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

const cleanItemName = (value: string): string =>
  value
    .replace(/^\s*(?:de|do|da|dos|das)\s+/i, '')
    .replace(/^[-–—:;,\s]+/, '')
    .replace(/[-–—:;,\.\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);

const parseNumber = (raw: string, allowZero = false): number | null => {
  const compact = raw.replace(/\s+/g, '').trim();
  if (!compact) return null;
  let normalized = compact;
  if (compact.includes(',') && compact.includes('.')) {
    normalized = compact.replace(/\./g, '').replace(',', '.');
  } else if (compact.includes(',')) {
    normalized = compact.replace(',', '.');
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  if (allowZero ? parsed < 0 : parsed <= 0) return null;
  return parsed;
};

const normalizeUnit = (raw: string): KyrubInventoryUnit | null => {
  const unit = normalizeText(raw).replace(/\./g, '');
  if (['un', 'und', 'unid', 'unidade', 'unidades'].includes(unit)) return 'un';
  if (unit === 'kg') return 'kg';
  if (unit === 'g') return 'g';
  if (unit === 'l') return 'l';
  if (unit === 'ml') return 'ml';
  return null;
};

const UNIT_PATTERN = '(UN(?:D|ID)?|UNIDADE(?:S)?|KG|G|L|ML)';
const NUMBER_PATTERN = '(\\d[\\d.,]*)';

const LOSS_INTENT = /\b(perdi|perda|estragou|estragado|estragada|desperd[ií]cio|desperdicei|descart(?:ei|ar|e)|venceu|vencido|vencida|quebrou)\b/i;
const OUTFLOW_INTENT = /\b(baixe|baixar|d[eê]\s+baixa|dar\s+baixa|retire|retirar|retirada|consumi|consumo|usei|utilizei|sa[ií]da)\b/i;
const CORRECTION_INTENT = /\b(contagem\s+f[ií]sica|invent[aá]rio\s+f[ií]sico|corrija|corrigir|corre[cç][aã]o|ajuste\s+(?:o\s+)?saldo\s+para|saldo\s+correto|na\s+verdade\s+(?:tenho|h[aá]))\b/i;

export const classifyKyrubInventoryMovementIntent = (
  message: string
): KyrubInventoryMovementIntent | null => {
  if (CORRECTION_INTENT.test(message)) {
    return {
      mode: 'set',
      movementKind: 'correction',
      sourceKind: 'physical_count',
    };
  }
  if (LOSS_INTENT.test(message)) {
    return {
      mode: 'decrement',
      movementKind: 'loss',
      sourceKind: 'loss_report',
    };
  }
  if (OUTFLOW_INTENT.test(message)) {
    return {
      mode: 'decrement',
      movementKind: 'outflow',
      sourceKind: 'manual_outflow',
    };
  }
  return null;
};

const addEntry = (
  entries: KyrubInventoryAdjustmentEntry[],
  seen: Set<string>,
  rawName: string,
  rawQuantity: string,
  rawUnit: string,
  allowZero: boolean
): void => {
  const name = cleanItemName(rawName);
  const quantity = parseNumber(rawQuantity, allowZero);
  const unit = normalizeUnit(rawUnit);
  if (quantity === null || !unit || !name) return;
  const key = `${normalizeText(name)}::${unit}`;
  if (seen.has(key)) return;
  seen.add(key);
  entries.push({ name, quantity, unit });
};

export const parseKyrubInventoryMovementEntries = (
  message: string,
  intent: KyrubInventoryMovementIntent
): KyrubInventoryAdjustmentEntry[] => {
  const entries: KyrubInventoryAdjustmentEntry[] = [];
  const seen = new Set<string>();
  const allowZero = intent.mode === 'set';
  const quantityFirst = new RegExp(
    `${NUMBER_PATTERN}\\s*${UNIT_PATTERN}\\s*(?:de\\s+)?(.+)$`,
    'i'
  );
  const targetQuantity = new RegExp(
    `^(.+?)\\s+(?:para|em|=|:)\\s*${NUMBER_PATTERN}\\s*${UNIT_PATTERN}\\s*$`,
    'i'
  );

  for (const rawLine of message.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (intent.mode === 'set') {
      const target = line.match(targetQuantity);
      if (target) {
        addEntry(entries, seen, target[1], target[2], target[3], allowZero);
        continue;
      }
    }

    const quantity = line.match(quantityFirst);
    if (quantity) {
      addEntry(entries, seen, quantity[3], quantity[1], quantity[2], allowZero);
      continue;
    }

    // Frases naturais como "Perdi 300 g de carne" ou "baixe 2 un de pão".
    const inline = line.match(
      new RegExp(`${NUMBER_PATTERN}\\s*${UNIT_PATTERN}\\s*(?:de\\s+)?(.+?)(?:[.!?]|$)`, 'i')
    );
    if (inline) {
      addEntry(entries, seen, inline[3], inline[1], inline[2], allowZero);
    }
  }

  return entries.slice(0, 60);
};

const actionIdFor = (
  conversationId: string,
  movementKind: KyrubInventoryMovementKind
): string => {
  const compact = conversationId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48);
  return `inventory-${movementKind}-${compact || 'conversation'}-${Date.now()}`;
};

export const buildKyrubInventoryMovementProposal = (
  message: string,
  conversationId: string
): KyrubAiAdjustInventoryProposal | null => {
  const intent = classifyKyrubInventoryMovementIntent(message);
  if (!intent) return null;
  const entries = parseKyrubInventoryMovementEntries(message, intent);
  if (entries.length === 0) return null;

  return {
    id: actionIdFor(conversationId, intent.movementKind),
    type: 'adjust_inventory',
    mode: intent.mode,
    movementKind: intent.movementKind,
    entries,
    source: { kind: intent.sourceKind },
    requiresConfirmation: true,
    origin: 'kyrubia',
    risk: 'medium',
    inputProvenance: 'user_intent',
    impact: {
      entityCount: entries.length,
      reversibility: 'limited',
    },
  };
};
