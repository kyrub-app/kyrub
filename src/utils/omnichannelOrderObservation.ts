import type { User } from 'firebase/auth';

const encoded = (value: string): string => encodeURIComponent(value.trim());

const authorizedFetch = async <T>(
  user: User,
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<T> => {
  const token = await user.getIdToken();
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(input, { ...init, headers, cache: 'no-store' });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.error === 'string' && payload.error.trim()
      ? payload.error.trim()
      : `Não foi possível concluir a operação (${response.status}).`;
    const code = typeof payload.code === 'string' ? payload.code.trim() : '';
    throw new Error(code ? `${message} (${code})` : message);
  }
  return payload as T;
};

export interface OmnichannelManualReview {
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

export interface OmnichannelObservationResponse {
  manualReviews: OmnichannelManualReview[];
  items: unknown[];
  [key: string]: unknown;
}

export type MercadoLivreManualReviewAction =
  | 'retry_now'
  | 'keep_in_review'
  | 'close_non_processable';

export interface MercadoLivreManualReviewResolution {
  action: MercadoLivreManualReviewAction;
  inboxId: string;
  externalOrderId: string;
  orderId: string;
  status: 'queued' | 'in_review' | 'closed_non_processable';
  manualReviewRequired: boolean;
  manualRetryCycle?: number;
  queueMessageId?: string;
}

export const loadOmnichannelManualReviews = (
  user: User,
  limit = 30
): Promise<OmnichannelObservationResponse> =>
  authorizedFetch<OmnichannelObservationResponse>(
    user,
    `/api/store-connections/omnichannel/orders/recent?limit=${Math.max(1, Math.min(100, Math.trunc(limit)))}`
  );

export const resolveMercadoLivreManualReview = (
  user: User,
  storeId: string,
  inboxId: string,
  action: MercadoLivreManualReviewAction,
  reason: string
): Promise<MercadoLivreManualReviewResolution> =>
  authorizedFetch<MercadoLivreManualReviewResolution>(
    user,
    `/api/store-connections/mercado-livre/${encoded(storeId)}/e2e/order-ingress-reviews/${encoded(inboxId)}/resolve`,
    {
      method: 'POST',
      body: JSON.stringify({
        action,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    }
  );
