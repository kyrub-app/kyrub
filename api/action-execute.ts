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

type HttpErrorResult = {
  status: number;
  body: unknown;
};

const headerValue = (value: HeaderValue | QueryValue): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : String(value ?? '').trim();

const genericUnavailable = (message: string): HttpErrorResult => ({
  status: 503,
  body: { error: message },
});

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
    let mapError: ((error: unknown) => HttpErrorResult) | null = null;
    try {
      const [paymentRouter, checkoutBridge] = await Promise.all([
        import('../server/payments/paymentIntentRouter.js'),
        import('../server/payments/mercadoPagoCheckoutBridge.js'),
      ]);
      mapError = paymentRouter.mapMarketplaceCheckoutError;
      const result = await paymentRouter.createMarketplacePaymentIntent(
        authorization,
        request.body
      );
      const body = request.body && typeof request.body === 'object'
        ? request.body as Record<string, unknown>
        : {};
      const pix = await checkoutBridge.attachMercadoPagoPixToExistingIntent({
        storeId: clean(body.storeId),
        paymentIntentId: result.body.paymentIntentId,
        paymentId: result.body.paymentId,
        expiresAt: result.body.expiresAt,
      });
      response.status(result.status).json({
        ...result.body,
        ...pix,
      });
    } catch (error) {
      const mapped = mapError
        ? mapError(error)
        : genericUnavailable('Não foi possível iniciar o pagamento agora.');
      response.status(mapped.status).json(mapped.body);
    }
    return;
  }

  if (transport === 'mercado-pago-webhook') {
    let mapError: ((error: unknown) => HttpErrorResult) | null = null;
    try {
      const webhook = await import('../server/payments/mercadoPagoWebhook.js');
      mapError = webhook.mapMercadoPagoWebhookError;
      const body = request.body as { data?: { id?: unknown } } | undefined;
      const dataId =
        headerValue(request.query?.['data.id']) || clean(body?.data?.id);
      const result = await webhook.processMercadoPagoWebhook({
        headers: request.headers,
        dataId,
      });
      response.status(200).json(result);
    } catch (error) {
      const mapped = mapError
        ? mapError(error)
        : genericUnavailable('Não foi possível processar a notificação.');
      response.status(mapped.status).json(mapped.body);
    }
    return;
  }

  let mapActionError: ((error: unknown) => HttpErrorResult) | null = null;
  try {
    const [
      actionFacade,
      actionService,
      catalogLifecycle,
      catalogImport,
      inventoryAdjustment,
      productComposition,
      canonicalStoreRepair,
      receiptVerification,
      executablePlanCatalog,
      entitlementLifecycle,
    ] = await Promise.all([
      import('../server/actions/actionExecutionFacade.js'),
      import('../server/actions/actionExecutionService.js'),
      import('../server/actions/catalogProductLifecycleService.js'),
      import('../server/actions/catalogImportExecutionService.js'),
      import('../server/actions/inventoryAdjustmentExecutionService.js'),
      import('../server/actions/productCompositionExecutionService.js'),
      import('../server/actions/canonicalStoreRepairService.js'),
      import('../server/actions/actionReceiptVerificationService.js'),
      import('../server/admin/executablePlanCatalogService.js'),
      import('../server/admin/storeEntitlementLifecycleService.js'),
    ]);
    mapActionError = actionService.mapKyrubActionExecutionError;

    if (receiptVerification.isKyrubActionReceiptVerificationRequest(request.body)) {
      const verification = await receiptVerification.verifyAuthorizedKyrubActionReceipt(
        authorization,
        request.body
      );
      response.status(200).json(verification);
      return;
    }

    if (inventoryAdjustment.isKyrubInventoryAdjustmentExecutionRequest(request.body)) {
      const inventory = await inventoryAdjustment.executeAuthorizedKyrubInventoryAdjustment(
        authorization,
        request.body
      );
      response.status(200).json(inventory);
      return;
    }

    if (productComposition.isKyrubProductCompositionExecutionRequest(request.body)) {
      const composition = await productComposition.executeAuthorizedKyrubProductComposition(
        authorization,
        request.body
      );
      response.status(200).json(composition);
      return;
    }

    if (
      catalogImport.isKyrubCatalogImportExecutionRequest(request.body) ||
      catalogLifecycle.isKyrubCatalogDraftListRequest(request.body) ||
      catalogLifecycle.isKyrubCatalogDraftExecutionRequest(request.body) ||
      catalogLifecycle.isKyrubCatalogProductUpdateRequest(request.body) ||
      catalogLifecycle.isKyrubCatalogProductPublicationRequest(request.body)
    ) {
      await canonicalStoreRepair.ensureCanonicalStoreForCatalog(authorization);
    }

    if (catalogImport.isKyrubCatalogImportExecutionRequest(request.body)) {
      const imported = await catalogImport.executeAuthorizedKyrubCatalogImport(
        authorization,
        request.body
      );
      response.status(200).json(imported);
      return;
    }

    if (catalogLifecycle.isKyrubCatalogDraftListRequest(request.body)) {
      const drafts = await catalogLifecycle.listAuthorizedKyrubCatalogDrafts(authorization);
      response.status(200).json(drafts);
      return;
    }

    if (catalogLifecycle.isKyrubCatalogDraftExecutionRequest(request.body)) {
      const draft = await catalogLifecycle.executeAuthorizedKyrubCatalogDraft(
        authorization,
        request.body
      );
      response.status(200).json(draft);
      return;
    }

    if (catalogLifecycle.isKyrubCatalogProductUpdateRequest(request.body)) {
      const updated = await catalogLifecycle.updateAuthorizedKyrubCatalogProduct(
        authorization,
        request.body
      );
      response.status(200).json(updated);
      return;
    }

    if (catalogLifecycle.isKyrubCatalogProductPublicationRequest(request.body)) {
      await entitlementLifecycle.reconcileStoreEntitlementFromAuthorization(authorization);
      await executablePlanCatalog.hydrateExecutablePlanCatalog();
      const publication = await catalogLifecycle.setAuthorizedKyrubCatalogProductPublication(
        authorization,
        request.body
      );
      response.status(200).json(publication);
      return;
    }

    await entitlementLifecycle.reconcileStoreEntitlementFromAuthorization(authorization);
    await executablePlanCatalog.hydrateExecutablePlanCatalog();
    const result = await actionFacade.executeAuthorizedKyrubAction(
      authorization,
      request.body
    );
    response.status(200).json(result);
  } catch (error) {
    const mapped = mapActionError
      ? mapActionError(error)
      : genericUnavailable('Não foi possível executar a ação agora.');
    response.status(mapped.status).json(mapped.body);
  }
}
