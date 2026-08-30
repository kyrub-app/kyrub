import { Router, type Request, type Response } from 'express';
import { adminDb } from '../firebaseAdmin.js';
import { authorizeOperationsHealth } from './operationsHealthRouter.js';

const DELIVERY_COLLECTION = 'hub/renda/deliveries';
const REVIEW_LIMIT = 100;

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finiteInt = (value: unknown): number =>
  Number.isSafeInteger(value) ? Number(value) : 0;

interface ResponsibilityReviewInterval {
  responsibleActor: string;
  reasonCode: string;
  evidenceStatus: string;
  durationSeconds: number;
}

interface ResponsibilityReviewItem {
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

const mapError = (error: unknown): { status: number; body: { error: string; code: string } } => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED' || /id-token|expired|revoked/i.test(message)) {
    return { status: 401, body: { error: 'Faça login novamente.', code: 'AUTH_REQUIRED' } };
  }
  if (message === 'EMAIL_NOT_VERIFIED' || message === 'FORBIDDEN') {
    return { status: 403, body: { error: 'Acesso à responsabilidade operacional não autorizado.', code: 'FORBIDDEN' } };
  }
  console.error('[Admin Operational Responsibility]', error);
  return { status: 503, body: { error: 'Não foi possível consultar a fila de responsabilidade agora.', code: 'RESPONSIBILITY_REVIEW_UNAVAILABLE' } };
};

export const createOperationalResponsibilityRouter = (): Router => {
  const router = Router();
  router.get('/review-queue', async (request: Request, response: Response) => {
    try {
      await authorizeOperationsHealth(request.get('authorization') ?? '');
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await loadOperationalResponsibilityReviewQueue());
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json(mapped.body);
    }
  });
  return router;
};
