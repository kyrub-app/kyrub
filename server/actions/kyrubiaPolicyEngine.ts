import { randomUUID } from 'node:crypto';
import {
  KYRUB_ACTION_REGISTRY,
  type KyrubActionImpact,
  type KyrubActionProposal,
  type KyrubPolicyDecision,
  type KyrubPolicyReason,
} from '../../shared/kyrubActions';

export type KyrubPolicyEvaluationContext = {
  actorUid: string;
  permissions: ReadonlySet<string> | readonly string[];
  confirmed: boolean;
  now?: Date;
  decisionId?: string;
};

const hasPermission = (
  permissions: KyrubPolicyEvaluationContext['permissions'],
  permission: string
): boolean => Array.isArray(permissions)
  ? permissions.includes(permission)
  : permissions.has(permission);

const normalizedImpact = (
  proposal: KyrubActionProposal
): KyrubActionImpact => proposal.impact ?? {
  entityCount: 1,
  reversibility: 'easy',
};

const impactIsValid = (impact: KyrubActionImpact): boolean => {
  if (!Number.isInteger(impact.entityCount) || impact.entityCount < 1) return false;
  if (
    impact.financialExposureMinor !== undefined &&
    (!Number.isInteger(impact.financialExposureMinor) ||
      impact.financialExposureMinor < 0)
  ) {
    return false;
  }
  if (
    impact.financialExposureMinor !== undefined &&
    !impact.financialCurrency?.trim()
  ) {
    return false;
  }
  return true;
};

export const evaluateKyrubActionPolicy = (
  proposal: KyrubActionProposal,
  context: KyrubPolicyEvaluationContext
): KyrubPolicyDecision => {
  const definition = KYRUB_ACTION_REGISTRY[proposal.type];
  const reasons: KyrubPolicyReason[] = [];
  const impact = normalizedImpact(proposal);

  if (!definition) reasons.push('ACTION_NOT_REGISTERED');
  if (!context.actorUid.trim()) reasons.push('AUTH_REQUIRED');
  if (definition && !hasPermission(context.permissions, definition.permission)) {
    reasons.push('PERMISSION_REQUIRED');
  }
  if (!impactIsValid(impact)) reasons.push('INVALID_IMPACT');
  if (
    definition?.mode === 'write' &&
    proposal.inputProvenance !== 'user_intent'
  ) {
    reasons.push('WRITE_REQUIRES_USER_INTENT');
  }
  if (
    definition &&
    impactIsValid(impact) &&
    impact.entityCount > definition.maxAffectedEntities
  ) {
    reasons.push('BLAST_RADIUS_EXCEEDED');
  }

  const hardDenial = reasons.length > 0;
  if (!hardDenial && definition.requiresConfirmation && !context.confirmed) {
    reasons.push('CONFIRMATION_REQUIRED');
  }

  const evaluatedAt = (context.now ?? new Date()).toISOString();
  return {
    version: 1,
    id: context.decisionId ?? randomUUID(),
    outcome: hardDenial
      ? 'deny'
      : reasons.includes('CONFIRMATION_REQUIRED')
        ? 'require_confirmation'
        : 'allow',
    actionType: proposal.type,
    permission: definition?.permission ?? '',
    reasons,
    evaluatedAt,
    maxAffectedEntities: definition?.maxAffectedEntities ?? 0,
  };
};
