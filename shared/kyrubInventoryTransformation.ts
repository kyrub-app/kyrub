export type KyrubInventoryTransformationUnit = 'un' | 'kg' | 'g' | 'l' | 'ml';

export type KyrubInventoryTransformationOutputKind =
  | 'intermediate'
  | 'finished'
  | 'byproduct';

export type KyrubInventoryTransformationSourceKind =
  | 'production_batch'
  | 'processing'
  | 'repack'
  | 'manual_transformation';

export type KyrubInventoryTransformationInput = {
  name: string;
  quantity: number;
  unit: KyrubInventoryTransformationUnit;
};

export type KyrubInventoryTransformationOutput = {
  name: string;
  quantity: number;
  unit: KyrubInventoryTransformationUnit;
  kind: KyrubInventoryTransformationOutputKind;
};

/**
 * Losses are audit metadata for material already consumed by `inputs`.
 * They never decrement stock a second time. Reusable material must be modeled
 * as an output with kind `byproduct` instead of a loss.
 */
export type KyrubInventoryTransformationLoss = {
  name: string;
  quantity: number;
  unit: KyrubInventoryTransformationUnit;
  reason?: string;
};

export type KyrubInventoryTransformationProposal = {
  id: string;
  type: 'transform_inventory';
  inputs: KyrubInventoryTransformationInput[];
  outputs: KyrubInventoryTransformationOutput[];
  losses: KyrubInventoryTransformationLoss[];
  source: {
    kind: KyrubInventoryTransformationSourceKind;
    label?: string;
  };
  requiresConfirmation: true;
  origin?: 'kyrubia' | 'chatgpt' | 'manual' | 'automation';
  risk?: 'medium';
  inputProvenance?:
    | 'user_intent'
    | 'quoted_content'
    | 'document_content'
    | 'tool_output'
    | 'ai_generated_content';
  idempotencyKey?: string;
  impact?: {
    entityCount: number;
    reversibility: 'limited';
  };
};

export const KYRUB_INVENTORY_TRANSFORMATION_LIMITS = {
  maxInputs: 40,
  maxOutputs: 40,
  maxLosses: 40,
  maxNameCharacters: 180,
  maxLabelCharacters: 180,
  maxReasonCharacters: 240,
} as const;

const clean = (value: unknown, maximum: number): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

export const isKyrubInventoryTransformationUnit = (
  value: unknown
): value is KyrubInventoryTransformationUnit =>
  value === 'un' || value === 'kg' || value === 'g' || value === 'l' || value === 'ml';

export const normalizeKyrubInventoryTransformationName = (
  value: string
): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const positiveQuantity = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;

const normalizeInput = (
  value: unknown
): KyrubInventoryTransformationInput | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const name = clean(candidate.name, KYRUB_INVENTORY_TRANSFORMATION_LIMITS.maxNameCharacters);
  const quantity = positiveQuantity(candidate.quantity);
  const unit = candidate.unit;
  return name && quantity && isKyrubInventoryTransformationUnit(unit)
    ? { name, quantity, unit }
    : null;
};

const normalizeOutput = (
  value: unknown
): KyrubInventoryTransformationOutput | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const base = normalizeInput(candidate);
  const kind = candidate.kind;
  return base && (kind === 'intermediate' || kind === 'finished' || kind === 'byproduct')
    ? { ...base, kind }
    : null;
};

const normalizeLoss = (
  value: unknown
): KyrubInventoryTransformationLoss | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const base = normalizeInput(candidate);
  if (!base) return null;
  const reason = clean(candidate.reason, KYRUB_INVENTORY_TRANSFORMATION_LIMITS.maxReasonCharacters);
  return { ...base, ...(reason ? { reason } : {}) };
};

type UnitFamily = 'count' | 'mass' | 'volume';

const baseQuantity = (
  quantity: number,
  unit: KyrubInventoryTransformationUnit
): { family: UnitFamily; quantity: number } => {
  if (unit === 'un') return { family: 'count', quantity };
  if (unit === 'kg') return { family: 'mass', quantity: quantity * 1000 };
  if (unit === 'g') return { family: 'mass', quantity };
  if (unit === 'l') return { family: 'volume', quantity: quantity * 1000 };
  return { family: 'volume', quantity };
};

const lossesFitConsumedMaterial = (
  inputs: KyrubInventoryTransformationInput[],
  losses: KyrubInventoryTransformationLoss[]
): boolean => {
  const consumed = new Map<UnitFamily, number>();
  const lost = new Map<UnitFamily, number>();

  for (const input of inputs) {
    const base = baseQuantity(input.quantity, input.unit);
    consumed.set(base.family, (consumed.get(base.family) ?? 0) + base.quantity);
  }
  for (const loss of losses) {
    const base = baseQuantity(loss.quantity, loss.unit);
    lost.set(base.family, (lost.get(base.family) ?? 0) + base.quantity);
  }

  for (const [family, quantity] of lost) {
    if (quantity > (consumed.get(family) ?? 0) + Number.EPSILON) return false;
  }
  return true;
};

export const normalizeKyrubInventoryTransformationProposal = (
  value: unknown
): KyrubInventoryTransformationProposal | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.type !== 'transform_inventory' || candidate.requiresConfirmation !== true) {
    return null;
  }

  const id = clean(candidate.id, 120);
  if (!id) return null;

  const inputs = Array.isArray(candidate.inputs)
    ? candidate.inputs
        .slice(0, KYRUB_INVENTORY_TRANSFORMATION_LIMITS.maxInputs)
        .map(normalizeInput)
    : [];
  const outputs = Array.isArray(candidate.outputs)
    ? candidate.outputs
        .slice(0, KYRUB_INVENTORY_TRANSFORMATION_LIMITS.maxOutputs)
        .map(normalizeOutput)
    : [];
  const losses = Array.isArray(candidate.losses)
    ? candidate.losses
        .slice(0, KYRUB_INVENTORY_TRANSFORMATION_LIMITS.maxLosses)
        .map(normalizeLoss)
    : [];

  if (
    inputs.length === 0 || outputs.length === 0 ||
    inputs.some(item => item === null) ||
    outputs.some(item => item === null) ||
    losses.some(item => item === null)
  ) return null;

  const normalizedInputs = inputs as KyrubInventoryTransformationInput[];
  const normalizedOutputs = outputs as KyrubInventoryTransformationOutput[];
  const normalizedLosses = losses as KyrubInventoryTransformationLoss[];
  if (!lossesFitConsumedMaterial(normalizedInputs, normalizedLosses)) return null;

  const sourceValue = candidate.source && typeof candidate.source === 'object' && !Array.isArray(candidate.source)
    ? candidate.source as Record<string, unknown>
    : {};
  const sourceKind = sourceValue.kind;
  if (
    sourceKind !== 'production_batch' &&
    sourceKind !== 'processing' &&
    sourceKind !== 'repack' &&
    sourceKind !== 'manual_transformation'
  ) return null;
  const label = clean(sourceValue.label, KYRUB_INVENTORY_TRANSFORMATION_LIMITS.maxLabelCharacters);

  return {
    id,
    type: 'transform_inventory',
    inputs: normalizedInputs,
    outputs: normalizedOutputs,
    losses: normalizedLosses,
    source: { kind: sourceKind, ...(label ? { label } : {}) },
    requiresConfirmation: true,
    origin: 'kyrubia',
    risk: 'medium',
    inputProvenance: 'user_intent',
    impact: {
      entityCount: inputs.length + outputs.length + losses.length,
      reversibility: 'limited',
    },
  };
};
