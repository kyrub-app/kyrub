import type { User } from 'firebase/auth';
import type { AdminProfile } from './adminControlPlane';

export interface AdminResponsibilityReviewInterval {
  responsibleActor: string;
  reasonCode: string;
  evidenceStatus: string;
  durationSeconds: number;
}

export interface AdminResponsibilityReviewItem {
  deliveryId: string;
  orderId: string;
  storeId: string;
  status: 'review_required' | 'external';
  assessedAt: string;
  policyId: string;
  policyVersion: number;
  economicDecisionStatus: string;
  intervals: AdminResponsibilityReviewInterval[];
}

export interface AdminResponsibilityReviewSnapshot {
  generatedAt: string;
  counts: {
    reviewRequired: number;
    external: number;
    visible: number;
  };
  items: AdminResponsibilityReviewItem[];
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const safeInt = (value: unknown): number =>
  Number.isSafeInteger(value) ? Number(value) : 0;

export const parseAdminResponsibilityReviewSnapshot = (
  value: unknown
): AdminResponsibilityReviewSnapshot | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const counts = raw.counts && typeof raw.counts === 'object' && !Array.isArray(raw.counts)
    ? raw.counts as Record<string, unknown>
    : null;
  if (!counts || !Array.isArray(raw.items)) return null;
  const items = raw.items.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const candidate = item as Record<string, unknown>;
    const status = candidate.status;
    if (status !== 'review_required' && status !== 'external') return [];
    const intervals = Array.isArray(candidate.intervals)
      ? candidate.intervals.flatMap(interval => {
          if (!interval || typeof interval !== 'object' || Array.isArray(interval)) return [];
          const rawInterval = interval as Record<string, unknown>;
          return [{
            responsibleActor: clean(rawInterval.responsibleActor),
            reasonCode: clean(rawInterval.reasonCode),
            evidenceStatus: clean(rawInterval.evidenceStatus),
            durationSeconds: Math.max(0, safeInt(rawInterval.durationSeconds)),
          }];
        })
      : [];
    return [{
      deliveryId: clean(candidate.deliveryId),
      orderId: clean(candidate.orderId),
      storeId: clean(candidate.storeId),
      status,
      assessedAt: clean(candidate.assessedAt),
      policyId: clean(candidate.policyId),
      policyVersion: safeInt(candidate.policyVersion),
      economicDecisionStatus: clean(candidate.economicDecisionStatus),
      intervals,
    } satisfies AdminResponsibilityReviewItem];
  });
  return {
    generatedAt: clean(raw.generatedAt),
    counts: {
      reviewRequired: Math.max(0, safeInt(counts.reviewRequired)),
      external: Math.max(0, safeInt(counts.external)),
      visible: Math.max(0, safeInt(counts.visible)),
    },
    items,
  };
};

export const loadAdminOperationalResponsibilityReview = async (
  user: Pick<User, 'getIdToken'>,
  profile: Pick<AdminProfile, 'role' | 'status'>
): Promise<AdminResponsibilityReviewSnapshot> => {
  if (profile.status !== 'active' || (profile.role !== 'super_admin' && profile.role !== 'operations')) {
    throw new Error('Seu papel não possui acesso à responsabilidade operacional.');
  }
  const token = await user.getIdToken();
  const response = await fetch('/api/admin/operational-responsibility/review-queue', {
    headers: { authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(clean(payload.error) || 'Não foi possível consultar a fila de responsabilidade.');
  }
  const parsed = parseAdminResponsibilityReviewSnapshot(payload);
  if (!parsed) throw new Error('O servidor retornou uma fila de responsabilidade inválida.');
  return parsed;
};
