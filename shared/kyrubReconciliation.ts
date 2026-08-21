export const KYRUB_RECONCILIATION_SCHEMA_VERSION = 1 as const;

export type KyrubReconciliationFindingCode =
  | 'EFFECT_WITHOUT_RECEIPT'
  | 'RECEIPT_WITHOUT_EVENT'
  | 'EVENT_WITHOUT_RECEIPT'
  | 'DUPLICATE_EVENT'
  | 'INCOMPLETE_CORRELATION_CHAIN';

export type KyrubReconciliationSeverity = 'info' | 'warning' | 'error';

export type KyrubReconciliationFinding = {
  schemaVersion: typeof KYRUB_RECONCILIATION_SCHEMA_VERSION;
  findingId: string;
  correlationId: string;
  code: KyrubReconciliationFindingCode;
  severity: KyrubReconciliationSeverity;
  referenceIds: string[];
  detectedAt: string;
  autoRepairAllowed: false;
};

export type KyrubReconciliationSnapshot = {
  correlationId: string;
  effectIds: string[];
  receiptIds: string[];
  eventIds: string[];
  correlationStages: string[];
};
