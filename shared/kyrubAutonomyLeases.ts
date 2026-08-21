import type { KyrubActiveActionType } from './kyrubActions';

export const KYRUB_AUTONOMY_LEASE_SCHEMA_VERSION = 1 as const;

export type KyrubAutonomyLease = {
  schemaVersion: typeof KYRUB_AUTONOMY_LEASE_SCHEMA_VERSION;
  leaseId: string;
  actorUid: string;
  correlationId: string;
  allowedActions: KyrubActiveActionType[];
  scopeRef: string;
  issuedAt: string;
  expiresAt: string;
  maxUses: number;
  remainingUses: number;
  authorizationMode: 'human_configuration';
  autonomyLevel: 4;
};
