import { executeAuthorizedKyrubAction } from '../server/actions/actionExecutionFacade.js';
import { mapKyrubActionExecutionError } from '../server/actions/actionExecutionService.js';
import {
  executeAuthorizedKyrubCatalogDraft,
  isKyrubCatalogDraftExecutionRequest,
  isKyrubCatalogDraftListRequest,
  isKyrubCatalogProductPublicationRequest,
  isKyrubCatalogProductUpdateRequest,
  listAuthorizedKyrubCatalogDrafts,
  setAuthorizedKyrubCatalogProductPublication,
  updateAuthorizedKyrubCatalogProduct,
} from '../server/actions/catalogProductLifecycleService.js';
import {
  executeAuthorizedKyrubCatalogImport,
  isKyrubCatalogImportExecutionRequest,
} from '../server/actions/catalogImportExecutionService.js';
import {
  executeAuthorizedKyrubInventoryAdjustment,
  isKyrubInventoryAdjustmentExecutionRequest,
} from '../server/actions/inventoryAdjustmentExecutionService.js';
import {
  executeAuthorizedKyrubProductComposition,
  isKyrubProductCompositionExecutionRequest,
} from '../server/actions/productCompositionExecutionService.js';
import { ensureCanonicalStoreForCatalog } from '../server/actions/canonicalStoreRepairService.js';
import {
  isKyrubActionReceiptVerificationRequest,
  verifyAuthorizedKyrubActionReceipt,
} from '../server/actions/actionReceiptVerificationService.js';
import { hydrateExecutablePlanCatalog } from '../server/admin/executablePlanCatalogService.js';
import { reconcileStoreEntitlementFromAuthorization } from '../server/admin/storeEntitlementLifecycleService.js';
import {
  createMarketplacePaymentIntent,
  mapMarketplaceCheckoutError,
} from '../server/payments/paymentIntentRouter.js';

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

const headerValue = (value: HeaderValue | QueryValue): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

export default async function handler(
  request: RequestLike,
  response: ResponseLike
): Promise<void> {
  response.setHeader('cache-control', 'no-store, max-age=0');
  response.setHeader('content-type', 'application/json; charset=utf-8');

  if ((request.method ?? 'GET').toUpperCase() !== 'POST') {
    response.status(405).json({
      error: 'Método não permitido.',
      code: 'METHOD_NOT_ALLOWED',
    });
    return;
  }

  const authorization = headerValue(
    request.headers.authorization ?? request.headers.Authorization
  );
  const transport = headerValue(request.query?.transport);

  if (transport === 'marketplace-payment-intent') {
    try {
      const result = await createMarketplacePaymentIntent(
        authorization,
        request.body
      );
      response.status(result.status).json(result.body);
    } catch (error) {
      const mapped = mapMarketplaceCheckoutError(error);
      response.status(mapped.status).json(mapped.body);
    }
    return;
  }

  try {
    if (isKyrubActionReceiptVerificationRequest(request.body)) {
      const verification = await verifyAuthorizedKyrubActionReceipt(
        authorization,
        request.body
      );
      response.status(200).json(verification);
      return;
    }

    if (isKyrubInventoryAdjustmentExecutionRequest(request.body)) {
      const inventory = await executeAuthorizedKyrubInventoryAdjustment(
        authorization,
        request.body
      );
      response.status(200).json(inventory);
      return;
    }

    if (isKyrubProductCompositionExecutionRequest(request.body)) {
      const composition = await executeAuthorizedKyrubProductComposition(
        authorization,
        request.body
      );
      response.status(200).json(composition);
      return;
    }

    if (
      isKyrubCatalogImportExecutionRequest(request.body) ||
      isKyrubCatalogDraftListRequest(request.body) ||
      isKyrubCatalogDraftExecutionRequest(request.body) ||
      isKyrubCatalogProductUpdateRequest(request.body) ||
      isKyrubCatalogProductPublicationRequest(request.body)
    ) {
      await ensureCanonicalStoreForCatalog(authorization);
    }

    if (isKyrubCatalogImportExecutionRequest(request.body)) {
      const imported = await executeAuthorizedKyrubCatalogImport(
        authorization,
        request.body
      );
      response.status(200).json(imported);
      return;
    }

    if (isKyrubCatalogDraftListRequest(request.body)) {
      const drafts = await listAuthorizedKyrubCatalogDrafts(authorization);
      response.status(200).json(drafts);
      return;
    }

    if (isKyrubCatalogDraftExecutionRequest(request.body)) {
      const draft = await executeAuthorizedKyrubCatalogDraft(
        authorization,
        request.body
      );
      response.status(200).json(draft);
      return;
    }

    if (isKyrubCatalogProductUpdateRequest(request.body)) {
      const updated = await updateAuthorizedKyrubCatalogProduct(
        authorization,
        request.body
      );
      response.status(200).json(updated);
      return;
    }

    if (isKyrubCatalogProductPublicationRequest(request.body)) {
      await reconcileStoreEntitlementFromAuthorization(authorization);
      await hydrateExecutablePlanCatalog();
      const publication = await setAuthorizedKyrubCatalogProductPublication(
        authorization,
        request.body
      );
      response.status(200).json(publication);
      return;
    }

    await reconcileStoreEntitlementFromAuthorization(authorization);
    await hydrateExecutablePlanCatalog();
    const result = await executeAuthorizedKyrubAction(
      authorization,
      request.body
    );
    response.status(200).json(result);
  } catch (error) {
    const mapped = mapKyrubActionExecutionError(error);
    response.status(mapped.status).json(mapped.body);
  }
}
