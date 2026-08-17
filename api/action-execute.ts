import { executeAuthorizedKyrubAction } from '../server/actions/actionExecutionFacade.js';
import { mapKyrubActionExecutionError } from '../server/actions/actionExecutionService.js';
import {
  executeAuthorizedKyrubCatalogDraft,
  isKyrubCatalogDraftExecutionRequest,
  isKyrubCatalogDraftListRequest,
  isKyrubCatalogProductPublicationRequest,
  listAuthorizedKyrubCatalogDrafts,
  setAuthorizedKyrubCatalogProductPublication,
} from '../server/actions/catalogProductLifecycleService.js';
import {
  executeAuthorizedKyrubCatalogImport,
  isKyrubCatalogImportExecutionRequest,
} from '../server/actions/catalogImportExecutionService.js';
import { ensureCanonicalStoreForCatalog } from '../server/actions/canonicalStoreRepairService.js';
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

    if (isKyrubActionReceiptVerificationRequest(request.body)) {
      const verification = await verifyAuthorizedKyrubActionReceipt(
        authorization,
        request.body
      );
      response.status(200).json(verification);
      return;
    }

    // Catalog operations repair the private -> canonical store link first. This
    // keeps configured legacy stores usable without resurrecting a store that
    // was intentionally reset, because the repair service requires meaningful
    // private store setup before linking or creating a canonical registry.
    if (
      isKyrubCatalogImportExecutionRequest(request.body) ||
      isKyrubCatalogDraftListRequest(request.body) ||
      isKyrubCatalogDraftExecutionRequest(request.body) ||
      isKyrubCatalogProductPublicationRequest(request.body)
    ) {
      await ensureCanonicalStoreForCatalog(authorization);
    }

    // Unpublished products do not consume published-product capacity. Catalog
    // analysis imports therefore execute before entitlement reconciliation.
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
