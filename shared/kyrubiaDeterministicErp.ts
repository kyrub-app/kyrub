import type { KyrubReadActionType } from './kyrubActions';
import type {
  KyrubErpContextSnapshot,
  KyrubErpInventorySummary,
  KyrubErpProductSummary,
} from './kyrubErpContext';
import type {
  KyrubiaEntityReference,
  KyrubiaTurnContext,
} from './kyrubiaContext';
import {
  KYRUBIA_MUTATION_VERBS,
  KYRUBIA_OPEN_REASONING,
  kyrubiaAsksToSaveAsNote,
  normalizeKyrubiaIntentText,
  routeKyrubiaLocalProductIntent,
  type KyrubiaLocalProductIntentKind,
} from './kyrubiaIntentRouter';
import { isKyrubInventoryHistoryReadIntent } from './kyrubiaInventoryHistory';
import {
  createKyrubiaProductQuery,
  executeKyrubiaProductQuery,
  type KyrubiaProductQuery,
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
  kind: KyrubiaLocalProductIntentKind;
};

type StoreAwarenessKind =
  | 'address'
  | 'name'
  | 'status'
  | 'description'
  | 'keywords'
  | 'profile';

// Compatibility contract markers during the query-language migration:
// NEEDS_REASONING_OR_MUTATION, resolveLowStockNote, resolveContextualCatalogFilter.

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

const inventoryAvailabilityReply = (
  context: KyrubErpContextSnapshot | undefined
): string | null => {
  if (!context) {
    return 'Não consegui consultar o estoque de insumos nesta solicitação. Tente novamente em instantes.';
  }
  if (context.availability.inventory !== true) {
    return 'O estoque privado de insumos está temporariamente indisponível para consulta.';
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
      normalizeKyrubiaIntentText(prefix[prefix.length - 1]) !==
        normalizeKyrubiaIntentText(category[prefix.length - 1] ?? '')
    ) {
      prefix.pop();
    }
    if (prefix.length === 0) return null;
  }

  return prefix.join(' > ') || null;
};

const detectStoreAwarenessKind = (intent: string): StoreAwarenessKind | null => {
  if (KYRUBIA_MUTATION_VERBS.test(intent)) return null;

  const storeScope = /\b(minha loja|meu estabelecimento|meu negocio|loja|estabelecimento)\b/.test(intent);
  const deliveryPickupScope =
    /\b(entregador|motoboy|coleta|retirada|retirar|buscar pedido|pegar pedido)\b/.test(intent) &&
    /\b(endereco|local|onde|coleta|retirada)\b/.test(intent);

  if (
    (storeScope && /\b(endereco|localizacao|onde fica|onde esta|local de coleta|local da coleta)\b/.test(intent)) ||
    deliveryPickupScope
  ) {
    return 'address';
  }

  const asksCompoundIdentity = /\b(segmento|ramo|categoria)\b/.test(intent);
  if (
    storeScope &&
    !asksCompoundIdentity &&
    /\b(nome|como chama|chama-se)\b/.test(intent)
  ) {
    return 'name';
  }
  if (storeScope && /\b(status|aberta|aberto|fechada|fechado|atrasada|atrasado)\b/.test(intent)) {
    return 'status';
  }
  if (storeScope && /\b(descricao|sobre a loja|descricao cadastrada)\b/.test(intent)) {
    return 'description';
  }
  if (storeScope && /\b(palavra chave|palavras chave|keyword|keywords|tags)\b/.test(intent)) {
    return 'keywords';
  }
  if (
    storeScope &&
    /\b(dados|informacoes|perfil|cadastro|configuracao basica|configuracoes basicas)\b/.test(intent)
  ) {
    return 'profile';
  }

  return null;
};

const storeStatusLabel = (status: 'open' | 'delayed' | 'closed'): string => {
  if (status === 'open') return 'aberta';
  if (status === 'delayed') return 'com operação atrasada';
  return 'fechada';
};

const resolveStoreAwareness = (
  kind: StoreAwarenessKind,
  context: KyrubErpContextSnapshot | undefined
): KyrubiaDeterministicErpResult => {
  const unavailable = storeAvailabilityReply(context);
  if (unavailable || !context) {
    return {
      action: 'read_store_summary',
      reply: unavailable ?? 'Não consegui consultar sua loja.',
    };
  }
  if (!context.store) {
    return {
      action: 'read_store_summary',
      reply: 'Não encontrei uma loja ativada para este usuário. Você pode ativar sua loja pelo Kyrub ou pedir para eu ajudar no processo de ativação.',
    };
  }

  const store = context.store;
  if (kind === 'address') {
    return {
      action: 'read_store_summary',
      reply: store.address.trim()
        ? `O endereço cadastrado atualmente na sua loja é: ${store.address.trim()}.`
        : 'Sua loja ainda não possui endereço cadastrado. Se quiser, diga o endereço correto e eu preparo a atualização para sua confirmação.',
    };
  }
  if (kind === 'name') {
    return {
      action: 'read_store_summary',
      reply: store.name.trim()
        ? `O nome cadastrado da sua loja é: ${store.name.trim()}.`
        : 'Sua loja ainda não possui nome cadastrado.',
    };
  }
  if (kind === 'status') {
    return {
      action: 'read_store_summary',
      reply: `Sua loja está marcada atualmente como ${storeStatusLabel(store.status)} no Kyrub.`,
    };
  }
  if (kind === 'description') {
    return {
      action: 'read_store_summary',
      reply: store.description.trim()
        ? `A descrição cadastrada da sua loja é: ${store.description.trim()}`
        : 'Sua loja ainda não possui descrição cadastrada.',
    };
  }
  if (kind === 'keywords') {
    return {
      action: 'read_store_summary',
      reply: store.keywords.length > 0
        ? `As palavras-chave cadastradas da sua loja são: ${store.keywords.join(', ')}.`
        : 'Sua loja ainda não possui palavras-chave cadastradas.',
    };
  }

  const lines = [
    `Nome: ${store.name.trim() || 'não informado'}`,
    `Endereço: ${store.address.trim() || 'não cadastrado'}`,
    `Status: ${storeStatusLabel(store.status)}`,
    `Descrição: ${store.description.trim() || 'não cadastrada'}`,
    `Palavras-chave: ${store.keywords.length > 0 ? store.keywords.join(', ') : 'não cadastradas'}`,
    `Plano: ${store.plan}`,
  ];
  return {
    action: 'read_store_summary',
    reply: `Estes são os dados que consegui confirmar diretamente no Kyrub:\n${lines.map(line => `- ${line}`).join('\n')}`,
  };
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

const formatInventoryQuantity = (item: KyrubErpInventorySummary): string =>
  `${item.currentQuantity.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${item.unit}`;

const resolveInventoryRead = (
  intent: string,
  context: KyrubErpContextSnapshot | undefined
): KyrubiaDeterministicErpResult | null => {
  if (KYRUBIA_MUTATION_VERBS.test(intent) || isKyrubInventoryHistoryReadIntent(intent)) {
    return null;
  }

  const inventory = context?.inventory ?? [];
  const normalizedInventoryNames = inventory.map(item => ({
    item,
    normalizedName: normalizeKyrubiaIntentText(item.name),
  }));
  const namedMatches = normalizedInventoryNames
    .filter(({ normalizedName }) => normalizedName.length > 0 && intent.includes(normalizedName))
    .map(({ item }) => item);
  const mentionsInventoryNoun = /\b(insumo|insumos|ingrediente|ingredientes|materia prima|materias primas)\b/.test(intent);
  const asksStock = /\b(estoque|quantidade|quanto tenho|quanto tem|saldo)\b/.test(intent);

  if (!mentionsInventoryNoun && !(asksStock && namedMatches.length > 0)) return null;

  const unavailable = inventoryAvailabilityReply(context);
  if (unavailable || !context) {
    return { action: 'read_store_summary', reply: unavailable ?? 'Não consegui consultar os insumos.' };
  }

  if (inventory.length === 0) {
    return {
      action: 'read_store_summary',
      reply: 'Não encontrei insumos cadastrados no estoque privado da sua loja.',
    };
  }

  const items = namedMatches.length > 0 ? namedMatches : inventory;
  const list = items
    .map(item => `- ${item.name} — ${formatInventoryQuantity(item)}`)
    .join('\n');
  const truncation = context.inventoryTruncated === true && namedMatches.length === 0
    ? '\n\nA leitura do estoque de insumos está limitada, então podem existir outros itens além dos mostrados aqui.'
    : '';

  return {
    action: 'read_store_summary',
    reply: `Estoque atual de insumos:\n${list}${truncation}`,
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

const compileProductQueryPlan = (
  message: string,
  context: KyrubErpContextSnapshot | undefined,
  turnContext: KyrubiaTurnContext | undefined
): ProductQueryPlan | null => {
  const routed = routeKyrubiaLocalProductIntent(message, {
    lowStockThreshold: context?.lowStockThreshold ?? 5,
    turnContext,
  });
  if (!routed) return null;

  return {
    query: createKyrubiaProductQuery({
      filters: routed.filters,
      sort: routed.sort,
      limit: routed.limit,
      candidateIds: routed.candidateIds,
    }),
    action: routed.kind === 'low_stock'
      ? 'list_low_stock_products'
      : 'list_products',
    title: routed.title,
    saveAsNote: routed.saveAsNote,
    kind: routed.kind,
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
  const intent = normalizeKyrubiaIntentText(message);
  if (!intent) return null;
  if (KYRUBIA_OPEN_REASONING.test(intent)) return null;

  const storeAwarenessKind = detectStoreAwarenessKind(intent);
  if (storeAwarenessKind) return resolveStoreAwareness(storeAwarenessKind, context);

  const asksStoreIdentity =
    /\b(loja|estabelecimento|negocio)\b/.test(intent) &&
    /\b(nome|segmento|ramo|categoria)\b/.test(intent);
  if (asksStoreIdentity) return resolveStoreIdentity(context);

  const asksPendingOrders =
    /\bpedido|pedidos\b/.test(intent) &&
    /\bpendente|pendentes|andamento|aberto|abertos|aguardando\b/.test(intent);
  if (asksPendingOrders) return resolvePendingOrders(context);

  const inventoryRead = resolveInventoryRead(intent, context);
  if (inventoryRead) return inventoryRead;

  const asksProductCount =
    /\b(quantos|quantas|quantidade|total)\b/.test(intent) &&
    /\b(produto|produtos|item|itens|mercadoria|mercadorias|artigo|artigos)\b/.test(intent);
  if (asksProductCount) return resolveProductCount(context);

  const saveAsNote = kyrubiaAsksToSaveAsNote(intent);
  if (KYRUBIA_MUTATION_VERBS.test(intent) && !saveAsNote) return null;

  const productPlan = compileProductQueryPlan(message, context, turnContext);
  if (productPlan) {
    return resolveProductQueryPlan(context, turnContext, productPlan);
  }

  return null;
};