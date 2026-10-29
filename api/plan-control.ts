import {
  createCouponCampaign,
  loadPlanManagementSnapshot,
  mapPlanManagementError,
  publishPlanVersion,
  setCouponCampaignStatus,
} from '../server/admin/planManagementService.js';
import {
  designateOfficialStore,
  loadOfficialStoreSnapshot,
} from '../server/admin/officialStoreService.js';
import {
  cancelOwnPaidPlanSubscription,
  createOwnPaidPlanCheckout,
  handlePaidPlanProviderWebhook,
  loadOwnPlanSubscriptionState,
  loadPaidPlanBillingAvailability,
  reconcileOwnPaidPlanSubscription,
} from '../server/admin/paidPlanSubscriptionService.js';
import { loadPublicActivePlanCatalog } from '../server/admin/publicPlanCatalogService.js';
import { assignOfficialPlanProduct } from '../server/admin/officialPlanProductManagement.js';
import {
  grantComplimentaryPlanWithLifecycle,
  reconcileStoreEntitlementFromAuthorization,
  redeemCouponWithLifecycle,
} from '../server/admin/storeEntitlementLifecycleService.js';
import { mapStoreEntitlementError } from '../server/admin/storeEntitlementService.js';
import {
  cancelAuthorizedStoreSubscription,
  createAuthorizedStoreSubscription,
  getAuthorizedStoreSubscription,
  mapStoreSubscriptionError,
  processStoreSubscriptionMercadoPagoWebhook,
  reconcileAuthorizedStoreSubscription,
} from '../server/payments/storeSubscriptionService.js';
import {
  StoreSubscriptionBenefitError,
  consumeAuthorizedStoreSubscriptionBenefit,
  listAuthorizedStoreSubscriptionBenefitCycles,
  mapStoreSubscriptionBenefitError,
  reconcileStoreSubscriptionBenefitCycle,
} from '../server/payments/storeSubscriptionBenefitService.js';
import { loadAuthorizedStoreSubscriptionBenefitLedger } from '../server/payments/storeSubscriptionBenefitLedgerService.js';
import {
  loadAuthorizedStoreSubscriberRegistry,
  mapStoreSubscriberRegistryError,
  reconcileAuthorizedStoreSubscribersIntoCrm,
} from '../server/payments/storeSubscriberRegistryService.js';

import { authenticateConsultantRequest } from '../server/ai/consultantAuth.js';
import { quotePersistedMerchantSubscription } from '../server/payments/persistedMerchantSubscriptionQuote.js';
import { OfficialPlanCheckoutRouteError } from '../server/admin/officialPlanCheckoutRouting.js';
import { resolvePersistedProductCheckoutRoute } from '../server/admin/officialPlanProductLookup.js';

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

const webhookUserId = (
  body: Record<string, unknown>,
  query: Record<string, QueryValue> | undefined
): string => String(body.user_id ?? first(query?.user_id) ?? '').trim();

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

  if (operation === 'merchant.subscription.webhook') {
    if (method !== 'POST') {
      methodNotAllowed(response);
      return;
    }
    response.setHeader('cache-control', 'no-store, max-age=0');
    try {
      const dataId = webhookDataId(body, request.query);
      if (!dataId) {
        response.status(400).json({
          error: 'Recurso da assinatura não informado.',
          code: 'STORE_SUBSCRIPTION_WEBHOOK_DATA_REQUIRED',
        });
        return;
      }
      const result = await processStoreSubscriptionMercadoPagoWebhook({
        headers: request.headers,
        dataId,
        eventType: webhookEventType(body, request.query),
        userId: webhookUserId(body, request.query),
      });
      const benefitCycle = result.processed && result.storeId && result.subscriptionId
        ? await reconcileStoreSubscriptionBenefitCycle(result.storeId, result.subscriptionId)
        : null;
      response.status(200).json({ ...result, benefitCycle });
    } catch (error) {
      const mapped = error instanceof StoreSubscriptionBenefitError
        ? mapStoreSubscriptionBenefitError(error)
        : mapStoreSubscriptionError(error);
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
      case 'admin.official-store.snapshot': {
        if (method !== 'GET') {
          methodNotAllowed(response);
          return;
        }
        response.status(200).json(
          await loadOfficialStoreSnapshot(authorization)
        );
        return;
      }
      case 'admin.official-store.designate': {
        if (method !== 'POST') {
          methodNotAllowed(response);
          return;
        }
        response.status(200).json(
          await designateOfficialStore(authorization, request.body)
        );
        return;
      }
      case 'admin.official-plan-product.assign': {
        if (method !== 'POST') {
          methodNotAllowed(response);
          return;
        }
        if (typeof body.productId !== 'string' ||
            (body.planId !== 'free' && body.planId !== 'pro' && body.planId !== 'business')) {
          response.status(400).json({
            error: 'Informe um produto e um plano oficial válido.',
            code: 'INVALID_OFFICIAL_PLAN_PRODUCT',
          });
          return;
        }
        await assignOfficialPlanProduct({
          authorization,
          productId: body.productId,
          planId: body.planId,
        });
        response.status(200).json({ ok: true });
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
      case 'catalog.subscription.checkout': {
        if (method !== 'POST') {
          methodNotAllowed(response);
          return;
        }
        if (typeof body.storeId !== 'string' || typeof body.productId !== 'string') {
          response.status(400).json({ error: 'Informe loja e produto válidos.', code: 'INVALID_SUBSCRIPTION_CHECKOUT_REQUEST' });
          return;
        }
        // Fail closed on unknown checkout fields. A renamed contract-term or
        // payment-option key must not be silently ignored and charged monthly.
        if (Object.keys(body).some(key => key !== 'storeId' && key !== 'productId')) {
          response.status(409).json({
            error: 'Este checkout aceita somente loja e produto. Condições contratuais exigem o checkout específico.',
            code: 'SUBSCRIPTION_CONTRACT_CHECKOUT_REQUIRED',
          });
          return;
        }
        // Authenticate before privileged product and plan mapping reads.
        await authenticateConsultantRequest(authorization);
        const route = await resolvePersistedProductCheckoutRoute({
          sellerStoreReference: body.storeId,
          productId: body.productId,
          allowMerchantSubscription: true,
        });
        if (route.kind === 'platform-plan') {
          const checkout = await createOwnPaidPlanCheckout(authorization, route.plan);
          response.status(201).json(checkout);
          return;
        }
        if (route.kind === 'free-plan') {
          response.status(409).json({
            error: 'O plano Free não exige pagamento. Utilize o fluxo gratuito de adesão.',
            code: 'FREE_PLAN_CHECKOUT_NOT_REQUIRED',
          });
          return;
        }
        response.status(201).json(await createAuthorizedStoreSubscription(authorization, body));
        return;
      }
      case 'merchant.subscription.quote': {
        if (method !== 'POST') {
          methodNotAllowed(response);
          return;
        }
        await authenticateConsultantRequest(authorization);
        if (typeof body.storeId !== 'string' || typeof body.productId !== 'string' ||
            ![1, 3, 6, 12].includes(body.selectedMonths as number) ||
            !body.paymentTerms || typeof body.paymentTerms !== 'object' ||
            Array.isArray(body.paymentTerms)) {
          response.status(400).json({
            error: 'Informe loja, produto, prazo e condições de pagamento válidos.',
            code: 'INVALID_SUBSCRIPTION_QUOTE_REQUEST',
          });
          return;
        }
        const quote = await quotePersistedMerchantSubscription({
          sellerStoreReference: body.storeId,
          productId: body.productId,
          selectedMonths: body.selectedMonths as 1 | 3 | 6 | 12,
          paymentTerms: body.paymentTerms as Parameters<typeof quotePersistedMerchantSubscription>[0]['paymentTerms'],
        });
        response.setHeader('cache-control', 'no-store, max-age=0');
        response.status(200).json(quote);
        return;
      }
      case 'merchant.subscription.checkout': {
        if (method !== 'POST') {
          methodNotAllowed(response);
          return;
        }
        const result = await createAuthorizedStoreSubscription(authorization, request.body);
        const benefitCycle = await reconcileStoreSubscriptionBenefitCycle(
          result.subscription.storeId,
          result.subscription.id
        );
        response.status(201).json({ ...result, benefitCycle });
        return;
      }
      case 'merchant.subscription.state': {
        if (method !== 'POST') {
          methodNotAllowed(response);
          return;
        }
        response.status(200).json(
          await getAuthorizedStoreSubscription(authorization, request.body)
        );
        return;
      }
      case 'merchant.subscription.reconcile': {
        if (method !== 'POST') {
          methodNotAllowed(response);
          return;
        }
        const subscription = await reconcileAuthorizedStoreSubscription(
          authorization,
          request.body
        );
        const benefitCycle = await reconcileStoreSubscriptionBenefitCycle(
          subscription.storeId,
          subscription.id
        );
        response.status(200).json({ ...subscription, benefitCycle });
        return;
      }
      case 'merchant.subscription.cancel': {
        if (method !== 'POST') {
          methodNotAllowed(response);
          return;
        }
        response.status(200).json(
          await cancelAuthorizedStoreSubscription(authorization, request.body)
        );
        return;
      }
      case 'merchant.subscription.benefits.list': {
        if (method !== 'POST') {
          methodNotAllowed(response);
          return;
        }
        response.status(200).json(
          await listAuthorizedStoreSubscriptionBenefitCycles(authorization, request.body)
        );
        return;
      }
      case 'merchant.subscription.benefits.ledger': {
        if (method !== 'POST') {
          methodNotAllowed(response);
          return;
        }
        response.status(200).json(
          await loadAuthorizedStoreSubscriptionBenefitLedger(authorization, request.body)
        );
        return;
      }
      case 'merchant.subscription.benefit.consume': {
        if (method !== 'POST') {
          methodNotAllowed(response);
          return;
        }
        response.status(200).json(
          await consumeAuthorizedStoreSubscriptionBenefit(authorization, request.body)
        );
        return;
      }
      case 'merchant.subscribers.list': {
        if (method !== 'GET') {
          methodNotAllowed(response);
          return;
        }
        response.status(200).json(
          await loadAuthorizedStoreSubscriberRegistry(
            authorization,
            first(request.query?.storeId)
          )
        );
        return;
      }
      case 'merchant.subscribers.reconcile': {
        if (method !== 'POST') {
          methodNotAllowed(response);
          return;
        }
        response.status(200).json(
          await reconcileAuthorizedStoreSubscribersIntoCrm(
            authorization,
            body.storeId
          )
        );
        return;
      }
      default:
        response.status(404).json({
          error: 'Operação de planos não encontrada.',
          code: 'PLAN_CONTROL_OPERATION_NOT_FOUND',
        });
    }
  } catch (error) {
    if (operation === 'merchant.subscription.quote') {
      if (error instanceof OfficialPlanCheckoutRouteError) {
        const status = error.code === 'PRODUCT_NOT_FOUND' ? 404
          : error.code === 'INVALID_PRODUCT_ID' ? 400 : 409;
        response.status(status).json({ error: error.message, code: error.code });
        return;
      }
      // Quote validation is pure and read-only. Return a client error for
      // known invalid selections instead of misreporting them as server faults.
      const validationCodes = new Set([
        'INVALID_SUBSCRIPTION_PRODUCT_FOR_CONTRACT',
        'INVALID_PERSISTED_SUBSCRIPTION_OFFERS',
        'SUBSCRIPTION_TERM_NOT_OFFERED',
        'INVALID_SUBSCRIPTION_CONTRACT_OFFER',
        'INVALID_SUBSCRIPTION_CONTRACT_TERMS',
        'MISSING_MONTHLY_BASELINE',
        'DUPLICATE_SUBSCRIPTION_CONTRACT_TERM',
        'UNSUPPORTED_RECURRING_CONTRACT_TERM',
        'INVALID_CONTRACT_PAYMENT_TERMS',
        'INVALID_CONTRACT_INSTALLMENTS',
      ]);
      if (error instanceof Error && validationCodes.has(error.message)) {
        response.status(409).json({
          error: 'As condições solicitadas não estão disponíveis para este produto.',
          code: error.message,
        });
        return;
      }
    }
    const mapped = operation.startsWith('merchant.subscription.benefit')
      ? mapStoreSubscriptionBenefitError(error)
      : operation.startsWith('merchant.subscribers')
        ? mapStoreSubscriberRegistryError(error)
        : operation.startsWith('merchant.subscription')
          ? error instanceof StoreSubscriptionBenefitError
            ? mapStoreSubscriptionBenefitError(error)
            : mapStoreSubscriptionError(error)
          : operation.startsWith('store.subscription')
            ? mapPlanManagementError(error)
            : operation.startsWith('store.') || operation === 'admin.entitlement.grant'
              ? mapStoreEntitlementError(error)
              : mapPlanManagementError(error);
    response.status(mapped.status).json(mapped.body);
  }
}
