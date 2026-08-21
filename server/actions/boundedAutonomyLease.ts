import { createHash } from 'node:crypto';
import type { KyrubActiveActionType } from '../../shared/kyrubActions.js';
import {
  KYRUB_AUTONOMY_REGISTRY,
  evaluateKyrubAutonomy,
  type KyrubAutonomyRuntimeControls,
} from '../../shared/kyrubAutonomy.js';
import {
  KYRUB_AUTONOMY_LEASE_SCHEMA_VERSION,
  type KyrubAutonomyLease,
} from '../../shared/kyrubAutonomyLeases.js';

const MAX_LEASE_MS = 24 * 60 * 60 * 1_000;
const MAX_LEASE_USES = 25;

const clean = (value: unknown, maximum: number): string =>
  typeof value === 'string' ? value.trim().slice(0, maximum) : '';

export const buildKyrubAutonomyLease = (input: {
  actorUid: string;
  correlationId: string;
  allowedActions: KyrubActiveActionType[];
  scopeRef?: string;
  durationMs: number;
  maxUses: number;
  controls?: KyrubAutonomyRuntimeControls;
  now?: Date;
}): KyrubAutonomyLease => {
  const actorUid = clean(input.actorUid, 180);
  const correlationId = clean(input.correlationId, 160);
  const scopeRef = clean(input.scopeRef, 300);
  if (!actorUid || !correlationId) {
    throw new Error('Autonomy lease requires actorUid and correlationId.');
  }
  if (
    !Number.isInteger(input.durationMs) ||
    input.durationMs <= 0 ||
    input.durationMs > MAX_LEASE_MS
  ) {
    throw new Error('AUTONOMY_LEASE_DURATION_EXCEEDED');
  }
  if (
    !Number.isInteger(input.maxUses) ||
    input.maxUses < 1 ||
    input.maxUses > MAX_LEASE_USES
  ) {
    throw new Error('AUTONOMY_LEASE_USE_LIMIT_EXCEEDED');
  }

  const allowedActions = [...new Set(input.allowedActions)];
  if (allowedActions.length === 0) {
    throw new Error('AUTONOMY_LEASE_REQUIRES_ACTIONS');
  }

  for (const actionType of allowedActions) {
    if (KYRUB_AUTONOMY_REGISTRY[actionType].maximumLevel < 4) {
      throw new Error(`AUTONOMY_LEVEL_NOT_ALLOWED:${actionType}`);
    }
    const decision = evaluateKyrubAutonomy(actionType, 4, input.controls);
    if (!decision.allowed) {
      throw new Error(`AUTONOMY_BLOCKED:${actionType}:${decision.reasons.join(',')}`);
    }
  }

  const now = input.now ?? new Date();
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + input.durationMs).toISOString();
  const leaseId = `lease_${createHash('sha256')
    .update(`${actorUid}:${correlationId}:${allowedActions.join(',')}:${scopeRef}:${issuedAt}`)
    .digest('hex')
    .slice(0, 40)}`;

  return {
    schemaVersion: KYRUB_AUTONOMY_LEASE_SCHEMA_VERSION,
    leaseId,
    actorUid,
    correlationId,
    allowedActions,
    scopeRef,
    issuedAt,
    expiresAt,
    maxUses: input.maxUses,
    remainingUses: input.maxUses,
    authorizationMode: 'human_configuration',
    autonomyLevel: 4,
  };
};

export const assertKyrubAutonomyLeaseUse = (input: {
  lease: KyrubAutonomyLease;
  actorUid: string;
  actionType: KyrubActiveActionType;
  scopeRef?: string;
  controls?: KyrubAutonomyRuntimeControls;
  now?: Date;
}): void => {
  const now = input.now ?? new Date();
  if (input.lease.actorUid !== input.actorUid) {
    throw new Error('AUTONOMY_LEASE_ACTOR_MISMATCH');
  }
  if (Date.parse(input.lease.expiresAt) <= now.getTime()) {
    throw new Error('AUTONOMY_LEASE_EXPIRED');
  }
  if (input.lease.remainingUses < 1) {
    throw new Error('AUTONOMY_LEASE_EXHAUSTED');
  }
  if (!input.lease.allowedActions.includes(input.actionType)) {
    throw new Error('AUTONOMY_ACTION_NOT_GRANTED');
  }
  if (
    input.lease.scopeRef &&
    clean(input.scopeRef, 300) !== input.lease.scopeRef
  ) {
    throw new Error('AUTONOMY_SCOPE_MISMATCH');
  }

  const decision = evaluateKyrubAutonomy(input.actionType, 4, input.controls);
  if (!decision.allowed) {
    throw new Error(`AUTONOMY_BLOCKED:${decision.reasons.join(',')}`);
  }
};

export const consumeKyrubAutonomyLease = (
  lease: KyrubAutonomyLease
): KyrubAutonomyLease => {
  if (lease.remainingUses < 1) throw new Error('AUTONOMY_LEASE_EXHAUSTED');
  return { ...lease, remainingUses: lease.remainingUses - 1 };
};
