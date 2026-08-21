import { createHash } from 'node:crypto';
import type { KyrubActiveActionType } from './kyrubActions';
import {
  evaluateKyrubAutonomy,
  type KyrubAutonomyRuntimeControls,
} from './kyrubAutonomy';

export type KyrubOpportunityDomain =
  | 'inventory'
  | 'sales'
  | 'operations'
  | 'financial'
  | 'customer'
  | 'work';

export type KyrubOpportunitySignalKind = 'authoritative_fact' | 'calculation' | 'inference';
export type KyrubOpportunityPriority = 'low' | 'medium' | 'high' | 'critical';

export interface KyrubOpportunitySignal {
  id: string;
  domain: KyrubOpportunityDomain;
  kind: KyrubOpportunitySignalKind;
  summary: string;
  observedAt: string;
  confidence: number;
  evidenceRefs: string[];
}

export interface KyrubOpportunityCandidate {
  opportunityId: string;
  domain: KyrubOpportunityDomain;
  title: string;
  explanation: string;
  priority: KyrubOpportunityPriority;
  score: number;
  signalIds: string[];
  evidenceRefs: string[];
  suggestedAction?: {
    actionType: KyrubActiveActionType;
    autonomyLevel: 2;
    proposalAllowed: boolean;
    blockedReasons: string[];
  };
}

const priorityFromScore = (score: number): KyrubOpportunityPriority =>
  score >= 90 ? 'critical' : score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low';

const boundedConfidence = (value: number): number =>
  Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

const scoreSignal = (signal: KyrubOpportunitySignal): number => {
  const authorityWeight = signal.kind === 'authoritative_fact'
    ? 1
    : signal.kind === 'calculation' ? 0.85 : 0.55;
  return Math.round(100 * boundedConfidence(signal.confidence) * authorityWeight);
};

const opportunityId = (signal: KyrubOpportunitySignal, title: string): string =>
  createHash('sha256')
    .update(`${signal.domain}:${signal.id}:${title}`)
    .digest('hex')
    .slice(0, 24);

export const buildKyrubOpportunity = (input: {
  signal: KyrubOpportunitySignal;
  title: string;
  explanation: string;
  suggestedAction?: KyrubActiveActionType;
  controls?: KyrubAutonomyRuntimeControls;
}): KyrubOpportunityCandidate => {
  const { signal, title, explanation, suggestedAction, controls } = input;
  if (!signal.id.trim() || !signal.summary.trim()) {
    throw new Error('Oportunidade sem sinal explicável.');
  }
  if (!signal.observedAt.trim() || !Number.isFinite(Date.parse(signal.observedAt))) {
    throw new Error('Oportunidade sem timestamp observável.');
  }

  const score = scoreSignal(signal);
  const autonomy = suggestedAction
    ? evaluateKyrubAutonomy(suggestedAction, 2, controls)
    : null;

  return {
    opportunityId: opportunityId(signal, title),
    domain: signal.domain,
    title: title.trim(),
    explanation: explanation.trim(),
    priority: priorityFromScore(score),
    score,
    signalIds: [signal.id],
    evidenceRefs: [...new Set(signal.evidenceRefs.map(value => value.trim()).filter(Boolean))].sort(),
    ...(autonomy && suggestedAction
      ? {
          suggestedAction: {
            actionType: suggestedAction,
            autonomyLevel: 2 as const,
            proposalAllowed: autonomy.allowed,
            blockedReasons: autonomy.reasons,
          },
        }
      : {}),
  };
};

export const rankKyrubOpportunities = (
  opportunities: KyrubOpportunityCandidate[]
): KyrubOpportunityCandidate[] =>
  [...opportunities].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.opportunityId.localeCompare(right.opportunityId);
  });

export const lowStockOpportunity = (input: {
  inventoryItemId: string;
  inventoryItemName: string;
  availableQuantity: number;
  minimumQuantity: number;
  unit: string;
  observedAt: string;
  controls?: KyrubAutonomyRuntimeControls;
}): KyrubOpportunityCandidate | null => {
  const available = Math.max(0, input.availableQuantity);
  const minimum = Math.max(0, input.minimumQuantity);
  if (minimum <= 0 || available > minimum) return null;

  const ratio = minimum === 0 ? 1 : Math.min(1, available / minimum);
  const confidence = 1;
  const signal: KyrubOpportunitySignal = {
    id: `inventory-low:${input.inventoryItemId}`,
    domain: 'inventory',
    kind: 'authoritative_fact',
    summary: `${input.inventoryItemName} está em ${available} ${input.unit}; mínimo ${minimum} ${input.unit}.`,
    observedAt: input.observedAt,
    confidence,
    evidenceRefs: [`inventory:${input.inventoryItemId}`],
  };

  const candidate = buildKyrubOpportunity({
    signal,
    title: `Repor ${input.inventoryItemName}`,
    explanation: signal.summary,
    suggestedAction: 'create_task',
    controls: input.controls,
  });

  const urgencyBoost = Math.round((1 - ratio) * 25);
  const score = Math.min(100, candidate.score + urgencyBoost);
  return { ...candidate, score, priority: priorityFromScore(score) };
};

export const demandShortageOpportunity = (input: {
  inventoryItemId: string;
  inventoryItemName: string;
  shortageQuantity: number;
  unit: string;
  productIds: string[];
  observedAt: string;
  controls?: KyrubAutonomyRuntimeControls;
}): KyrubOpportunityCandidate | null => {
  if (!Number.isFinite(input.shortageQuantity) || input.shortageQuantity <= 0) return null;
  const signal: KyrubOpportunitySignal = {
    id: `inventory-shortage:${input.inventoryItemId}:${input.productIds.slice().sort().join(',')}`,
    domain: 'inventory',
    kind: 'calculation',
    summary: `Faltam ${input.shortageQuantity} ${input.unit} de ${input.inventoryItemName} para atender a demanda calculada.`,
    observedAt: input.observedAt,
    confidence: 1,
    evidenceRefs: [
      `inventory:${input.inventoryItemId}`,
      ...input.productIds.map(productId => `composition:${productId}`),
    ],
  };
  return buildKyrubOpportunity({
    signal,
    title: `Evitar ruptura de ${input.inventoryItemName}`,
    explanation: `${signal.summary} A demanda foi calculada a partir das fichas técnicas informadas.`,
    suggestedAction: 'create_task',
    controls: input.controls,
  });
};