import type { KyrubReadActionType } from './kyrubActions';
import type {
  KyrubErpContextSnapshot,
  KyrubErpProductSummary,
} from './kyrubErpContext';
import type {
  KyrubiaEntityReference,
  KyrubiaTurnContext,
} from './kyrubiaContext';

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
};

const normalizeIntentText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

const NEEDS_REASONING_OR_MUTATION =
  /\b(salve|salvar|guarde|guardar|registre|registrar|crie|criar|adicione|adicionar|nota|notas|tarefa|tarefas|analise|analisar|priorize|priorizar|recomende|recomendar|sugira|sugerir|compare|comparar|explique|explicar|estrategia|estrategias|oportunidade|oportunidades)\b|\bpor que\b/;

const NEEDS_OPEN_REASONING =
  /\b(analise|analisar|priorize|priorizar|recomende|recomendar|sugira|sugerir|compare|comparar|explique|explicar|estrategia|estrategias|oportunidade|oportunidades)\b|\bpor que\b/;

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

const productTruncationSuffix = (context: KyrubErpContextSnapshot): string =>
  context.productsTruncated
    ? '\n\nA leitura atual do catálogo está limitada, então podem existir outros itens além dos mostrados aqui.'
    : '';

const visibleProducts = (items: KyrubErpProductSummary[]): KyrubErpProductSummary[] =>
  items.slice(0, 20);

const formatProductNames = (
  items: KyrubErpProductSummary[],
  formatter: (product: KyrubErpProductSummary) => string = product => product.name
): string => visibleProducts(items)
  .map(product => `- ${formatter(product)}`)
  .join('\n');

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

const resolveLowStock = (
  context: KyrubErpContextSnapshot | undefined
): KyrubiaDeterministicErpResult => {
  const unavailable = productAvailabilityReply(context);
  if (unavailable || !context) {
    return { action: 'list_low_stock_products', reply: unavailable ?? 'Não consegui consultar o estoque.' };
  }

  const threshold = context.lowStockThreshold;
  const items = context.products
    .filter(product => !product.isService && product.stock <= threshold)
    .sort((left, right) => left.stock - right.stock ||
      left.name.localeCompare(right.name, 'pt-BR'));

  if (items.length === 0) {
    const prefix = context.productsTruncated
      ? 'Entre os itens disponíveis nesta leitura, nenhum produto físico'
      : 'Nenhum produto físico';
    return {
      action: 'list_low_stock_products',
      reply: `${prefix} está com estoque igual ou abaixo do mínimo de ${threshold} unidades.${productTruncationSuffix(context)}`,
    };
  }

  const intro = context.productsTruncated
    ? `Entre os itens disponíveis nesta leitura, encontrei ${items.length} com estoque baixo (até ${threshold} unidades):`
    : `Encontrei ${items.length} ${items.length === 1 ? 'produto' : 'produtos'} com estoque baixo (até ${threshold} unidades):`;

  return {
    action: 'list_low_stock_products',
    reply: `${intro}\n${formatProductNames(items, product => `${product.name} — ${product.stock} ${product.stock === 1 ? 'unidade' : 'unidades'}`)}${productTruncationSuffix(context)}`,
    turnContext: createProductTurnContext(
      'list_low_stock_products',
      context,
      visibleProducts(items)
    ),
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

const resolveCatalogList = (
  context: KyrubErpContextSnapshot | undefined,
  filter: 'all' | 'missing_description' | 'missing_image'
): KyrubiaDeterministicErpResult => {
  const unavailable = productAvailabilityReply(context);
  if (unavailable || !context) {
    return { action: 'list_products', reply: unavailable ?? 'Não consegui consultar o catálogo.' };
  }

  const items = context.products.filter(product => {
    if (filter === 'missing_description') return !product.hasDescription;
    if (filter === 'missing_image') return !product.hasImage;
    return true;
  });

  if (items.length === 0) {
    const noun = filter === 'missing_description'
      ? 'sem descrição'
      : filter === 'missing_image'
        ? 'sem imagem'
        : 'no catálogo';
    return {
      action: 'list_products',
      reply: `Não encontrei itens ${noun} nesta leitura.${productTruncationSuffix(context)}`,
    };
  }

  const intro = filter === 'missing_description'
    ? `Encontrei ${items.length} ${items.length === 1 ? 'item sem descrição' : 'itens sem descrição'}:`
    : filter === 'missing_image'
      ? `Encontrei ${items.length} ${items.length === 1 ? 'item sem imagem' : 'itens sem imagem'}:`
      : `Aqui estão ${items.length} ${items.length === 1 ? 'item do catálogo' : 'itens do catálogo'}:`;

  return {
    action: 'list_products',
    reply: `${intro}\n${formatProductNames(items, product =>
      product.category ? `${product.name} — ${product.category}` : product.name
    )}${items.length > 20 ? '\n- …' : ''}${productTruncationSuffix(context)}`,
    turnContext: createProductTurnContext(
      'list_products',
      context,
      visibleProducts(items)
    ),
  };
};

const resolveContextualCatalogFilter = (
  context: KyrubErpContextSnapshot | undefined,
  turnContext: KyrubiaTurnContext | undefined,
  filter: 'missing_description' | 'missing_image'
): KyrubiaDeterministicErpResult | null => {
  if (!turnContext?.entities.length) return null;
  if (turnContext.entities.some(entity => entity.entityType !== 'product')) return null;

  const unavailable = productAvailabilityReply(context);
  if (unavailable || !context) {
    return { action: 'list_products', reply: unavailable ?? 'Não consegui consultar o catálogo.' };
  }

  if (
    turnContext.scope.storeId &&
    context.store?.id &&
    turnContext.scope.storeId !== context.store.id
  ) {
    return {
      action: 'list_products',
      reply: 'A lista anterior pertence a outro contexto de loja e não pode ser reutilizada aqui.',
    };
  }

  const currentById = new Map(context.products.map(product => [product.id, product] as const));
  const revalidated = turnContext.entities.flatMap(reference => {
    const product = currentById.get(reference.entityId);
    return product ? [product] : [];
  });
  const items = revalidated.filter(product =>
    filter === 'missing_image' ? !product.hasImage : !product.hasDescription
  );
  const missingReferenceCount = turnContext.entities.length - revalidated.length;
  const incompleteSuffix = missingReferenceCount > 0
    ? `\n\n${missingReferenceCount === 1 ? '1 item da lista anterior não pôde' : `${missingReferenceCount} itens da lista anterior não puderam`} ser revalidado nesta leitura.`
    : '';
  const label = filter === 'missing_image' ? 'imagem' : 'descrição';

  if (items.length === 0) {
    return {
      action: 'list_products',
      reply: `Dos itens daquela lista que consegui revalidar no Kyrub, nenhum está sem ${label} neste momento.${incompleteSuffix}`,
    };
  }

  return {
    action: 'list_products',
    reply: `Dos itens daquela lista, ${items.length === 1 ? '1 continua' : `${items.length} continuam`} sem ${label}:\n${formatProductNames(items, product =>
      product.category ? `${product.name} — ${product.category}` : product.name
    )}${incompleteSuffix}`,
    turnContext: createProductTurnContext('list_products', context, visibleProducts(items)),
  };
};

const resolveLowStockNote = (
  context: KyrubErpContextSnapshot | undefined
): KyrubiaDeterministicErpResult => {
  const readResult = resolveLowStock(context);
  if (!context || !context.availability.products) return readResult;

  return {
    ...readResult,
    reply: `${readResult.reply}\n\nPreparei uma nota com essa leitura. Revise e confirme para salvá-la nas suas notas.`,
    noteDraft: {
      title: 'Produtos com estoque baixo',
      content: readResult.reply,
      checklist: [],
    },
  };
};

export const resolveKyrubiaDeterministicErpRead = (
  message: string,
  context?: KyrubErpContextSnapshot,
  turnContext?: KyrubiaTurnContext
): KyrubiaDeterministicErpResult | null => {
  const intent = normalizeIntentText(message);
  if (!intent) return null;

  const asksLowStock =
    /\b(estoque baixo|estoque minimo|baixo estoque|estoque.*acabando|acabando|pouco estoque)\b/.test(intent);

  const asksLowStockNote =
    asksLowStock &&
    asksToSaveAsNote(intent) &&
    !NEEDS_OPEN_REASONING.test(intent);
  if (asksLowStockNote) return resolveLowStockNote(context);

  if (NEEDS_REASONING_OR_MUTATION.test(intent)) return null;

  const asksStoreIdentity =
    /\b(loja|estabelecimento|negocio)\b/.test(intent) &&
    /\b(nome|segmento|ramo|categoria)\b/.test(intent);
  if (asksStoreIdentity) return resolveStoreIdentity(context);

  const missingDescriptionPattern = /\bsem (descricao|descricoes)\b/;
  const missingImagePattern = /\bsem (imagem|imagens|foto|fotos)\b/;
  const explicitProductReference = /\b(produto|produtos|item|itens)\b/.test(intent);
  const contextualFilterQuestion = /\b(quais|qual|estao|esta|continuam|continua|ficaram|ficou)\b/.test(intent);

  const asksMissingDescription =
    explicitProductReference && missingDescriptionPattern.test(intent);
  if (asksMissingDescription) {
    return resolveCatalogList(context, 'missing_description');
  }

  const asksMissingImage =
    explicitProductReference && missingImagePattern.test(intent);
  if (asksMissingImage) {
    return resolveCatalogList(context, 'missing_image');
  }

  if (
    contextualFilterQuestion &&
    missingDescriptionPattern.test(intent)
  ) {
    const contextual = resolveContextualCatalogFilter(
      context,
      turnContext,
      'missing_description'
    );
    if (contextual) return contextual;
  }

  if (
    contextualFilterQuestion &&
    missingImagePattern.test(intent)
  ) {
    const contextual = resolveContextualCatalogFilter(
      context,
      turnContext,
      'missing_image'
    );
    if (contextual) return contextual;
  }

  if (asksLowStock) return resolveLowStock(context);

  const asksPendingOrders =
    /\bpedido|pedidos\b/.test(intent) &&
    /\bpendente|pendentes|andamento|aberto|abertos|aguardando\b/.test(intent);
  if (asksPendingOrders) return resolvePendingOrders(context);

  const asksProductCount =
    /\b(quantos|quantas|quantidade|total)\b/.test(intent) &&
    /\b(produto|produtos|item|itens)\b/.test(intent);
  if (asksProductCount) return resolveProductCount(context);

  const asksCatalogList =
    /\b(liste|listar|mostre|mostrar|quais|ver)\b/.test(intent) &&
    /\b(produto|produtos|item|itens)\b/.test(intent);
  if (asksCatalogList) return resolveCatalogList(context, 'all');

  return null;
};
