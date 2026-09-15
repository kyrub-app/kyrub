import { adminDb } from '../firebaseAdmin.js';
import {
  listRecentOmnichannelObservedOrders,
  type OmnichannelObservedOrder,
} from './omnichannelOrderObservationService.js';

const clean = (value: unknown, max = 1_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, max)
    : '';

const finiteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const timestampToIso = (value: unknown): string => {
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return clean(value, 120);
};

const unique = (values: string[]): string[] =>
  Array.from(new Set(values.filter(Boolean))).sort();

const externalOrderIdFromInbox = (data: Record<string, unknown>): string => {
  const explicit = clean(data.externalOrderId, 240);
  if (explicit) return explicit;
  const resource = clean(data.resource, 500);
  return /^\/orders\/([^/?#]+)$/.exec(resource)?.[1] ?? '';
};

export interface OmnichannelManualReviewEscalation {
  provider: 'mercado_livre';
  externalOrderId: string;
  orderId: string;
  inboxId: string;
  reason: 'retry_exhausted';
  authority: 'manual_review_required';
  failureCount: number | null;
  failureBudget: number | null;
  errorCode: string;
  errorDiagnostic: string;
  exhaustedAt: string;
}

const attachManualReviewToObservation = (
  observation: OmnichannelObservedOrder,
  escalation: OmnichannelManualReviewEscalation
): void => {
  observation.ingress.state = 'failed';
  observation.ingress.attempts = escalation.failureCount;
  observation.ingress.outcome = escalation.reason;
  observation.ingress.error = escalation.errorDiagnostic || escalation.errorCode;
  observation.divergence.state = 'open';
  observation.divergence.evidenceIds = unique([
    ...observation.divergence.evidenceIds,
    escalation.inboxId,
  ]);
  observation.divergence.kinds = unique([
    ...observation.divergence.kinds,
    'retry_exhausted_manual_review_required',
  ]);
  if (!observation.timeline.some(item =>
    item.stage === 'divergence' &&
    item.evidenceId === escalation.inboxId &&
    item.detail === 'retry_exhausted_manual_review_required'
  )) {
    observation.timeline.push({
      stage: 'divergence',
      status: 'open',
      at: escalation.exhaustedAt,
      evidenceId: escalation.inboxId,
      detail: 'retry_exhausted_manual_review_required',
    });
    observation.timeline.sort((left, right) => {
      if (!left.at && !right.at) return left.stage.localeCompare(right.stage);
      if (!left.at) return 1;
      if (!right.at) return -1;
      return left.at.localeCompare(right.at);
    });
  }
};

export const listRecentOmnichannelObservedOrdersWithEscalations = async (input: {
  tenantId: string;
  requestedByUserId: string;
  limit?: number;
}): Promise<Awaited<ReturnType<typeof listRecentOmnichannelObservedOrders>> & {
  manualReviews: OmnichannelManualReviewEscalation[];
}> => {
  const base = await listRecentOmnichannelObservedOrders(input);
  const tenantId = clean(input.tenantId, 160);
  const inbox = await adminDb
    .collection('integrationWebhookInbox')
    .where('storeId', '==', tenantId)
    .limit(500)
    .get();

  const manualReviews: OmnichannelManualReviewEscalation[] = [];
  for (const document of inbox.docs) {
    const data = document.data() as Record<string, unknown>;
    if (
      clean(data.provider, 80) !== 'mercado_livre' ||
      clean(data.topic, 80) !== 'orders_v2' ||
      clean(data.processingStatus, 80) !== 'failed' ||
      clean(data.processingOutcome, 120) !== 'retry_exhausted' ||
      data.manualReviewRequired !== true
    ) continue;

    const externalOrderId = externalOrderIdFromInbox(data);
    if (!externalOrderId) continue;
    const escalation: OmnichannelManualReviewEscalation = {
      provider: 'mercado_livre',
      externalOrderId,
      orderId: clean(data.orderId, 240) || `mercado-livre-order-${externalOrderId}`,
      inboxId: document.id,
      reason: 'retry_exhausted',
      authority: 'manual_review_required',
      failureCount: finiteNumber(data.retryableFailureCount),
      failureBudget: finiteNumber(data.retryableFailureBudget),
      errorCode: clean(data.lastRetryableErrorCode, 160),
      errorDiagnostic: clean(data.lastRetryableErrorDiagnostic, 500),
      exhaustedAt: timestampToIso(data.retryExhaustedAt) || timestampToIso(data.failedAt),
    };
    manualReviews.push(escalation);

    const observation = base.items.find(item =>
      item.provider === 'mercado_livre' && item.externalOrderId === externalOrderId
    );
    if (observation) attachManualReviewToObservation(observation, escalation);
  }

  manualReviews.sort((left, right) => right.exhaustedAt.localeCompare(left.exhaustedAt));
  return { ...base, manualReviews };
};
