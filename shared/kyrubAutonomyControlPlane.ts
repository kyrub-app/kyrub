import type { KyrubActiveActionType } from './kyrubActions';
import type {
  KyrubAutonomyDomain,
  KyrubAutonomyLevel,
} from './kyrubAutonomy';
import type { KyrubReconciliationFindingCode } from './kyrubReconciliation';

export const KYRUB_AUTONOMY_CONTROL_PLANE_SCHEMA_VERSION = 1 as const;

export type KyrubControlPlaneActionStatus = {
  actionType: KyrubActiveActionType;
  domain: KyrubAutonomyDomain;
  maximumLevel: KyrubAutonomyLevel;
  enabled: boolean;
  killed: boolean;
};

export type KyrubControlPlaneLeaseSummary = {
  leaseId: string;
  actorUid: string;
  allowedActions: KyrubActiveActionType[];
  scopeRef: string;
  expiresAt: string;
  remainingUses: number;
};

export type KyrubControlPlaneFindingSummary = {
  findingId: string;
  correlationId: string;
  code: KyrubReconciliationFindingCode;
  severity: 'info' | 'warning' | 'error';
};

export type KyrubAutonomyControlPlaneSnapshot = {
  schemaVersion: typeof KYRUB_AUTONOMY_CONTROL_PLANE_SCHEMA_VERSION;
  generatedAt: string;
  globalKillSwitch: boolean;
  domainKillSwitches: Partial<Record<KyrubAutonomyDomain, boolean>>;
  actions: KyrubControlPlaneActionStatus[];
  activeLeases: KyrubControlPlaneLeaseSummary[];
  reconciliationFindings: KyrubControlPlaneFindingSummary[];
};
