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

const productSummary = (value: unknown): KyrubErpProductSummary | null => {
  const product = record(value);
  const id = cleanText(product.id, 160);
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
    hasImage: Boolean(cleanText(product.image, 1)),
  };
};

const authoritativeCatalogContext = async (
  uid: string
): Promise<KyrubErpContextSnapshot> => {
  const snapshot = await adminDb.doc(`tenants/${uid}`).get();
  const data = snapshot.data() as Record<string, unknown> | undefined;
  const products = Array.isArray(data?.publicProducts)
    ? data.publicProducts
        .flatMap(value => {
          const product = productSummary(value);
          return product ? [product] : [];
        })
        .slice(0, 120)
    : [];

  return {
    source: 'authenticated_client_snapshot',
    generatedAt: new Date().toISOString(),
    store: null,
    products,
    productCount: products.length,
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
    warnings: [],
  };
};

const deterministicCatalogRead = async (
  authorization: string,
  input: unknown
): Promise<Record<string, unknown> | null> => {
  const message = latestUserMessage(input);
  if (!message || !looksLikeCatalogCategoryRead(message)) return null;

  const user = await authenticateConsultantRequest(authorization);
  const context = await authoritativeCatalogContext(user.uid);
  const resolved = resolveKyrubiaDeterministicErpRead(message, context);
  const categoryFilter = resolved?.queryPlan?.filters.find(
    filter => filter.field === 'category'
  );
  if (!resolved || !categoryFilter) return null;

  return {
    status: 'deterministic',
    reply: resolved.reply,
    provider: 'kyrub',
    model: 'kyrub-runtime-v1',
    mode: 'deterministic',
    requestId: randomUUID(),
    ...(resolved.turnContext ? { turnContext: resolved.turnContext } : {}),
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
  };
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
