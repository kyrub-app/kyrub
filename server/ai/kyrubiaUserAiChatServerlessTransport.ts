import { randomUUID } from 'node:crypto';
import type {
  KyrubErpContextSnapshot,
  KyrubErpProductSummary,
} from '../../shared/kyrubErpContext.js';
import { resolveKyrubiaDeterministicErpRead } from '../../shared/kyrubiaDeterministicErp.js';
import { adminDb } from '../firebaseAdmin.js';
import { authenticateConsultantRequest } from './consultantAuth.js';
import { executeAuthorizedKyrubiaUserProviderChat } from './kyrubiaUserProviderChatService.js';

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

const MAX_PRODUCTS_IN_CONTEXT = 120;

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

const looksLikeCatalogCategoryRead = (message: string): boolean => {
  const normalized = message
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const mentionsProducts =
    /\b(produto|produtos|item|itens|mercadoria|mercadorias|artigo|artigos|catalogo)\b/.test(normalized);
  const mentionsCategory = /\bcategoria\b/.test(normalized);
  const asksRead =
    /\b(quais|qual|liste|listar|mostre|mostrar|encontre|encontrar|tenho|tem|existem|existe|quantos|quantas)\b/.test(normalized);
  const mutation =
    /\b(crie|criar|cadastre|cadastrar|adicione|adicionar|altere|alterar|mude|mudar|renomeie|renomear|publique|publicar|exclua|excluir)\b/.test(normalized);

  return mentionsProducts && mentionsCategory && asksRead && !mutation;
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
): Promise<{ available: boolean; products: KyrubErpProductSummary[] }> => {
  const snapshot = await adminDb.doc(`tenants/${uid}`).get();
  if (!snapshot.exists) return { available: true, products: [] };
  const data = snapshot.data() as Record<string, unknown>;
  const rawProducts = Array.isArray(data.publicProducts) ? data.publicProducts : [];
  return {
    available: true,
    products: rawProducts.flatMap(value => {
      const product = productSummary(value);
      return product ? [product] : [];
    }),
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
  uid: string
): Promise<KyrubErpContextSnapshot> => {
  const warnings: string[] = [];
  let legacyAvailable = false;
  let canonicalAvailable = false;
  let legacyProducts: KyrubErpProductSummary[] = [];
  let canonicalProducts: CanonicalProductCandidate[] = [];

  try {
    const legacy = await readLegacyProducts(uid);
    legacyAvailable = legacy.available;
    legacyProducts = legacy.products;
  } catch (error) {
    warnings.push('O espelho legado do catálogo não pôde ser consultado.');
    console.warn(
      '[kyrubia-authoritative-catalog] legacy read failed',
      error instanceof Error ? error.message : 'unknown'
    );
  }

  let canonicalStore: CanonicalStoreCandidate | null = null;
  try {
    canonicalStore = await findCanonicalStoreForOwner(uid);
    if (canonicalStore) {
      canonicalProducts = await readCanonicalProducts(canonicalStore.id);
      canonicalAvailable = true;
    }
  } catch (error) {
    warnings.push('O catálogo canônico não pôde ser consultado.');
    console.warn(
      '[kyrubia-authoritative-catalog] canonical read failed',
      error instanceof Error ? error.message : 'unknown'
    );
  }

  if (!legacyAvailable && !canonicalAvailable) {
    throw new Error('AUTHORITATIVE_CATALOG_UNAVAILABLE');
  }

  const mergedProducts = mergeCatalogProducts(legacyProducts, canonicalProducts);
  const productsTruncated = mergedProducts.length > MAX_PRODUCTS_IN_CONTEXT;
  const products = mergedProducts.slice(0, MAX_PRODUCTS_IN_CONTEXT);

  return {
    source: 'authenticated_client_snapshot',
    generatedAt: new Date().toISOString(),
    store: null,
    products,
    productCount: mergedProducts.length,
    productsTruncated,
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

const deterministicResponse = (
  reply: string,
  turnContext?: ReturnType<typeof resolveKyrubiaDeterministicErpRead> extends infer Result
    ? Result extends { turnContext?: infer TurnContext }
      ? TurnContext
      : never
    : never
): Record<string, unknown> => ({
  status: 'deterministic',
  reply,
  provider: 'kyrub',
  model: 'kyrub-runtime-v1',
  mode: 'deterministic',
  requestId: randomUUID(),
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

const deterministicCatalogRead = async (
  authorization: string,
  input: unknown
): Promise<Record<string, unknown> | null> => {
  const message = latestUserMessage(input);
  if (!message || !looksLikeCatalogCategoryRead(message)) return null;

  const user = await authenticateConsultantRequest(authorization);
  let context: KyrubErpContextSnapshot;
  try {
    context = await authoritativeCatalogContext(user.uid);
  } catch (error) {
    console.error(
      '[kyrubia-authoritative-catalog] category read unavailable',
      error instanceof Error ? error.message : 'unknown'
    );
    return deterministicResponse(
      'Não consegui consultar o catálogo da sua loja nesta solicitação. Tente novamente em instantes.'
    );
  }

  const resolved = resolveKyrubiaDeterministicErpRead(message, context);
  if (!resolved) {
    return deterministicResponse(
      'Entendi que você quer consultar produtos por categoria, mas não consegui identificar o filtro de categoria com segurança. Informe apenas o nome da categoria e eu consulto o catálogo da sua loja.'
    );
  }

  return deterministicResponse(resolved.reply, resolved.turnContext);
};

export const handleKyrubiaUserAiChatServerlessRequest = async (
  request: RequestLike,
  response: ResponseLike
): Promise<void> => {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');

  if ((request.method?.toUpperCase() || 'GET') !== 'POST') {
    response.status(405).json({
      error: 'Método não permitido.',
      code: 'METHOD_NOT_ALLOWED',
    });
    return;
  }

  const authorization = headerValue(
    request.headers.authorization ?? request.headers.Authorization
  );

  const deterministic = await deterministicCatalogRead(
    authorization,
    request.body
  );
  if (deterministic) {
    response.status(200).json(deterministic);
    return;
  }

  const result = await executeAuthorizedKyrubiaUserProviderChat(
    authorization,
    request.body
  );
  response.status(result.httpStatus).json(result.body);
};