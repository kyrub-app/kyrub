import type {
  KyrubAiAdjustInventoryProposal,
  KyrubInventoryAdjustmentEntry,
  KyrubInventoryUnit,
} from './kyrubActions';
import {
  normalizeKyrubInventoryTransformationProposal,
  type KyrubInventoryTransformationProposal,
} from './kyrubInventoryTransformation.js';

export type KyrubInventorySetupRecipeLine = {
  name: string;
  quantity: number;
  unit: KyrubInventoryUnit;
};

export type KyrubInventorySetupWorkflow = {
  version: 1;
  id: string;
  type: 'inventory_setup_workflow';
  targetProductName: string;
  componentName: string;
  transformation: KyrubInventoryTransformationProposal;
  recipeLines: KyrubInventorySetupRecipeLine[];
  compositionMessage: string;
  preview: {
    receivedSourceQuantity: number;
    receivedSourceUnit: KyrubInventoryUnit;
    allocatedSourceQuantity: number;
    consumedSourceQuantity: number;
    allocatedRemainderQuantity: number;
    producedComponentQuantity: number;
    componentUnit: 'un';
  };
};

export type KyrubInventorySetupCarrier = KyrubAiAdjustInventoryProposal & {
  setupWorkflow?: KyrubInventorySetupWorkflow;
};

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

const cleanName = (value: string): string =>
  value
    .replace(/^\s*(?:de|do|da|dos|das)\s+/i, '')
    .replace(/[.,;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);

const numberFrom = (value: string): number | null => {
  const compact = value.replace(/\s+/g, '').trim();
  if (!compact) return null;
  const normalized = compact.includes(',') && compact.includes('.')
    ? compact.replace(/\./g, '').replace(',', '.')
    : compact.replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const round = (value: number): number =>
  Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const unitFrom = (value: string): KyrubInventoryUnit | null => {
  const unit = normalize(value).replace(/\./g, '');
  if (['un', 'und', 'unid', 'unidade', 'unidades'].includes(unit)) return 'un';
  if (unit === 'kg') return 'kg';
  if (unit === 'g') return 'g';
  if (unit === 'l') return 'l';
  if (unit === 'ml') return 'ml';
  return null;
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

const matchUniqueEntry = (
  label: string,
  entries: KyrubInventoryAdjustmentEntry[]
): KyrubInventoryAdjustmentEntry | null => {
  const target = normalize(label);
  const matches = entries.filter(entry => {
    const name = normalize(entry.name);
    return name === target || name.includes(target) || target.includes(name);
  });
  return matches.length === 1 ? matches[0] : null;
};

const singularizeCountName = (value: string): string => {
  const name = cleanName(value);
  const normalized = normalize(name);
  if (normalized === 'paes') return 'Pão';
  if (normalized === 'hamburgueres') return 'Hambúrguer';
  if (/ões$/i.test(name)) return name.replace(/ões$/i, 'ão');
  if (/aes$/i.test(normalized)) return name;
  if (/s$/i.test(name) && name.length > 3) return name.slice(0, -1);
  return name;
};

const parseRecipeLines = (
  message: string,
  componentName: string,
  targetProductName: string
): KyrubInventorySetupRecipeLine[] | null => {
  const escapedTarget = targetProductName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const recipeMatch = message.match(
    new RegExp(`ficha\\s+t[eé]cnica\\s+(?:do|da|de)\\s+${escapedTarget}\\s+com\\s+(.+)$`, 'i')
  );
  if (!recipeMatch?.[1]) return null;

  const recipeText = recipeMatch[1]
    .replace(/[”"']+$/g, '')
    .replace(/[.!?]+$/g, '')
    .trim();
  if (!recipeText) return null;

  const terms = recipeText
    .split(/\s*,\s*|\s+e\s+(?=\d)/i)
    .map(term => term.trim())
    .filter(Boolean);

  const lines: KyrubInventorySetupRecipeLine[] = [];
  for (const term of terms) {
    const explicit = term.match(
      /^(\d[\d.,]*)\s*(un(?:d|id)?|unidade(?:s)?|kg|g|l|ml)\s+(?:de\s+)?(.+)$/i
    );
    if (explicit) {
      const quantity = numberFrom(explicit[1]);
      const unit = unitFrom(explicit[2]);
      const name = cleanName(explicit[3]);
      if (!quantity || !unit || !name) return null;
      lines.push({ name, quantity, unit });
      continue;
    }

    const count = term.match(/^(\d[\d.,]*)\s+(.+)$/i);
    if (!count) return null;
    const quantity = numberFrom(count[1]);
    let name = cleanName(count[2]);
    if (!quantity || !name) return null;

    if (/hamb[uú]rguer/i.test(name) && /\b\d[\d.,]*\s*(?:kg|g)\b/i.test(name)) {
      name = componentName;
    } else {
      name = singularizeCountName(name);
    }
    lines.push({ name, quantity, unit: 'un' });
  }

  return lines.length >= 2 ? lines : null;
};

export const isKyrubInventorySetupWorkflowIntent = (message: string): boolean => {
  const text = normalize(message);
  return (
    /\b(recebi|entrada de estoque|dar entrada|de entrada)\b/.test(text) &&
    /\b(separe|separar|destine|destinar)\b/.test(text) &&
    /\b(cada hamburguer|cada disco)\b/.test(text) &&
    /\b(ficha tecnica)\b/.test(text)
  );
};

export const buildKyrubInventorySetupWorkflow = (
  message: string,
  conversationId: string,
  intake: KyrubAiAdjustInventoryProposal
): KyrubInventorySetupWorkflow | null => {
  if (!isKyrubInventorySetupWorkflowIntent(message)) return null;
  if (intake.mode !== 'increment' || intake.entries.length === 0) return null;

  const allocation = message.match(
    /(?:separe|separar|destine|destinar)\s+(metade|\d[\d.,]*\s*%|\d[\d.,]*)\s+(?:da|do|de)\s+([^,.]+?)(?=\s+(?:pra|para)\b|[,.;]|$)/i
  );
  if (!allocation?.[1] || !allocation[2]) return null;

  const sourceLabel = cleanName(allocation[2]);
  const source = matchUniqueEntry(sourceLabel, intake.entries);
  if (!source) return null;

  let fraction: number | null = null;
  const allocationValue = normalize(allocation[1]);
  if (allocationValue === 'metade') {
    fraction = 0.5;
  } else if (allocationValue.endsWith('%')) {
    const percent = numberFrom(allocationValue.slice(0, -1));
    fraction = percent ? percent / 100 : null;
  } else {
    const parsed = numberFrom(allocationValue);
    fraction = parsed && parsed <= 1 ? parsed : null;
  }
  if (!fraction || fraction <= 0 || fraction > 1) return null;

  const portion = message.match(
    /cada\s+(hamb[uú]rguer|disco)(?:\s+[^,.]*?)?\s+(?:[eé]\s+feito\s+com|leva|usa|consome)\s+(\d[\d.,]*)\s*(kg|g)\s+(?:dessa|desse|da|do|de)\s+([^,.]+)/i
  );
  if (!portion?.[1] || !portion[2] || !portion[3] || !portion[4]) return null;
  if (!normalize(source.name).includes(normalize(cleanName(portion[4])))) return null;

  const portionQuantity = numberFrom(portion[2]);
  const portionUnit = unitFrom(portion[3]);
  if (!portionQuantity || !portionUnit) return null;
  const portionInSourceUnit = convertQuantity(portionQuantity, portionUnit, source.unit);
  if (!portionInSourceUnit || portionInSourceUnit <= 0) return null;

  const allocated = round(source.quantity * fraction);
  const produced = Math.floor((allocated + 0.0000001) / portionInSourceUnit);
  if (produced <= 0) return null;
  const consumed = round(produced * portionInSourceUnit);
  const remainder = round(Math.max(0, allocated - consumed));

  const componentBase = /disco/i.test(portion[1]) ? 'Disco de hambúrguer' : 'Hambúrguer';
  const componentName = `${componentBase} ${portionQuantity.toLocaleString('pt-BR', {
    maximumFractionDigits: 3,
  })} ${portionUnit}`;

  const target = message.match(/ficha\s+t[eé]cnica\s+(?:do|da|de)\s+(.+?)\s+com\s+/i);
  const targetProductName = cleanName(target?.[1] ?? '');
  if (!targetProductName) return null;

  const recipeLines = parseRecipeLines(message, componentName, targetProductName);
  if (!recipeLines) return null;
  const componentLines = recipeLines.filter(line => normalize(line.name) === normalize(componentName));
  if (componentLines.length !== 1 || componentLines[0].unit !== 'un') return null;

  const transformation = normalizeKyrubInventoryTransformationProposal({
    id: `inventory-setup-transform-${stableHash(`${conversationId}:${message}`)}`,
    type: 'transform_inventory',
    inputs: [{ name: source.name, quantity: consumed, unit: source.unit }],
    outputs: [{
      name: componentName,
      quantity: produced,
      unit: 'un',
      kind: 'intermediate',
    }],
    losses: [],
    source: {
      kind: 'processing',
      label: `Produção de ${componentName}`,
    },
    requiresConfirmation: true,
  });
  if (!transformation) return null;

  const workflowId = `inventory-setup-${stableHash(`${conversationId}:${message}`)}`;
  const compositionMessage = [
    `Crie a ficha técnica do ${targetProductName}`,
    ...recipeLines.map(line => `${line.quantity.toLocaleString('pt-BR', {
      maximumFractionDigits: 3,
    })} ${line.unit} ${line.name}`),
  ].join('\n');

  return {
    version: 1,
    id: workflowId,
    type: 'inventory_setup_workflow',
    targetProductName,
    componentName,
    transformation: {
      ...transformation,
      id: `${workflowId}-transform`,
      idempotencyKey: `kyrubia:transform_inventory:${workflowId}`,
    },
    recipeLines,
    compositionMessage,
    preview: {
      receivedSourceQuantity: source.quantity,
      receivedSourceUnit: source.unit,
      allocatedSourceQuantity: allocated,
      consumedSourceQuantity: consumed,
      allocatedRemainderQuantity: remainder,
      producedComponentQuantity: produced,
      componentUnit: 'un',
    },
  };
};

export const readKyrubInventorySetupWorkflow = (
  proposal: KyrubAiAdjustInventoryProposal
): KyrubInventorySetupWorkflow | null => {
  const candidate = (proposal as KyrubInventorySetupCarrier).setupWorkflow;
  if (!candidate || candidate.version !== 1 || candidate.type !== 'inventory_setup_workflow') {
    return null;
  }
  if (!candidate.id || !candidate.targetProductName || !candidate.componentName) return null;
  if (!candidate.compositionMessage || candidate.recipeLines.length === 0) return null;
  const transformation = normalizeKyrubInventoryTransformationProposal(candidate.transformation);
  if (!transformation) return null;
  return { ...candidate, transformation };
};
