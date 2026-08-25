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

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const safePublicId = (value: unknown): string => {
  const id = clean(value);
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id) ? id : '';
};

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

  if (transport === 'kyrubia-user-ai-chat') {
    try {
      const chat = await import('../server/ai/kyrubiaUserProviderChatService.js');
      const result = await chat.executeAuthorizedKyrubiaUserProviderChat(
        authorization,
        request.body
      );
      response.status(result.httpStatus).json(result.body);
    } catch (error) {
      const vault = await import('../server/ai/userAiProviderCredentialService.js');
      const mapped = vault.mapUserAiProviderCredentialError(error);
      response.status(mapped.status).json(mapped.body);
    }
    return;
  }

  if (transport === 'kyrubia-user-ai-provider') {
    const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
      ? request.body as Record<string, unknown>
      : {};
    try {
      const [vault, preference] = await Promise.all([
        import('../server/ai/userAiProviderCredentialService.js'),
        import('../server/ai/userAiProviderPreferenceService.js'),
      ]);
      const operation = clean(body.operation);
      if (operation === 'list') {
        const [providers, routing] = await Promise.all([
          vault.listAuthorizedUserAiProviderCredentials(authorization),
          preference.getAuthorizedUserAiProviderPreference(authorization),
        ]);
        response.status(200).json({
          ...providers,
          preferredProvider: routing.preferredProvider,
          ...(routing.updatedAt ? { preferenceUpdatedAt: routing.updatedAt } : {}),
        });
        return;
      }
      if (operation === 'save') {
        response.status(200).json(
          await vault.saveAuthorizedUserAiProviderCredential(authorization, {
            provider: body.provider,
            apiKey: body.apiKey,
          })
        );
        return;
      }
      if (operation === 'test') {
        response.status(200).json(
          await vault.testAuthorizedUserAiProviderCredential(
            authorization,
            body.provider
          )
        );
        return;
      }
      if (operation === 'set_preference') {
        response.status(200).json(
          await preference.saveAuthorizedUserAiProviderPreference(
            authorization,
            body.preferredProvider
          )
        );
        return;
      }
      if (operation === 'delete') {
        response.status(200).json(
          await vault.deleteAuthorizedUserAiProviderCredential(
            authorization,
            body.provider
          )
        );
        return;
      }
      response.status(400).json({
        error: 'Operação de integração de IA inválida.',
        code: 'AI_PROVIDER_OPERATION_INVALID',
      });
    } catch (error) {
      const vault = await import('../server/ai/userAiProviderCredentialService.js');
      const mapped = vault.mapUserAiProviderCredentialError(error);
      response.status(mapped.status).json(mapped.body);
    }
    return;
  }

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

  if (transport === 'storefront-availability') {
    const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
      ? request.body as Record<string, unknown>
      : {};
    const storeId = safePublicId(body.storeId);
    if (!storeId) {
      response.status(400).json({
        error: 'Loja inválida.',
        code: 'INVALID_STORE_ID',
      });
      return;
    }

    try {
      const [firebaseAdmin, inventory] = await Promise.all([
        import('../server/firebaseAdmin.js'),
        import('../shared/inventoryConsumption.js'),
      ]);
      const tenantRef = firebaseAdmin.adminDb.doc(`tenants/${storeId}`);
      const inventoryRef = firebaseAdmin.adminDb.doc(
        `users/${storeId}/private_store/inventory`
      );
      const [tenantSnapshot, inventorySnapshot] = await Promise.all([
        tenantRef.get(),
        inventoryRef.get(),
      ]);

      if (!tenantSnapshot.exists) {
        response.status(404).json({
          error: 'Loja não encontrada.',
          code: 'STORE_NOT_FOUND',
        });
        return;
      }

      const tenantData = tenantSnapshot.data();
      const inventoryData = inventorySnapshot.data();
      const publicProducts = Array.isArray(tenantData?.publicProducts)
        ? tenantData.publicProducts
        : [];
      const stockByProductId: Record<string, number> = {};

      if (inventorySnapshot.exists && publicProducts.length > 0) {
        const catalog = inventory.parseInventoryCatalogRecords(
          inventoryData?.inventoryCatalog ?? inventoryData?.catalog
        );
        const compositions = inventory.parseInventoryCompositionRecords(
          inventoryData?.compositions ?? inventoryData?.productCompositions
        );

        for (const candidate of publicProducts) {
          if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
            continue;
          }
          const product = candidate as Record<string, unknown>;
          if (product.isService === true) continue;
          const productId = safePublicId(product.id);
          if (!productId) continue;
          const available = inventory.calculateCompositionAvailableStock(
            catalog,
            compositions[productId]
          );
          if (available !== null) {
            stockByProductId[productId] = available;
          }
        }
      }

      response.status(200).json({ storeId, stockByProductId });
    } catch (error) {
      console.error('[StorefrontAvailability] read failed.', error);
      response.status(503).json({
        error: 'Não foi possível consultar a disponibilidade da vitrine agora.',
        code: 'STOREFRONT_AVAILABILITY_UNAVAILABLE',
      });
    }
    return;
  }

  const rawBody = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
    ? request.body as Record<string, unknown>
    : null;
  const rawProposal = rawBody?.proposal && typeof rawBody.proposal === 'object' && !Array.isArray(rawBody.proposal)
    ? rawBody.proposal as Record<string, unknown>
    : null;

  if (rawProposal?.type === 'adjust_inventory') {
    let mapError: ((error: unknown) => HttpErrorResult) | null = null;
    try {
      const [inventoryAdjustment, actionService] = await Promise.all([
        import('../server/actions/inventoryAdjustmentExecutionService.js'),
        import('../server/actions/actionExecutionService.js'),
      ]);
      mapError = actionService.mapKyrubActionExecutionError;
      if (!inventoryAdjustment.isKyrubInventoryAdjustmentExecutionRequest(request.body)) {
        response.status(400).json({
          error: 'A movimentação de estoque precisa ser revisada e confirmada.',
          code: 'INVALID_INVENTORY_ADJUSTMENT_REQUEST',
        });
        return;
      }
      const inventory = await inventoryAdjustment.executeAuthorizedKyrubInventoryAdjustment(
        authorization,
        request.body
      );
      const { reconcileDerivedProductStockForTenant } = await import(
        '../server/inventory/productStockReconciliationService.js'
      );
      await reconcileDerivedProductStockForTenant(clean(inventory.entityId));
      response.status(200).json(inventory);
    } catch (error) {
      const mapped = mapError
        ? mapError(error)
        : genericUnavailable('Não foi possível registrar a entrada de estoque agora.');
      response.status(mapped.status).json(mapped.body);
    }
    return;
  }

  if (rawProposal?.type === 'set_product_composition') {
    let mapError: ((error: unknown) => HttpErrorResult) | null = null;
    try {
      const [productComposition, actionService] = await Promise.all([
        import('../server/actions/productCompositionExecutionService.js'),
        import('../server/actions/actionExecutionService.js'),
      ]);
      mapError = actionService.mapKyrubActionExecutionError;
      if (!productComposition.isKyrubProductCompositionExecutionRequest(request.body)) {
        response.status(400).json({
          error: 'A ficha técnica precisa ser revisada e confirmada.',
          code: 'INVALID_PRODUCT_COMPOSITION_REQUEST',
        });
        return;
      }
      const composition = await productComposition.executeAuthorizedKyrubProductComposition(
        authorization,
        request.body
      );
      const token = bearerToken(authorization);
      if (token) {
        const [{ verifyFirebaseIdToken }, { reconcileDerivedProductStockForTenant }] = await Promise.all([
          import('../server/ai/consultantAuth.js'),
          import('../server/inventory/productStockReconciliationService.js'),
        ]);
        const actor = await verifyFirebaseIdToken(token);
        await reconcileDerivedProductStockForTenant(actor.uid);
      }
      response.status(200).json(composition);
    } catch (error) {
      const mapped = mapError
        ? mapError(error)
        : genericUnavailable('Não foi possível salvar a ficha técnica agora.');
      response.status(mapped.status).json(mapped.body);
    }
    return;
  }

  if (rawProposal?.type === 'transform_inventory') {
    try {
      const transformation = await import(
        '../server/inventory/inventoryTransformationExecutionService.js'
      );
      if (!transformation.isInventoryTransformationExecutionRequest(request.body)) {
        response.status(400).json({
          error: 'A transformação de estoque precisa ser revisada e confirmada.',
          code: 'INVALID_TRANSFORMATION_REQUEST',
        });
        return;
      }
      const result = await transformation.executeAuthorizedInventoryTransformation(
        authorization,
        request.body
      );
      const { reconcileDerivedProductStockForTenant } = await import(
        '../server/inventory/productStockReconciliationService.js'
      );
      await reconcileDerivedProductStockForTenant(result.entityId);
      response.status(200).json(result);
    } catch (error) {
      const transformation = await import(
        '../server/inventory/inventoryTransformationExecutionService.js'
      );
      const mapped = transformation.mapInventoryTransformationExecutionError(error);
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

    const { executeAuthorizedKyrubAction } = actionFacade;
    const { mapKyrubActionExecutionError } = actionService;
    const {
      executeAuthorizedKyrubCatalogDraft,
      isKyrubCatalogDraftExecutionRequest,
      isKyrubCatalogDraftListRequest,
      isKyrubCatalogProductPublicationRequest,
      isKyrubCatalogProductUpdateRequest,
      listAuthorizedKyrubCatalogDrafts,
      setAuthorizedKyrubCatalogProductPublication,
      updateAuthorizedKyrubCatalogProduct,
    } = catalogLifecycle;
    const {
      executeAuthorizedKyrubCatalogImport,
      isKyrubCatalogImportExecutionRequest,
    } = catalogImport;
    const {
      executeAuthorizedKyrubInventoryAdjustment,
      isKyrubInventoryAdjustmentExecutionRequest,
    } = inventoryAdjustment;
    const {
      executeAuthorizedKyrubProductComposition,
      isKyrubProductCompositionExecutionRequest,
    } = productComposition;
    const { ensureCanonicalStoreForCatalog } = canonicalStoreRepair;
    const {
      isKyrubActionReceiptVerificationRequest,
      verifyAuthorizedKyrubActionReceipt,
    } = receiptVerification;
    const { hydrateExecutablePlanCatalog } = executablePlanCatalog;
    const { reconcileStoreEntitlementFromAuthorization } = entitlementLifecycle;

    mapActionError = mapKyrubActionExecutionError;

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
      const { reconcileDerivedProductStockForTenant } = await import(
        '../server/inventory/productStockReconciliationService.js'
      );
      await reconcileDerivedProductStockForTenant(clean(inventory.entityId));
      response.status(200).json(inventory);
      return;
    }

    if (isKyrubProductCompositionExecutionRequest(request.body)) {
      const composition = await executeAuthorizedKyrubProductComposition(
        authorization,
        request.body
      );
      const token = bearerToken(authorization);
      if (token) {
        const [{ verifyFirebaseIdToken }, { reconcileDerivedProductStockForTenant }] = await Promise.all([
          import('../server/ai/consultantAuth.js'),
          import('../server/inventory/productStockReconciliationService.js'),
        ]);
        const actor = await verifyFirebaseIdToken(token);
        await reconcileDerivedProductStockForTenant(actor.uid);
      }
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
    const mapped = mapActionError
      ? mapActionError(error)
      : genericUnavailable('Não foi possível executar a ação agora.');
    response.status(mapped.status).json(mapped.body);
  }
}
