import { createHash } from 'node:crypto';
import type { KyrubActionPreview } from '../../shared/kyrubActionPreviews.js';
import {
  evaluateKyrubAutonomy,
  type KyrubAutonomyRuntimeControls,
} from '../../shared/kyrubAutonomy.js';
import {
  KYRUB_PREVIEW_AUTHORIZATION_SCHEMA_VERSION,
  type KyrubPreviewAuthorization,
} from '../../shared/kyrubPreviewAuthorizations.js';
import { assertKyrubExpectedState } from './conflictEnvelope.js';

const AUTHORIZATION_TTL_MS = 2 * 60 * 1_000;

const clean = (value: unknown, maximum: number): string =>
  typeof value === 'string' ? value.trim().slice(0, maximum) : '';

const stableJson = (value: unknown): string => JSON.stringify(value, (_key, fieldValue) => {
  if (!fieldValue || typeof fieldValue !== 'object' || Array.isArray(fieldValue)) {
    return fieldValue;
  }
  return Object.fromEntries(
    Object.entries(fieldValue as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
  );
});

const hash = (value: unknown): string => createHash('sha256')
  .update(stableJson(value))
  .digest('hex');

export const hashKyrubExpectedState = (
  value: Record<string, string | number | boolean | null>
): string => hash(value);

export const buildKyrubPreviewAuthorization = (input: {
  preview: KyrubActionPreview;
  actorUid: string;
  confirmedPreviewId: string;
  confirmedProposalHash: string;
  controls?: KyrubAutonomyRuntimeControls;
  now?: Date;
}): KyrubPreviewAuthorization => {
  const actorUid = clean(input.actorUid, 180);
  if (!actorUid) throw new Error('Preview authorization requires actorUid.');

  const now = input.now ?? new Date();
  if (Date.parse(input.preview.expiresAt) <= now.getTime()) {
    throw new Error('PREVIEW_EXPIRED');
  }
  if (
    input.confirmedPreviewId !== input.preview.previewId ||
    input.confirmedProposalHash !== input.preview.proposalHash
  ) {
    throw new Error('PREVIEW_CONFIRMATION_MISMATCH');
  }

  const autonomyDecision = evaluateKyrubAutonomy(
    input.preview.actionType,
    3,
    input.controls
  );
  if (!autonomyDecision.allowed) {
    throw new Error(
      `AUTHORIZATION_BLOCKED:${autonomyDecision.reasons.join(',')}`
    );
  }

  const authorizedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + AUTHORIZATION_TTL_MS).toISOString();
  const authorizationId = `auth_${createHash('sha256')
    .update(`${actorUid}:${input.preview.previewId}:${input.preview.proposalHash}:${authorizedAt}`)
    .digest('hex')
    .slice(0, 40)}`;

  return {
    schemaVersion: KYRUB_PREVIEW_AUTHORIZATION_SCHEMA_VERSION,
    authorizationId,
    previewId: input.preview.previewId,
    proposalHash: input.preview.proposalHash,
    expectedStateHash: hashKyrubExpectedState(input.preview.expectedState),
    actorUid,
    correlationId: input.preview.correlationId,
    actionType: input.preview.actionType,
    authorizationMode: 'human_confirmation',
    authorizedAt,
    expiresAt,
    singleUse: true,
  };
};

export const assertKyrubPreviewAuthorization = (input: {
  authorization: KyrubPreviewAuthorization;
  preview: KyrubActionPreview;
  actorUid: string;
  observedState?: Record<string, unknown> | null;
  now?: Date;
}): void => {
  const now = input.now ?? new Date();
  if (Date.parse(input.authorization.expiresAt) <= now.getTime()) {
    throw new Error('AUTHORIZATION_EXPIRED');
  }
  if (
    input.authorization.actorUid !== input.actorUid ||
    input.authorization.previewId !== input.preview.previewId ||
    input.authorization.proposalHash !== input.preview.proposalHash ||
    input.authorization.correlationId !== input.preview.correlationId ||
    input.authorization.actionType !== input.preview.actionType ||
    input.authorization.expectedStateHash !== hashKyrubExpectedState(input.preview.expectedState)
  ) {
    throw new Error('AUTHORIZATION_PREVIEW_MISMATCH');
  }

  if (input.preview.target && Object.keys(input.preview.expectedState).length > 0) {
    assertKyrubExpectedState({
      target: {
        entityType: input.preview.target.entityType,
        entityId: input.preview.target.entityId,
      },
      expected: input.preview.expectedState,
      observed: input.observedState ?? null,
      detectedAt: now,
    });
  }
};
