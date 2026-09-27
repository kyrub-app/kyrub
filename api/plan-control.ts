import {
  createCouponCampaign,
  loadPlanManagementSnapshot,
  mapPlanManagementError,
  publishPlanVersion,
  setCouponCampaignStatus,
} from '../server/admin/planManagementService.js';
import {
  cancelOwnPaidPlanSubscription,
  createOwnPaidPlanCheckout,
  handlePaidPlanProviderWebhook,
  loadOwnPlanSubscriptionState,
  loadPaidPlanBillingAvailability,
  reconcileOwnPaidPlanSubscription,
} from '../server/admin/paidPlanSubscriptionService.js';
import { loadPublicActivePlanCatalog } from '../server/admin/publicPlanCatalogService.js';
import {
  grantComplimentaryPlanWithLifecycle,
  reconcileStoreEntitlementFromAuthorization,
  redeemCouponWithLifecycle,
} from '../server/admin/storeEntitlementLifecycleService.js';
import { mapStoreEntitlementError } from '../server/admin/storeEntitlementService.js';

type HeaderValue = string | string[] | undefined;
type QueryValue = string | string[] | undefined;
type RequestLike = {
  method?: string;
  headers: Record<string, HeaderValue>;
  query?: Record<string, QueryValue>;
  body?: unknown;
};
type ResponseLike = {
  setHeader(name: string, value: string): void;
  status(code: number): ResponseLike;
  json(body: unknown): void;
};

const first = (value: HeaderValue | QueryValue): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const methodNotAllowed = (response: ResponseLike): void => {
  response.status(405).json({
    error: 'Método não permitido.',
    code: 'METHOD_NOT_ALLOWED',
  });
};

const webhookDataId = (
  body: Record<string, unknown>,
  query: Record<string, QueryValue> | undefined
): string => {
  const data = record(body.data);
  return String(data.id ?? first(query?.['data.id']) ?? first(query?.id) ?? '').trim();
};

const webhookEventType = (
  body: Record<string, unknown>,
  query: Record<string, QueryValue> | undefined
): string => String(body.type ?? body.topic ?? first(query?.type) ?? first(query?.topic) ?? '').trim();

export default async function handler(
  request: RequestLike,
  response: ResponseLike
): Promise<void> {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  const method = (request.method ?? 'GET').toUpperCase();
  const operation = first(request.query?.op);
  const authorization = first(
    request.headers.authorization ?? request.headers.Authorization
  );
  const body = record(request.body);

  if (operation === 'plans.active') {
    if (method !== 'GET') {
      methodNotAllowed(response);
      return;
    }
    response.setHeader(
      'cache-control',
      'public, max-age=0, s-maxage=60, stale-while-revalidate=300'
    );
    try {
      response.status(200).json(await loadPublicActivePlanCatalog());
    } catch (error) {
      console.error('[Kyrub Plans] Public catalog gateway failed.', error);
      response.status(503).json({
        error: 'Catálogo de planos temporariamente indisponível.',
        code: 'PLAN_CATALOG_UNAVAILABLE',
      });
    }
    return;
  }

  if (operation === 'plans.billing') {
    if (method !== 'GET') {
      methodNotAllowed(response);
      return;
    }
    response.setHeader('cache-control', 'no-store, max-age=0');
    response.status(200).json(loadPaidPlanBillingAvailability());
    return;
  }

  if (operation === 'subscription.webhook') {
    if (method !== 'POST') {
      methodNotAllowed(response);
      return;
    }
    response.setHeader('cache-control', 'no-store, max-age=0');
    try {
      const dataId = webhookDataId(body, request.query);
      if (!dataId) {
        response.status(400).json({ error: 'Assinatura não informada.', code: 'SUBSCRIPTION_ID_REQUIRED' });
        return;
      }
      response.status(200).json(await handlePaidPlanProviderWebhook({
        signature: request.headers['x-signature'] ?? request.headers['X-Signature'],
        requestId: request.headers['x-request-id'] ?? request.headers['X-Request-Id'],
        dataId,
        eventType: webhookEventType(body, request.query),
      }));
    } catch (error) {
      const mapped = mapPlanManagementError(error);
      response.status(mapped.status).json(mapped.body);
    }
    return;
  }

  response.setHeader('cache-control', 'no-store, max-age=0');

  try {
    switch (operation) {
      case 'admin.snapshot': {
        if (method !== 'GET') {
          methodNotAllowed(response);
          return;
        }
        response.status(200).json(
          await loadPlanManagementSnapshot(authorization)
        );
        return;
      }
      case 'admin.plan.publish': {
        if (method !== 'POST') {
          methodNotAllowed(response);
          return;
        }
        response.status(201).json(
          await publishPlanVersion(authorization, request.body)
        );
        return;
      }
      case 'admin.coupon.create': {
        if (method !== 'POST') {
          methodNotAllowed(response);
          return;
        }
        response.status(201).json(
          await createCouponCampaign(authorization, request.body)
        );
        return;
      }
      case 'admin.coupon.status': {
        if (method !== 'POST') {
          methodNotAllowed(response);
          return;
        }
        response.status(200).json(
          await setCouponCampaignStatus(
            authorization,
            body.code,
            body.status
          )
        );
        return;
      }
      case 'admin.entitlement.grant': {
        if (method !== 'POST') {
          methodNotAllowed(response);
          return;
        }
        response.status(201).json(
          await grantComplimentaryPlanWithLifecycle(
            authorization,
            request.body
          )
        );
        return;
      }
      case 'store.coupon.redeem': {
        if (method !== 'POST') {
          methodNotAllowed(response);
          return;
        }
        response.status(200).json(
          await redeemCouponWithLifecycle(authorization, body.code)
        );
        return;
      }
      case 'store.entitlement.reconcile': {
        if (method !== 'POST') {
          methodNotAllowed(response);
          return;
        }
        response.status(200).json(
          await reconcileStoreEntitlementFromAuthorization(authorization)
        );
        return;
      }
      case 'store.subscription.state': {
        if (method !== 'GET') {
          methodNotAllowed(response);
          return;
        }
        response.status(200).json(await loadOwnPlanSubscriptionState(authorization));
        return;
      }
      case 'store.subscription.checkout': {
        if (method !== 'POST') {
          methodNotAllowed(response);
          return;
        }
        response.status(201).json(await createOwnPaidPlanCheckout(authorization, body.plan));
        return;
      }
      case 'store.subscription.reconcile': {
        if (method !== 'POST') {
          methodNotAllowed(response);
          return;
        }
        response.status(200).json(await reconcileOwnPaidPlanSubscription(authorization));
        return;
      }
      case 'store.subscription.cancel': {
        if (method !== 'POST') {
          methodNotAllowed(response);
          return;
        }
        response.status(200).json(await cancelOwnPaidPlanSubscription(authorization));
        return;
      }
      default:
        response.status(404).json({
          error: 'Operação de planos não encontrada.',
          code: 'PLAN_CONTROL_OPERATION_NOT_FOUND',
        });
    }
  } catch (error) {
    const mapped = operation.startsWith('store.subscription')
      ? mapPlanManagementError(error)
      : operation.startsWith('store.') || operation === 'admin.entitlement.grant'
        ? mapStoreEntitlementError(error)
        : mapPlanManagementError(error);
    response.status(mapped.status).json(mapped.body);
  }
}
