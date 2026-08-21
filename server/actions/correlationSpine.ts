import { createHash } from 'node:crypto';
import type { KyrubActionPreview } from '../../shared/kyrubActionPreviews.js';
import type { KyrubPreviewAuthorization } from '../../shared/kyrubPreviewAuthorizations.js';
import type { KyrubAutonomyLease } from '../../shared/kyrubAutonomyLeases.js';
import {
  assertKyrubCorrelationChain,
  createKyrubCorrelationLink,
  type KyrubCorrelationLink,
} from '../../shared/kyrubCorrelation.js';

const clean = (value: unknown, maximum: number): string =>
  typeof value === 'string' ? value.trim().slice(0, maximum) : '';

export const deterministicKyrubCorrelationId = (input: {
  actorUid: string;
  actionType: string;
  seed: string;
}): string => {
  const actorUid = clean(input.actorUid, 180);
  const actionType = clean(input.actionType, 100);
  const seed = clean(input.seed, 300);
  if (!actorUid || !actionType || !seed) {
    throw new Error('Correlation id requires actor, action and seed.');
  }
  return `corr_${createHash('sha256')
    .update(`${actorUid}:${actionType}:${seed}`)
    .digest('hex')
    .slice(0, 40)}`;
};

export const linksForPreviewAuthorization = (input: {
  actorUid: string;
  preview: KyrubActionPreview;
  authorization: KyrubPreviewAuthorization;
}): KyrubCorrelationLink[] => {
  const links = [
    createKyrubCorrelationLink({
      correlationId: input.preview.correlationId,
      stage: 'preview',
      referenceId: input.preview.previewId,
      actorUid: input.actorUid,
      actionType: input.preview.actionType,
      occurredAt: input.preview.createdAt,
    }),
    createKyrubCorrelationLink({
      correlationId: input.authorization.correlationId,
      stage: 'authorization',
      referenceId: input.authorization.authorizationId,
      actorUid: input.authorization.actorUid,
      actionType: input.authorization.actionType,
      occurredAt: input.authorization.authorizedAt,
    }),
  ];
  assertKyrubCorrelationChain(links);
  return links;
};

export const linkForAutonomyLease = (input: {
  lease: KyrubAutonomyLease;
  actionType: string;
  referenceId: string;
  occurredAt?: string;
}): KyrubCorrelationLink => createKyrubCorrelationLink({
  correlationId: input.lease.correlationId,
  stage: 'authorization',
  referenceId: input.referenceId,
  actorUid: input.lease.actorUid,
  actionType: input.actionType,
  occurredAt: input.occurredAt ?? input.lease.issuedAt,
});

export const appendExecutionCorrelationLinks = (input: {
  existing: KyrubCorrelationLink[];
  actorUid: string;
  correlationId: string;
  actionType: string;
  executionId: string;
  receiptId: string;
  domainEventId?: string;
  occurredAt?: string;
}): KyrubCorrelationLink[] => {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const links = [
    ...input.existing,
    createKyrubCorrelationLink({
      correlationId: input.correlationId,
      stage: 'execution',
      referenceId: input.executionId,
      actorUid: input.actorUid,
      actionType: input.actionType,
      occurredAt,
    }),
    createKyrubCorrelationLink({
      correlationId: input.correlationId,
      stage: 'receipt',
      referenceId: input.receiptId,
      actorUid: input.actorUid,
      actionType: input.actionType,
      occurredAt,
    }),
    ...(input.domainEventId ? [createKyrubCorrelationLink({
      correlationId: input.correlationId,
      stage: 'domain_event',
      referenceId: input.domainEventId,
      actorUid: input.actorUid,
      actionType: input.actionType,
      occurredAt,
    })] : []),
  ];
  assertKyrubCorrelationChain(links);
  return links;
};
