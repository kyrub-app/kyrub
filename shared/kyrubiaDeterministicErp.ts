import type { KyrubReadActionType } from './kyrubActions';
import type {
  KyrubErpContextSnapshot,
  KyrubErpProductSummary,
} from './kyrubErpContext';
import type {
  KyrubiaEntityReference,
  KyrubiaTurnContext,
} from './kyrubiaContext';
import {
  createKyrubiaProductQuery,
  executeKyrubiaProductQuery,
  type KyrubiaProductQuery,
  type KyrubiaProductQueryFilter,
  type KyrubiaProductQuerySort,
} from './kyrubiaQueryLanguage';

export type KyrubiaDeterministicNoteDraft = {
  title: string;
  content: string;
  checklist: string[];
};

export type KyrubiaDeterministicErpResult = {
  action: KyrubReadActionType;
  reply: string;
  noteDraft?: KyrubiaDeterministicNoteDraft;
  turnContext?: KyrubiaTurnContext;
  queryPlan?: KyrubiaProductQuery;
};

type ProductQueryPlan = {
  query: KyrubiaProductQuery;
  action: Extract<KyrubReadActionType, 'list_products' | 'list_low_stock_products'>;
  title: string;
  saveAsNote: boolean;
  kind: 'catalog' | 'missing_image' | 'missing_description' | 'low_stock' | 'filtered';
};

const normalizeIntentText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

const NEEDS_OPEN_REASONING =
  /\b(analise|analisar|priorize|priorizar|recomende|recomendar|sugira|sugerir|compare|comparar|explique|explicar|estrategia|estrategias|oportunidade|oportunidades)\b|\bpor que\b/;

// Compatibility contract markers during the query-language migration:
// NEEDS_REASONING_OR_MUTATION, resolveLowStockNote, resolveContextualCatalogFilter.
const UNSUPPORTED_MUTATION =
  /\b(crie|criar|adicione|adicionar|salve|salvar|guarde|guardar|registre|registrar|altere|alterar|mude|mudar|atualize|atualizar|exclua|excluir|apague|apagar|publique|publicar|desconte|aplique|aplicar)\b/;

const asksToSaveAsNote = (intent: string): boolean =>
  /\b(nota|notas)\b/.test(intent) &&
  /\b(salve|salvar|guarde|guardar|registre|registrar|crie|criar|adicione|adicionar)\b/.test(intent);

const createTurnId = (): string => {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `kyrub-turn-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

const createProductTurnContext = (
  action: KyrubReadActionType,
  context: KyrubErpContextSnapshot,
  items: KyrubErpProductSummary[]
): KyrubiaTurnContext => ({
  version: 1,
  id: createTurnId(),
  source: 'kyrub_runtime',
  sourceAction: action,
  generatedAt: new Date().toISOString(),
  scope: {
    kind: 'own_store',
    storeId: context.store?.id ?? null,
  },
  entities: items.slice(0, 20).map((product, index): KyrubiaEntityReference => ({
    entityType: 'product',
    entityId: product.id,
    label: product.name,
    position: index + 1,
  })),
});

const productAvailabilityReply = (
  context: KyrubErpContextSnapshot | undefined
): string | null => {
  if (!context) {
    return 'Não consegui consultar o catálogo da sua loja nesta solicitação. Tente novamente em instantes.';
  }
  if (!context.availability.products) {
    return 'O catálogo da sua loja está temporariamente indisponível para consulta.';
  }
  return null;
};

const storeAvailabilityReply = (
  context: KyrubErpContextSnapshot | undefined
): string | null => {
  if (!context) {
    return 'Não consegui consultar os dados da sua loja nesta solicitação. Tente novamente em instantes.';
  }
  if (!context.availability.store) {
    return 'Os dados da sua loja estão temporariamente indisponíveis para consulta.';
  }
  return null;
};

const orderAvailabilityReply = (
  context: KyrubErpContextSnapshot | undefined
): string | null => {
  if (!context) {
    return 'Não consegui consultar os pedidos da sua loja nesta solicitação. Tente novamente em instantes.';
  }
  if (!context.availability.orders) {
    return 'Os pedidos da sua loja estão temporariamente indisponíveis para consulta.';
  }
  return null;
};

const commonCatalogCategory = (
  products: KyrubErpProductSummary[]
): string | null => {
  const categories = products
    .map(product => product.category
      .split('>')
      .map(part => part.trim())
      .filter(Boolean)
    )
    .filter(parts => parts.length > 0);
  if (categories.length === 0) return null;

  const prefix = [...categories[0]];
  for (const category of categories.slice(1)) {
    while (
      prefix.length > 0 &&
      normalizeIntentText(prefix[prefix.length - 1]) !==
        normalizeIntentText(category[prefix.length - 1] ?? '')
    ) {
      prefix.pop();
    }
    if (prefix.length === 0) return null;
  }

  return prefix.join(' > ') || null;
};

const resolveStoreIdentity = (
  context: KyrubErpContextSnapshot | undefined
): KyrubiaDeterministicErpResult => {
  const unavailable = storeAvailabilityReply(context);
  if (unavailable || !context) {
    return { action: 'read_store_summary', reply: unavailable ?? 'Não consegui consultar sua loja.' };
  }
  if (!context.store) {
    return {
      action: 'read_store_summary',
      reply: 'Não encontrei uma loja ativada para este usuário.',
    };
  }

  const store = context.store;
  const catalogSegment = context.availability.products
    ? commonCatalogCategory(context.products)
    : null;
  const segmentLine = catalogSegment
    ? `O Kyrub ainda não possui um campo canônico de segmento para a loja. Pela classificação atual dos produtos, o catálogo está em: ${catalogSegment}.`
    : 'O Kyrub ainda não possui um campo canônico de segmento para a loja, então não vou inventar um segmento que não esteja cadastrado.';
  const descriptionLine = store.description.trim()
    ? `\nDescrição cadastrada: ${store.description.trim()}`
    : '';
  const keywordsLine = store.keywords.length > 0
    ? `\nPalavras-chave cadastradas: ${store.keywords.join(', ')}`
    : '';

  return {
    action: 'read_store_summary',
    reply: `Nome da sua loja: ${store.name || 'não informado'}.\n${segmentLine}${descriptionLine}${keywordsLine}`,
  };
};

const resolveProductCount = (
  context: KyrubErpContextSnapshot | undefined
): KyrubiaDeterministicErpResult => {
  const unavailable = productAvailabilityReply(context);
  if (unavailable || !context) {
    return { action: 'read_store_summary', reply: unavailable ?? 'Não consegui consultar sua loja.' };
  }

  const count = context.productCount;
  return {
    action: 'read_store_summary',
    reply: count === 1
      ? 'Você tem 1 item cadastrado no catálogo da sua loja.'
      : `Você tem ${count} itens cadastrados no catálogo da sua loja.`,
  };
};

const resolvePendingOrders = (
  context: KyrubErpContextSnapshot | undefined
): KyrubiaDeterministicErpResult => {
  const unavailable = orderAvailabilityReply(context);
  if (unavailable || !context) {
    return { action: 'list_pending_orders', reply: unavailable ?? 'Não consegui consultar os pedidos.' };
  }

  const count = context.pendingOrderCount;
  return {
    action: 'list_pending_orders',
    reply: count === 0
      ? 'Você não tem pedidos pendentes ou em andamento no momento.'
      : count === 1
        ? 'Você tem 1 pedido pendente ou em andamento no momento.'
        : `Você tem ${count} pedidos pendentes ou em andamento no momento.`,
  };
};

const parseNumber = (value: string | undefined): number | null => {
  if (!value) return null;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

const extractLimit = (intent: string): number => {
  const patterns = [
    /\btop\s+(\d{1,2})\b/,
    /\b(\d{1,2})\s+(?:primeiros|primeiras)\b/,
    /\b(?:primeiros|primeiras)\s+(\d{1,2})\b/,
    /\b(?:os|as)\s+(\d{1,2})\s+(?:produtos|produto|itens|item)\b/,
    /\b(?:liste|mostre)\s+(?:os|as)?\s*(\d{1,2})\b/,
  ];
  for (const pattern of patterns) {
    const value = parseNumber(pattern.exec(intent)?.[1]);
    if (value !== null) return Math.min(50, Math.max(1, Math.trunc(value)));
  }
  return 20;
};

const extractStockFilter = (
  intent: string
): KyrubiaProductQueryFilter | null => {
  const patterns: Array<[RegExp, KyrubiaProductQueryFilter['operator']]> = [
    [/\bestoque(?:\s+de)?\s+(?:ate|no maximo|menor ou igual a)\s+(\d+(?:[.,]\d+)?)\b/, 'lte'],
    [/\bestoque(?:\s+de)?\s+(?:abaixo de|menor que)\s+(\d+(?:[.,]\d+)?)\b/, 'lt'],
    [/\bestoque(?:\s+de)?\s+(?:pelo menos|a partir de|maior ou igual a)\s+(\d+(?:[.,]\d+)?)\b/, 'gte'],
    [/\bestoque(?:\s+de)?\s+(?:acima de|maior que)\s+(\d+(?:[.,]\d+)?)\b/, 'gt'],
  ];

  for (const [pattern, operator] of patterns) {
    const value = parseNumber(pattern.exec(intent)?.[1]);
    if (value !== null) return { field: 'stock', operator, value };
  }
  return null;
};

const extractPriceFilter = (
  intent: string
): KyrubiaProductQueryFilter | null => {
  const patterns: Array<[RegExp, KyrubiaProductQueryFilter['operator']]> = [
    [/\b(?:preco|valor)(?:\s+de)?\s+(?:ate|no maximo|menor ou igual a)\s+(?:r\$\s*)?(\d+(?:[.,]\d+)?)\b/, 'lte'],
    [/\b(?:preco|valor)(?:\s+de)?\s+(?:abaixo de|menor que)\s+(?:r\$\s*)?(\d+(?:[.,]\d+)?)\b/, 'lt'],
    [/\b(?:preco|valor)(?:\s+de)?\s+(?:pelo menos|a partir de|maior ou igual a)\s+(?:r\$\s*)?(\d+(?:[.,]\d+)?)\b/, 'gte'],
    [/\b(?:preco|valor)(?:\s+de)?\s+(?:acima de|maior que)\s+(?:r\$\s*)?(\d+(?:[.,]\d+)?)\b/, 'gt'],
  ];

  for (const [pattern, operator] of patterns) {
    const value = parseNumber(pattern.exec(intent)?.[1]);
    if (value !== null) return { field: 'price', operator, value };
  }
  return null;
};

const extractSort = (intent: string): KyrubiaProductQuerySort | undefined => {
  if (/\b(mais caros|maior preco|precos mais altos)\b/.test(intent)) {
    return { field: 'price', direction: 'desc' };
  }
  if (/\b(mais baratos|menor preco|precos mais baixos)\b/.test(intent)) {
    return { field: 'price', direction: 'asc' };
  }
  if (/\b(menor estoque|estoque mais baixo|estoques mais baixos|mais criticos)\b/.test(intent)) {
    return { field: 'stock', direction: 'asc' };
  }
  if (/\b(maior estoque|estoque mais alto|estoques mais altos)\b/.test(intent)) {
    return { field: 'stock', direction: 'desc' };
  }
  if (/\b(ordem alfabetica|alfabetica|alfabetico)\b/.test(intent)) {
    return { field: 'name', direction: 'asc' };
  }
  return undefined;
};

const compileProductQueryPlan = (
  intent: string,
  context: KyrubErpContextSnapshot | undefined,
  turnContext: KyrubiaTurnContext | undefined
): ProductQueryPlan | null => {
  const missingDescriptionPattern = /\bsem (descricao|descricoes)\b/;
  const missingImagePattern = /\bsem (imagem|imagens|foto|fotos)\b/;
  const lowStockPattern =
    /\b(estoque baixo|estoque minimo|baixo estoque|estoque.*acabando|acabando|pouco estoque)\b/;
  const explicitProductReference = /\b(produto|produtos|item|itens|catalogo)\b/.test(intent);
  const listVerb = /\b(liste|listar|mostre|mostrar|quais|qual|ver|encontre|encontrar)\b/.test(intent);
  const saveAsNote = asksToSaveAsNote(intent);
  const contextualQuestion = /\b(quais|qual|estao|esta|continuam|continua|ficaram|ficou)\b/.test(intent);
  const hasMissingDescription = missingDescriptionPattern.test(intent);
  const hasMissingImage = missingImagePattern.test(intent);
  const hasLowStock = lowStockPattern.test(intent);
  const stockFilter = extractStockFilter(intent);
  const priceFilter = extractPriceFilter(intent);
  const sort: KyrubiaProductQuerySort | undefined =
    extractSort(intent) ??
    (hasLowStock ? { field: 'stock', direction: 'asc' } : undefined);

  const contextualCandidates =
    !explicitProductReference &&
    contextualQuestion &&
    (hasMissingDescription || hasMissingImage || stockFilter !== null || priceFilter !== null) &&
    turnContext?.entities.length &&
    turnContext.entities.every(entity => entity.entityType === 'product')
      ? turnContext.entities.map(entity => entity.entityId)
      : undefined;

  const hasProductSignal =
    explicitProductReference ||
    Boolean(contextualCandidates?.length) ||
    hasMissingDescription ||
    hasMissingImage ||
    hasLowStock ||
    stockFilter !== null ||
    priceFilter !== null;

  if (!hasProductSignal) return null;
  if (!listVerb && !saveAsNote && !hasMissingDescription && !hasMissingImage && !hasLowStock && !stockFilter && !priceFilter && !sort) {
    return null;
  }

  const filters: KyrubiaProductQueryFilter[] = [];
  if (hasMissingImage) filters.push({ field: 'hasImage', operator: 'eq', value: false });
  if (hasMissingDescription) {
    filters.push({ field: 'hasDescription', operator: 'eq', value: false });
  }
  if (stockFilter) {
    filters.push(stockFilter);
  } else if (hasLowStock) {
    filters.push({ field: 'isService', operator: 'eq', value: false });
    filters.push({
      field: 'stock',
      operator: 'lte',
      value: context?.lowStockThreshold ?? 5,
    });
  }
  if (priceFilter) filters.push(priceFilter);
  if (/\b(produtos fisicos|produto fisico|itens fisicos|item fisico)\b/.test(intent)) {
    filters.push({ field: 'isService', operator: 'eq', value: false });
  }
  if (/\b(servico|servicos)\b/.test(intent) && !/\bproduto|produtos\b/.test(intent)) {
    filters.push({ field: 'isService', operator: 'eq', value: true });
  }

  let kind: ProductQueryPlan['kind'] = 'filtered';
  let title = 'Consulta de produtos';
  let action: ProductQueryPlan['action'] = 'list_products';
  if (hasLowStock && !hasMissingImage && !hasMissingDescription && !priceFilter) {
    kind = 'low_stock';
    title = 'Produtos com estoque baixo';
    action = 'list_low_stock_products';
  } else if (hasMissingImage && !hasMissingDescription && !hasLowStock && !stockFilter && !priceFilter) {
    kind = 'missing_image';
    title = 'Produtos sem imagem';
  } else if (hasMissingDescription && !hasMissingImage && !hasLowStock && !stockFilter && !priceFilter) {
    kind = 'missing_description';
    title = 'Produtos sem descrição';
  } else if (filters.length === 0 && !sort) {
    kind = 'catalog';
    title = 'Produtos do catálogo';
  }

  return {
    query: createKyrubiaProductQuery({
      filters,
      sort,
      limit: extractLimit(intent),
      candidateIds: contextualCandidates,
    }),
    action,
    title,
    saveAsNote,
    kind,
  };
};

const formatPrice = (price: number): string =>
  price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const formatProductLine = (
  product: KyrubErpProductSummary,
  query: KyrubiaProductQuery
): string => {
  const details: string[] = [];
  const mentionsStock = query.filters.some(filter => filter.field === 'stock') ||
    query.sort?.field === 'stock';
  const mentionsPrice = query.filters.some(filter => filter.field === 'price') ||
    query.sort?.field === 'price';

  if (mentionsStock) {
    details.push(`${product.stock} ${product.stock === 1 ? 'unidade' : 'unidades'}`);
  }
  if (mentionsPrice) details.push(formatPrice(product.price));
  if (!mentionsStock && !mentionsPrice && product.category) details.push(product.category);

  return details.length > 0
    ? `${product.name} — ${details.join(' · ')}`
    : product.name;
};

const queryTruncationSuffix = (
  context: KyrubErpContextSnapshot,
  truncated: boolean
): string => {
  if (!truncated) return '';
  return context.productsTruncated
    ? '\n\nA leitura atual do catálogo está limitada, então podem existir outros itens além dos mostrados aqui.'
    : '\n\nA consulta encontrou mais itens do que o limite solicitado; mostrei apenas os primeiros resultados.';
};

const resolveProductQueryPlan = (
  context: KyrubErpContextSnapshot | undefined,
  turnContext: KyrubiaTurnContext | undefined,
  plan: ProductQueryPlan
): KyrubiaDeterministicErpResult => {
  const unavailable = productAvailabilityReply(context);
  if (unavailable || !context) {
    return {
      action: plan.action,
      reply: unavailable ?? 'Não consegui consultar o catálogo.',
      queryPlan: plan.query,
    };
  }

  if (
    plan.query.candidateIds?.length &&
    turnContext?.scope.storeId &&
    context.store?.id &&
    turnContext.scope.storeId !== context.store.id
  ) {
    return {
      action: plan.action,
      reply: 'A lista anterior pertence a outro contexto de loja e não pode ser reutilizada aqui.',
      queryPlan: plan.query,
    };
  }

  const result = executeKyrubiaProductQuery(context, plan.query);
  const missingReferenceSuffix = result.candidateMissingCount > 0
    ? `\n\n${result.candidateMissingCount === 1 ? '1 item da lista anterior não pôde' : `${result.candidateMissingCount} itens da lista anterior não puderam`} ser revalidado nesta leitura.`
    : '';

  if (result.items.length === 0) {
    let reply = 'Não encontrei produtos que atendam aos filtros desta consulta.';
    if (plan.kind === 'missing_image') {
      reply = plan.query.candidateIds?.length
        ? 'Dos itens daquela lista que consegui revalidar no Kyrub, nenhum está sem imagem neste momento.'
        : 'Não encontrei itens sem imagem nesta leitura.';
    } else if (plan.kind === 'missing_description') {
      reply = plan.query.candidateIds?.length
        ? 'Dos itens daquela lista que consegui revalidar no Kyrub, nenhum está sem descrição neste momento.'
        : 'Não encontrei itens sem descrição nesta leitura.';
    } else if (plan.kind === 'low_stock') {
      const threshold = plan.query.filters.find(filter => filter.field === 'stock')?.value;
      reply = `Nenhum produto físico está com estoque igual ou abaixo do mínimo de ${threshold ?? context.lowStockThreshold} unidades.`;
    } else if (plan.kind === 'catalog') {
      reply = 'Não encontrei itens no catálogo nesta leitura.';
    }

    return {
      action: plan.action,
      reply: `${reply}${missingReferenceSuffix}${queryTruncationSuffix(context, result.truncated)}`,
      queryPlan: plan.query,
    };
  }

  let intro = `Encontrei ${result.totalMatched} ${result.totalMatched === 1 ? 'item' : 'itens'} que atendem à consulta:`;
  if (plan.kind === 'missing_image') {
    intro = `Encontrei ${result.totalMatched} ${result.totalMatched === 1 ? 'item sem imagem' : 'itens sem imagem'}:`;
  } else if (plan.kind === 'missing_description') {
    intro = `Encontrei ${result.totalMatched} ${result.totalMatched === 1 ? 'item sem descrição' : 'itens sem descrição'}:`;
  } else if (plan.kind === 'low_stock') {
    const threshold = plan.query.filters.find(filter => filter.field === 'stock')?.value;
    intro = `Encontrei ${result.totalMatched} ${result.totalMatched === 1 ? 'produto' : 'produtos'} com estoque baixo (até ${threshold ?? context.lowStockThreshold} unidades):`;
  } else if (plan.kind === 'catalog') {
    intro = `Aqui estão ${result.totalMatched} ${result.totalMatched === 1 ? 'item do catálogo' : 'itens do catálogo'}:`;
  }

  const list = result.items
    .map(product => `- ${formatProductLine(product, plan.query)}`)
    .join('\n');
  const baseReply = `${intro}\n${list}${missingReferenceSuffix}${queryTruncationSuffix(context, result.truncated)}`;
  const reply = plan.saveAsNote
    ? `${baseReply}\n\nPreparei uma nota com essa leitura. Revise e confirme para salvá-la nas suas notas.`
    : baseReply;

  return {
    action: plan.action,
    reply,
    queryPlan: plan.query,
    turnContext: createProductTurnContext(plan.action, context, result.items),
    ...(plan.saveAsNote
      ? {
          noteDraft: {
            title: plan.title,
            content: baseReply,
            checklist: [],
          },
        }
      : {}),
  };
};

export const resolveKyrubiaDeterministicErpRead = (
  message: string,
  context?: KyrubErpContextSnapshot,
  turnContext?: KyrubiaTurnContext
): KyrubiaDeterministicErpResult | null => {
  const intent = normalizeIntentText(message);
  if (!intent) return null;
  if (NEEDS_OPEN_REASONING.test(intent)) return null;

  const asksStoreIdentity =
    /\b(loja|estabelecimento|negocio)\b/.test(intent) &&
    /\b(nome|segmento|ramo|categoria)\b/.test(intent);
  if (asksStoreIdentity) return resolveStoreIdentity(context);

  const asksPendingOrders =
    /\bpedido|pedidos\b/.test(intent) &&
    /\bpendente|pendentes|andamento|aberto|abertos|aguardando\b/.test(intent);
  if (asksPendingOrders) return resolvePendingOrders(context);

  const asksProductCount =
    /\b(quantos|quantas|quantidade|total)\b/.test(intent) &&
    /\b(produto|produtos|item|itens)\b/.test(intent);
  if (asksProductCount) return resolveProductCount(context);

  const saveAsNote = asksToSaveAsNote(intent);
  if (UNSUPPORTED_MUTATION.test(intent) && !saveAsNote) return null;

  const productPlan = compileProductQueryPlan(intent, context, turnContext);
  if (productPlan) {
    return resolveProductQueryPlan(context, turnContext, productPlan);
  }

  return null;
};
