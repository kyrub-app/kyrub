export const KYRUB_OMNICHANNEL_E2E_EVIDENCE_CHANGED_EVENT =
  'kyrub:omnichannel-e2e-evidence-changed';

export type OmnichannelE2EEvidenceKind =
  | 'mercado_livre_publication'
  | 'mercado_livre_stock'
  | '99food_availability'
  | '99food_status_decision'
  | '99food_manual_status_sync'
  | '99food_status_reconciliation';

export type OmnichannelE2EEvidenceSource =
  | 'authoritative_execution_result'
  | 'provider_readback';

export type OmnichannelE2EEvidenceDetailValue =
  | string
  | number
  | boolean
  | null;

export interface OmnichannelE2EEvidenceInput {
  storeId: string;
  kind: OmnichannelE2EEvidenceKind;
  source: OmnichannelE2EEvidenceSource;
  referenceId: string;
  outcome: string;
  summary: string;
  details?: Record<string, OmnichannelE2EEvidenceDetailValue>;
}

export interface OmnichannelE2EEvidenceRecord
  extends OmnichannelE2EEvidenceInput {
  id: string;
  observedAt: string;
  details: Record<string, OmnichannelE2EEvidenceDetailValue>;
}

const evidenceByStore = new Map<string, OmnichannelE2EEvidenceRecord[]>();
let evidenceSequence = 0;

const clean = (value: string, max = 500): string =>
  value.trim().slice(0, max);

const sanitizeDetails = (
  value: Record<string, OmnichannelE2EEvidenceDetailValue> | undefined
): Record<string, OmnichannelE2EEvidenceDetailValue> => {
  if (!value) return {};
  const sanitized: Record<string, OmnichannelE2EEvidenceDetailValue> = {};
  for (const [keyValue, detail] of Object.entries(value).slice(0, 24)) {
    const key = clean(keyValue, 80);
    if (!key) continue;
    if (typeof detail === 'string') {
      sanitized[key] = clean(detail, 500);
      continue;
    }
    if (
      detail === null ||
      typeof detail === 'boolean' ||
      (typeof detail === 'number' && Number.isFinite(detail))
    ) {
      sanitized[key] = detail;
    }
  }
  return sanitized;
};

const notifyChanged = (storeId: string): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<{ storeId: string }>(
    KYRUB_OMNICHANNEL_E2E_EVIDENCE_CHANGED_EVENT,
    { detail: { storeId } }
  ));
};

export const recordOmnichannelE2EEvidence = (
  input: OmnichannelE2EEvidenceInput
): OmnichannelE2EEvidenceRecord | null => {
  const storeId = clean(input.storeId, 240);
  const referenceId = clean(input.referenceId, 300);
  const outcome = clean(input.outcome, 160);
  const summary = clean(input.summary, 800);
  if (!storeId || !referenceId || !outcome || !summary) return null;

  const observedAt = new Date().toISOString();
  evidenceSequence += 1;
  const record: OmnichannelE2EEvidenceRecord = {
    ...input,
    storeId,
    referenceId,
    outcome,
    summary,
    details: sanitizeDetails(input.details),
    observedAt,
    id: `${observedAt}:${evidenceSequence}:${input.kind}:${referenceId}`,
  };
  const current = evidenceByStore.get(storeId) ?? [];
  evidenceByStore.set(storeId, [record, ...current].slice(0, 50));
  notifyChanged(storeId);
  return record;
};

export const readOmnichannelE2EEvidence = (
  storeIdValue: string
): OmnichannelE2EEvidenceRecord[] => {
  const storeId = clean(storeIdValue, 240);
  if (!storeId) return [];
  return [...(evidenceByStore.get(storeId) ?? [])];
};

export const clearOmnichannelE2EEvidence = (
  storeIdValue: string
): boolean => {
  const storeId = clean(storeIdValue, 240);
  if (!storeId || !evidenceByStore.has(storeId)) return false;
  evidenceByStore.delete(storeId);
  notifyChanged(storeId);
  return true;
};
