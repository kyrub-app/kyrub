import type {
  KyrubActionImpact,
  KyrubActionRisk,
  KyrubActiveActionType,
} from './kyrubActions';
import type { KyrubAutonomyDecision } from './kyrubAutonomy';

export const KYRUB_ACTION_PREVIEW_SCHEMA_VERSION = 1 as const;

export type KyrubActionPreviewTarget = {
  entityType: string;
  entityId: string;
  label: string;
};

export type KyrubActionPreview = {
  schemaVersion: typeof KYRUB_ACTION_PREVIEW_SCHEMA_VERSION;
  previewId: string;
  correlationId: string;
  actionType: KyrubActiveActionType;
  title: string;
  summary: string;
  risk: KyrubActionRisk;
  impact: KyrubActionImpact;
  proposalHash: string;
  target: KyrubActionPreviewTarget | null;
  expectedState: Record<string, string | number | boolean | null>;
  evidenceRefs: string[];
  autonomyDecision: KyrubAutonomyDecision;
  createdAt: string;
  expiresAt: string;
  requiresConfirmation: boolean;
  executionAllowed: false;
};
