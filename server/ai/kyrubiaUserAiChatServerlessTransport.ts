import { randomUUID } from 'node:crypto';
import type {
  KyrubErpContextSnapshot,
  KyrubErpProductSummary,
} from '../../shared/kyrubErpContext.js';
import { resolveKyrubiaDeterministicErpRead } from '../../shared/kyrubiaDeterministicErp.js';
import { routeKyrubiaLocalProductIntent } from '../../shared/kyrubiaIntentRouter.js';
import { adminDb } from '../firebaseAdmin.js';
import { authenticateConsultantRequest } from './consultantAuth.js';

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

type CanonicalStoreCandidate = {
  id: string;
  data: Record<string, unknown>;
};

type CanonicalProductCandidate = {
  id: string;
  data: Record<string, unknown>;
  archived: boolean;
};

type LegacyCatalogSource = {
  available: boolean;
  products: KyrubErpProductSummary[];
  canonicalStoreId: string;
};

const MAX_PRODUCTS_IN_CLIENT_CONTEXT = 120;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const cleanText = (value: unknown, maximum: number): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const finiteNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const headerValue = (value: HeaderValue): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

const safeTraceIdentifier = (value: unknown): string => {
  const cleaned = cleanText(value, 160);
  return /^[a-zA-Z0-9:_-]{1,160}$/.test(cleaned) ? cleaned : '';
};

const releaseIdentifier = (): string =>
  process.env.KYRUB_RELEASE?.trim()
  || process.env.VERCEL_GIT_COMMIT_SHA?.trim().slice(0, 12)
  || process.env.npm_package_version?.trim()
  || 'development';

const requestTraceId = (request: RequestLike): string =>
  safeTraceIdentifier(
    headerValue(
      request.headers['x-kyrub-request-id']
      ?? request.headers['X-Kyrub-Request-Id']
    )
  ) || randomUUID();

const setDiagnosticHeaders = (
  response: ResponseLike,
  traceId: string,
  decision: string
): void => {
  response.setHeader('X-Kyrub-Release', releaseIdentifier());
  response.setHeader('X-Kyrub-Request-Id', traceId);
  response.setHeader('X-Kyrub-Route', 'kyrubia-user-ai-chat');
  response.setHeader('X-Kyrub-Decision', decision);
};

const logDecision = (
  traceId: string,
  details: Record<string, unknown>
): void => {
  console.info('[kyrubia-chat-route]', JSON.stringify({
    requestId: traceId,
    release: releaseIdentifier(),
    ...details,
  }));
};

const latestUserMessage = (input: unknown): string => {
  const body = record(input);
  if (!Array.isArray(body.messages)) return '';
  for (let index = body.messages.length - 1; index >= 0; index -= 1) {
    const message = record(body.messages[index]);
    if (message.role !== 'user') continue;
    return cleanText(message.content, 4_000);
  }
  return '';
};

const productSummary = (
  value: unknown,
  fallbackId = ''
): KyrubErpProductSummary | null => {
  const product = record(value);
  const id = cleanText(product.id, 160) || cleanText(fallbackId, 160);
  const name = cleanText(product.name, 180);
  if (!id || !name) return null;

  const rawPrice = finiteNumber(product.price, 0);
  const rawStock = finiteNumber(product.stock, 0);
  return {
    id,
    name,
    category: cleanText(product.category, 160),
    price: Math.max(0, rawPrice),
    stock: Math.max(0, Math.trunc(rawStock)),
    isService: product.isService === true,
    hasDescription: Boolean(cleanText(product.description, 1)),
    hasImage: Boolean(
      cleanText(product.image, 1) ||
      (Array.isArray(product.images) && product.images.some(image => Boolean(cleanText(image, 1))))
    ),
  };
};

const clientCatalogContext = (input: unknown): KyrubErpContextSnapshot | null => {
  const body = record(input);
  const rawContext = record(body.erpContext);
  const availability = record(rawContext.availability);
  if (availability.products !== true || !Array.isArray(rawContext.products)) {
    return null;
  }

  const allProducts = rawContext.products.flatMap(value => {
    const product = productSummary(value);
    return product ? [product] : [];
  });
  const productCount = Math.max(
    allProducts.length,
    Math.trunc(finiteNumber(rawContext.productCount, allProducts.length))
  );
  const products = allProducts.slice(0, MAX_PRODUCTS_IN_CLIENT_CONTEXT);

  return {
    source: 'authenticated_client_snapshot',
    generatedAt: cleanText(rawContext.generatedAt, 80) || new Date().toISOString(),
    store: null,
    products,
    productCount,
    productsTruncated: rawContext.productsTruncated === true || productCount > products.length,
    pendingOrders: [],
    pendingOrderCount: 0,
    ordersTruncated: false,
    lowStockThreshold: Math.max(0, finiteNumber(rawContext.lowStockThreshold, 5)),
    availability: {
      store: false,
      products: true,
      orders: false,
    },
    warnings: ['Catálogo respondido a partir do snapshot autenticado já carregado no aplicativo.'],
  };
};

const deterministicResponse = (
  reply: string,
  turnContext?: ReturnType<typeof resolveKyrubiaDeterministicErpRead> extends infer Result
    ? Result extends { turnContext?: infer TurnContext }
      ? TurnContext
      : never
    : never,
  requestId: string = randomUUID()
): Record<string, unknown> => ({
  status: 'deterministic',
  reply,
  provider: 'kyrub',
  model: 'kyrub-runtime-v1',
  mode: 'deterministic',
  requestId,
  ...(turnContext ? { turnContext } : {}),
  capabilities: {
    actionsEnabled: true,
    enabledActions: ['create_note'],
    enabledReadActions: [
      'read_store_summary',
      'list_products',
      'list_low_stock_products',
      'list_pending_orders',
    ],
    voiceEnabled: false,
    persistentCloudHistoryEnabled: false,
    multimodalAttachmentsEnabled: false,
    providerResilienceEnabled: false,
    usageMeteringEnabled: true,
  },
  funding: 'none',
  usage: {},
});

const resolveClientCatalogRead = (
  message: string,
  input: unknown,
  traceId: string
): Record<string, unknown> | null => {
  const context = clientCatalogContext(input);
  if (!context) return null;
  const resolved = resolveKyrubiaDeterministicErpRead(message, context);
  return resolved
    ? deterministicResponse(resolved.reply, resolved.turnContext, traceId)
    : null;
};

const isTransientAuthUnavailable = (error: unknown): boolean => {
  const candidate = record(error);
  return candidate.status === 503 && candidate.code === 'AUTH_UNAVAILABLE';
};

const findCanonicalStoreForOwner = async (
  uid: string
): Promise<CanonicalStoreCandidate | null> => {
  const snapshot = await adminDb.collection('stores').where('ownerId', '==', uid).get();
  const matches = snapshot.docs
    .map(document => ({
      id: document.id,
      data: document.data() as Record<string, unknown>,
    }))
    .filter(store =>
      store.data.legacyTenantId === uid ||
      (!cleanText(store.data.legacyTenantId, 160) && store.data.ownerId === uid)
    );

  if (matches.length > 1) {
    throw new Error('STORE_IDENTITY_CONFLICT');
  }
  return matches[0] ?? null;
};

const readLegacyProducts = async (
  uid: string
): Promise<LegacyCatalogSource> => {
  const snapshot = await adminDb.doc(`tenants/${uid}`).get();
  if (!snapshot.exists) {
    return { available: true, products: [], canonicalStoreId: '' };
  }
  const data = snapshot.data() as Record<string, unknown>;
  const rawProducts = Array.isArray(data.publicProducts) ? data.publicProducts : [];
  return {
    available: true,
    products: rawProducts.flatMap(value => {
      const product = productSummary(value);
      return product ? [product] : [];
    }),
    canonicalStoreId: cleanText(data.canonicalStoreId, 160),
  };
};

const readCanonicalProducts = async (
  storeId: string
): Promise<CanonicalProductCandidate[]> => {
  const snapshot = await adminDb.collection(`stores/${storeId}/products`).get();
  return snapshot.docs.flatMap(document => {
    const data = document.data() as Record<string, unknown>;
    const id = cleanText(data.id, 160) || document.id;
    if (!id) return [];
    return [{
      id,
      data,
      archived: data.publicationStatus === 'archived',
    }];
  });
};

const mergeCatalogProducts = (
  legacyProducts: KyrubErpProductSummary[],
  canonicalProducts: CanonicalProductCandidate[]
): KyrubErpProductSummary[] => {
  const productsById = new Map(
    legacyProducts.map(product => [product.id, product] as const)
  );

  for (const canonical of canonicalProducts) {
    if (canonical.archived) {
      productsById.delete(canonical.id);
      continue;
    }
    const product = productSummary(canonical.data, canonical.id);
    if (product) productsById.set(product.id, product);
  }

  return [...productsById.values()]
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
};

const authoritativeCatalogContext = async (
  uid: string,
  traceId: string
): Promise<KyrubErpContextSnapshot> => {
  const warnings: string[] = [];
  let legacyAvailable = false;
  let canonicalAvailable = false;
  let legacyProducts: KyrubErpProductSummary[] = [];
  let canonicalProducts: CanonicalProductCandidate[] = [];
  let canonicalStoreId = '';

  try {
    const legacy = await readLegacyProducts(uid);
    legacyAvailable = legacy.available;
    legacyProducts = legacy.products;
    canonicalStoreId = legacy.canonicalStoreId;
  } catch (error) {
    warnings.push('O espelho legado do catálogo não pôde ser consultado.');
    console.warn(
      '[kyrubia-authoritative-catalog] legacy read failed',
      JSON.stringify({
        requestId: traceId,
        error: error instanceof Error ? error.message : 'unknown',
      })
    );
  }

  try {
    if (!canonicalStoreId) {
      const canonicalStore = await findCanonicalStoreForOwner(uid);
      canonicalStoreId = canonicalStore?.id ?? '';
    }
    if (canonicalStoreId) {
      canonicalProducts = await readCanonicalProducts(canonicalStoreId);
      canonicalAvailable = true;
    }
  } catch (error) {
    warnings.push('O catálogo canônico não pôde ser consultado.');
    console.warn(
      '[kyrubia-authoritative-catalog] canonical read failed',
      JSON.stringify({
        requestId: traceId,
        error: error instanceof Error ? error.message : 'unknown',
      })
    );
  }

  if (!legacyAvailable && !canonicalAvailable) {
    throw new Error('AUTHORITATIVE_CATALOG_UNAVAILABLE');
  }

  const mergedProducts = mergeCatalogProducts(legacyProducts, canonicalProducts);
  logDecision(traceId, {
    stage: 'catalog_loaded',
    legacyAvailable,
    canonicalAvailable,
    canonicalStoreMapped: Boolean(canonicalStoreId),
    legacyProductCount: legacyProducts.length,
    canonicalProductCount: canonicalProducts.length,
    mergedProductCount: mergedProducts.length,
  });

  return {
    source: 'authenticated_client_snapshot',
    generatedAt: new Date().toISOString(),
    store: null,
    products: mergedProducts,
    productCount: mergedProducts.length,
    productsTruncated: false,
    pendingOrders: [],
    pendingOrderCount: 0,
    ordersTruncated: false,
    lowStockThreshold: 5,
    availability: {
      store: false,
      products: true,
      orders: false,
    },
    warnings,
  };
};

const deterministicOperationalRead = async (
  authorization: string,
  input: unknown,
  traceId: string
): Promise<Record<string, unknown> | null> => {
  const message = latestUserMessage(input);
  if (!message) return null;

  const intent = routeKyrubiaLocalProductIntent(message);
  if (!intent) return null;

  logDecision(traceId, {
    stage: 'intent_classified',
    decision: 'operational_product_read',
    kind: intent.kind,
    matchedConcepts: intent.matchedConcepts,
  });

  let user: Awaited<ReturnType<typeof authenticateConsultantRequest>>;
  try {
    user = await authenticateConsultantRequest(authorization);
  } catch (error) {
    console.error(
      '[kyrubia-authoritative-catalog] authentication failed',
      JSON.stringify({
        requestId: traceId,
        code: record(error).code ?? (error instanceof Error ? error.message : 'unknown'),
      })
    );
    if (isTransientAuthUnavailable(error)) {
      const clientResolved = resolveClientCatalogRead(message, input, traceId);
      if (clientResolved) {
        logDecision(traceId, {
          stage: 'resolved',
          decision: 'operational_product_read',
          source: 'client_snapshot_after_auth_unavailable',
          kind: intent.kind,
        });
        return clientResolved;
      }
      return deterministicResponse(
        'Identifiquei que esta é uma consulta operacional da sua loja, mas não consegui acessar o catálogo agora. Tente novamente em instantes.',
        undefined,
        traceId
      );
    }
    throw error;
  }

  let context: KyrubErpContextSnapshot;
  try {
    context = await authoritativeCatalogContext(user.uid, traceId);
  } catch (error) {
    console.error(
      '[kyrubia-authoritative-catalog] operational read unavailable',
      JSON.stringify({
        requestId: traceId,
        error: error instanceof Error ? error.message : 'unknown',
      })
    );
    const clientResolved = resolveClientCatalogRead(message, input, traceId);
    if (clientResolved) {
      logDecision(traceId, {
        stage: 'resolved',
        decision: 'operational_product_read',
        source: 'client_snapshot_after_catalog_unavailable',
        kind: intent.kind,
      });
      return clientResolved;
    }
    return deterministicResponse(
      'Identifiquei que esta é uma consulta operacional da sua loja, mas não consegui acessar o catálogo agora. Tente novamente em instantes.',
      undefined,
      traceId
    );
  }

  const resolved = resolveKyrubiaDeterministicErpRead(message, context);
  if (!resolved) {
    const clientResolved = resolveClientCatalogRead(message, input, traceId);
    if (clientResolved) {
      logDecision(traceId, {
        stage: 'resolved',
        decision: 'operational_product_read',
        source: 'client_snapshot_after_parser_miss',
        kind: intent.kind,
      });
      return clientResolved;
    }
    return deterministicResponse(
      'Entendi que você quer consultar os produtos da sua loja, mas não consegui interpretar o filtro com segurança. Reformule a consulta informando o critério desejado.',
      undefined,
      traceId
    );
  }

  logDecision(traceId, {
    stage: 'resolved',
    decision: 'operational_product_read',
    source: 'authoritative_catalog',
    kind: intent.kind,
    action: resolved.action,
  });
  return deterministicResponse(resolved.reply, resolved.turnContext, traceId);
};

export const handleKyrubiaUserAiChatServerlessRequest = async (
  request: RequestLike,
  response: ResponseLike
): Promise<void> => {
  const traceId = requestTraceId(request);
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  setDiagnosticHeaders(response, traceId, 'route_entered');

  if ((request.method?.toUpperCase() || 'GET') !== 'POST') {
    setDiagnosticHeaders(response, traceId, 'method_not_allowed');
    response.status(405).json({
      error: 'Método não permitido.',
      code: 'METHOD_NOT_ALLOWED',
      requestId: traceId,
    });
    return;
  }

  const authorization = headerValue(
    request.headers.authorization ?? request.headers.Authorization
  );

  const deterministic = await deterministicOperationalRead(
    authorization,
    request.body,
    traceId
  );
  if (deterministic) {
    setDiagnosticHeaders(response, traceId, 'operational_product_read');
    response.status(200).json(deterministic);
    return;
  }

  setDiagnosticHeaders(response, traceId, 'provider_chat');
  logDecision(traceId, {
    stage: 'delegated',
    decision: 'provider_chat',
  });
  const providerChat = await import('./kyrubiaUserProviderChatService.js');
  const result = await providerChat.executeAuthorizedKyrubiaUserProviderChat(
    authorization,
    request.body
  );
  logDecision(traceId, {
    stage: 'provider_result',
    decision: 'provider_chat',
    httpStatus: result.httpStatus,
    status: record(result.body).status ?? '',
    code: record(result.body).code ?? '',
  });
  response.status(result.httpStatus).json(result.body);
};