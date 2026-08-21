import { createHash } from 'node:crypto';
import {
  KYRUB_ACTION_REGISTRY,
  type KyrubActionProposal,
} from '../../shared/kyrubActions.js';
import {
  evaluateKyrubAutonomy,
  type KyrubAutonomyRuntimeControls,
} from '../../shared/kyrubAutonomy.js';
import {
  KYRUB_ACTION_PREVIEW_SCHEMA_VERSION,
  type KyrubActionPreview,
  type KyrubActionPreviewTarget,
} from '../../shared/kyrubActionPreviews.js';

const PREVIEW_TTL_MS = 5 * 60 * 1_000;

const clean = (value: unknown, maximum: number): string =>
  typeof value === 'string' ? value.trim().slice(0, maximum) : '';

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, fieldValue]) => [key, stableValue(fieldValue)])
    );
  }
  return value;
};

export const hashKyrubActionPreviewProposal = (
  proposal: KyrubActionProposal
): string => createHash('sha256')
  .update(JSON.stringify(stableValue(proposal)))
  .digest('hex');

const normalizedExpectedState = (
  value: Record<string, unknown> | undefined
): Record<string, string | number | boolean | null> => Object.fromEntries(
  Object.entries(value ?? {})
    .filter(([, fieldValue]) =>
      fieldValue === null ||
      typeof fieldValue === 'string' ||
      typeof fieldValue === 'number' ||
      typeof fieldValue === 'boolean'
    )
    .slice(0, 24)
    .sort(([left], [right]) => left.localeCompare(right))
) as Record<string, string | number | boolean | null>;

export const buildKyrubActionPreview = (input: {
  proposal: KyrubActionProposal;
  correlationId: string;
  title: string;
  summary: string;
  target?: KyrubActionPreviewTarget | null;
  expectedState?: Record<string, unknown>;
  evidenceRefs?: string[];
  controls?: KyrubAutonomyRuntimeControls;
  now?: Date;
}): KyrubActionPreview => {
  const correlationId = clean(input.correlationId, 160);
  const title = clean(input.title, 160);
  const summary = clean(input.summary, 1_200);
  if (!correlationId || !title || !summary) {
    throw new Error('Action preview requires correlationId, title and summary.');
  }

  const definition = KYRUB_ACTION_REGISTRY[input.proposal.type];
  if (!definition || definition.mode !== 'write') {
    throw new Error('Action preview only supports registered write actions.');
  }

  const autonomyDecision = evaluateKyrubAutonomy(
    input.proposal.type,
    2,
    input.controls
  );
  if (!autonomyDecision.allowed) {
    throw new Error(
      `Action preview blocked by autonomy controls: ${autonomyDecision.reasons.join(',')}`
    );
  }

  const proposalHash = hashKyrubActionPreviewProposal(input.proposal);
  const now = input.now ?? new Date();
  const previewId = `preview_${createHash('sha256')
    .update(`${correlationId}:${input.proposal.id}:${proposalHash}`)
    .digest('hex')
    .slice(0, 40)}`;

  return {
    schemaVersion: KYRUB_ACTION_PREVIEW_SCHEMA_VERSION,
    previewId,
    correlationId,
    actionType: input.proposal.type,
    title,
    summary,
    risk: definition.risk,
    impact: input.proposal.impact ?? {
      entityCount: 1,
      reversibility: 'easy',
    },
    proposalHash,
    target: input.target ?? null,
    expectedState: normalizedExpectedState(input.expectedState),
    evidenceRefs: [...new Set((input.evidenceRefs ?? [])
      .map(item => clean(item, 300))
      .filter(Boolean))].slice(0, 16),
    autonomyDecision,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PREVIEW_TTL_MS).toISOString(),
    requiresConfirmation:
      definition.requiresConfirmation || input.proposal.requiresConfirmation === true,
    executionAllowed: false,
  };
};
