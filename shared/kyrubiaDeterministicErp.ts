import type { KyrubReadActionType } from './kyrubActions';
import type {
  KyrubErpContextSnapshot,
  KyrubErpProductSummary,
} from './kyrubErpContext';

export type KyrubiaDeterministicErpResult = {
  action: KyrubReadActionType;
  reply: string;
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

const formatProductNames = (
  items: KyrubErpProductSummary[],
  formatter: (product: KyrubErpProductSummary) => string = product => product.name
): string => items
  .slice(0, 20)
  .map(product => `- ${formatter(product)}`)
  .join('\n');

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
  };
};

export const resolveKyrubiaDeterministicErpRead = (
  message: string,
  context?: KyrubErpContextSnapshot
): KyrubiaDeterministicErpResult | null => {
  const intent = normalizeIntentText(message);
  if (!intent || NEEDS_REASONING_OR_MUTATION.test(intent)) return null;

  const asksMissingDescription =
    /\b(produto|produtos|item|itens)\b/.test(intent) &&
    /\bsem (descricao|descricoes)\b/.test(intent);
  if (asksMissingDescription) {
    return resolveCatalogList(context, 'missing_description');
  }

  const asksMissingImage =
    /\b(produto|produtos|item|itens)\b/.test(intent) &&
    /\bsem (imagem|imagens|foto|fotos)\b/.test(intent);
  if (asksMissingImage) {
    return resolveCatalogList(context, 'missing_image');
  }

  const asksLowStock =
    /\b(estoque baixo|estoque minimo|baixo estoque|estoque.*acabando|acabando|pouco estoque)\b/.test(intent);
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
