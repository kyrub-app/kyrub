import { createHash } from 'node:crypto';
import {
  KYRUB_RECONCILIATION_SCHEMA_VERSION,
  type KyrubReconciliationFinding,
  type KyrubReconciliationFindingCode,
  type KyrubReconciliationSeverity,
  type KyrubReconciliationSnapshot,
} from '../../shared/kyrubReconciliation.js';

const REQUIRED_CHAIN_STAGES = [
  'preview',
  'authorization',
  'execution',
  'receipt',
  'domain_event',
] as const;

const unique = (items: readonly string[]): string[] => [...new Set(items.filter(Boolean))];

const severityFor = (code: KyrubReconciliationFindingCode): KyrubReconciliationSeverity =>
  code === 'DUPLICATE_EVENT' || code === 'INCOMPLETE_CORRELATION_CHAIN'
    ? 'warning'
    : 'error';

const finding = (input: {
  correlationId: string;
  code: KyrubReconciliationFindingCode;
  referenceIds: string[];
  detectedAt: string;
}): KyrubReconciliationFinding => ({
  schemaVersion: KYRUB_RECONCILIATION_SCHEMA_VERSION,
  findingId: `finding_${createHash('sha256')
    .update(`${input.correlationId}:${input.code}:${unique(input.referenceIds).sort().join(',')}`)
    .digest('hex')
    .slice(0, 40)}`,
  correlationId: input.correlationId,
  code: input.code,
  severity: severityFor(input.code),
  referenceIds: unique(input.referenceIds).sort(),
  detectedAt: input.detectedAt,
  autoRepairAllowed: false,
});

export const reconcileKyrubExecutionChain = (input: {
  snapshot: KyrubReconciliationSnapshot;
  detectedAt?: Date;
}): KyrubReconciliationFinding[] => {
  const detectedAt = (input.detectedAt ?? new Date()).toISOString();
  const snapshot = input.snapshot;
  const findings: KyrubReconciliationFinding[] = [];
  const effects = unique(snapshot.effectIds);
  const receipts = unique(snapshot.receiptIds);
  const events = unique(snapshot.eventIds);
  const stages = unique(snapshot.correlationStages);

  if (effects.length > 0 && receipts.length === 0) {
    findings.push(finding({
      correlationId: snapshot.correlationId,
      code: 'EFFECT_WITHOUT_RECEIPT',
      referenceIds: effects,
      detectedAt,
    }));
  }
  if (receipts.length > 0 && events.length === 0) {
    findings.push(finding({
      correlationId: snapshot.correlationId,
      code: 'RECEIPT_WITHOUT_EVENT',
      referenceIds: receipts,
      detectedAt,
    }));
  }
  if (events.length > 0 && receipts.length === 0) {
    findings.push(finding({
      correlationId: snapshot.correlationId,
      code: 'EVENT_WITHOUT_RECEIPT',
      referenceIds: events,
      detectedAt,
    }));
  }
  if (snapshot.eventIds.length !== events.length) {
    findings.push(finding({
      correlationId: snapshot.correlationId,
      code: 'DUPLICATE_EVENT',
      referenceIds: snapshot.eventIds,
      detectedAt,
    }));
  }

  const missingStages = REQUIRED_CHAIN_STAGES.filter(stage => !stages.includes(stage));
  if (missingStages.length > 0 && (effects.length + receipts.length + events.length) > 0) {
    findings.push(finding({
      correlationId: snapshot.correlationId,
      code: 'INCOMPLETE_CORRELATION_CHAIN',
      referenceIds: missingStages.map(stage => `missing:${stage}`),
      detectedAt,
    }));
  }

  return findings;
};

export type KyrubRecoveryRecommendation = {
  findingId: string;
  mode: 'inspect_only' | 'replay_idempotent_event' | 'rebuild_receipt_from_authoritative_effect';
  requiresHumanApproval: true;
};

export const recommendKyrubRecovery = (
  finding: KyrubReconciliationFinding
): KyrubRecoveryRecommendation => ({
  findingId: finding.findingId,
  mode: finding.code === 'RECEIPT_WITHOUT_EVENT'
    ? 'replay_idempotent_event'
    : finding.code === 'EFFECT_WITHOUT_RECEIPT'
      ? 'rebuild_receipt_from_authoritative_effect'
      : 'inspect_only',
  requiresHumanApproval: true,
});
