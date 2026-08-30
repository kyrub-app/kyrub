import { adminDb } from '../firebaseAdmin.js';

const DELIVERY_COLLECTION = 'hub/renda/deliveries';
const REVIEW_LIMIT = 100;

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finiteInt = (value: unknown): number =>
  Number.isSafeInteger(value) ? Number(value) : 0;

export interface ResponsibilityReviewInterval {
  responsibleActor: string;
  reasonCode: string;
  evidenceStatus: string;
  durationSeconds: number;
}

export interface ResponsibilityReviewItem {
  deliveryId: string;
  orderId: string;
  storeId: string;
  status: 'review_required' | 'external';
  assessedAt: string;
  policyId: string;
  policyVersion: number;
  economicDecisionStatus: string;
  intervals: ResponsibilityReviewInterval[];
}

const parseIntervals = (value: unknown): ResponsibilityReviewInterval[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const raw = item as Record<string, unknown>;
    return [{
      responsibleActor: clean(raw.responsibleActor) || 'undetermined',
      reasonCode: clean(raw.reasonCode) || 'unknown',
      evidenceStatus: clean(raw.evidenceStatus) || 'review_required',
      durationSeconds: Math.max(0, finiteInt(raw.durationSeconds)),
    }];
  });
};

const parseReviewItem = (
  id: string,
  data: Record<string, unknown>
): ResponsibilityReviewItem | null => {
  const assessment = data.responsibilityAssessment;
  if (!assessment || typeof assessment !== 'object' || Array.isArray(assessment)) return null;
  const raw = assessment as Record<string, unknown>;
  const status = clean(raw.status);
  if (status !== 'review_required' && status !== 'external') return null;
  const decision = data.billableWaitingDecision && typeof data.billableWaitingDecision === 'object' && !Array.isArray(data.billableWaitingDecision)
    ? data.billableWaitingDecision as Record<string, unknown>
    : {};
  return {
    deliveryId: id,
    orderId: clean(data.sourceOrderId),
    storeId: clean(data.storeId),
    status,
    assessedAt: clean(raw.assessedAt),
    policyId: clean(raw.policyId),
    policyVersion: finiteInt(raw.policyVersion),
    economicDecisionStatus: clean(decision.status) || 'not_materialized',
    intervals: parseIntervals(raw.intervals),
  };
};

const loadStatus = async (
  status: ResponsibilityReviewItem['status']
): Promise<ResponsibilityReviewItem[]> => {
  const snapshot = await adminDb
    .collection(DELIVERY_COLLECTION)
    .where('responsibilityAssessment.status', '==', status)
    .limit(REVIEW_LIMIT)
    .get();
  return snapshot.docs.flatMap(document => {
    const parsed = parseReviewItem(document.id, document.data() as Record<string, unknown>);
    return parsed ? [parsed] : [];
  });
};

export const loadOperationalResponsibilityReviewQueue = async () => {
  const [reviewRequired, external] = await Promise.all([
    loadStatus('review_required'),
    loadStatus('external'),
  ]);
  const items = [...reviewRequired, ...external]
    .sort((a, b) => Date.parse(b.assessedAt || '1970-01-01') - Date.parse(a.assessedAt || '1970-01-01'))
    .slice(0, REVIEW_LIMIT);
  return {
    generatedAt: new Date().toISOString(),
    counts: {
      reviewRequired: reviewRequired.length,
      external: external.length,
      visible: items.length,
    },
    items,
  };
};
