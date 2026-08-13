import { executeAuthorizedKyrubAction } from '../server/actions/actionExecutionFacade.js';
import { mapKyrubActionExecutionError } from '../server/actions/actionExecutionService.js';
import {
  executeAuthorizedKyrubCatalogDraft,
  isKyrubCatalogDraftExecutionRequest,
  isKyrubCatalogDraftListRequest,
  listAuthorizedKyrubCatalogDrafts,
} from '../server/actions/catalogDraftExecutionService.js';
import {
  isKyrubActionReceiptVerificationRequest,
  verifyAuthorizedKyrubActionReceipt,
} from '../server/actions/actionReceiptVerificationService.js';
import { hydrateExecutablePlanCatalog } from '../server/admin/executablePlanCatalogService.js';
import { reconcileStoreEntitlementFromAuthorization } from '../server/admin/storeEntitlementLifecycleService.js';

type HeaderValue = string | string[] | undefined;

type RequestLike = {
  method?: string;
  headers: Record<string, HeaderValue>;
  body?: unknown;
};

type ResponseLike = {
  setHeader(name: string, value: string): void;
  status(code: number): ResponseLike;
  json(body: unknown): void;
};

const headerValue = (value: HeaderValue): string =>
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

  try {
    const authorization = headerValue(
      request.headers.authorization ?? request.headers.Authorization
    );

    // Receipt verification is an authenticated read. It must not trigger plan
    // reconciliation or gain write authority from the execution gateway.
    if (isKyrubActionReceiptVerificationRequest(request.body)) {
      const verification = await verifyAuthorizedKyrubActionReceipt(
        authorization,
        request.body
      );
      response.status(200).json(verification);
      return;
    }

    // Catalog drafts are private staging data. Preparing or listing one never
    // publishes a product and therefore must not consume or reconcile product
    // entitlement capacity. The draft executor still authenticates the actor,
    // evaluates policy, enforces idempotency and writes an authoritative receipt.
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

    // Benefit expiry is an already-agreed entitlement boundary, not a new
    // discretionary action. Reconcile it before loading plan capacity so an
    // expired Pro/Business benefit can never authorize a published write.
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
