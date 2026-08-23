import type { KyrubErpContextSnapshot } from '../../shared/kyrubErpContext.js';
import {
  createKyrubiaProductQuery,
  executeKyrubiaProductQuery,
  type KyrubiaProductQueryFilter,
  type KyrubiaProductQuerySort,
} from '../../shared/kyrubiaQueryLanguage.js';

export const KYRUBIA_QUERY_PRODUCTS_TOOL_NAME = 'query_products';
export const KYRUBIA_ERP_READ_ACTIONS = [
  'read_store_summary',
  'list_products',
  'list_low_stock_products',
  'list_pending_orders',
] as const;

const MAX_TOOL_ITEMS = 50;
const MAX_NOTE_TITLE_CHARACTERS = 120;
const MAX_NOTE_CONTENT_CHARACTERS = 10_000;
const MAX_NOTE_CHECKLIST_ITEMS = 24;
const MAX_NOTE_CHECKLIST_ITEM_CHARACTERS = 180;

export type KyrubiaErpSnapshot = KyrubErpContextSnapshot;

export type KyrubiaNormalizedToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  part?: Record<string, unknown>;
};

export type KyrubiaCreateNoteProposal = {
  id: string;
  type: 'create_note';
  title: string;
  content: string;
  checklist: string[];
  requiresConfirmation: true;
};

export class KyrubiaSharedToolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'KyrubiaSharedToolError';
  }
}

const cleanText = (value: unknown, maximum: number): string =>
  typeof value === 'string' ? value.trim().slice(0, maximum) : '';

const optionalFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const clampInteger = (
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number => {
  const numeric = typeof value === 'number' && Number.isFinite(value)
    ? Math.trunc(value)
    : fallback;
  return Math.min(maximum, Math.max(minimum, numeric));
};

export const KYRUBIA_CREATE_NOTE_DECLARATION = {
  name: 'create_note',
  description:
    'Prepara uma nota privada completa no Kyrub para revisão e confirmação do usuário. Não executa a gravação.',
  parameters: {
    type: 'OBJECT',
    properties: {
      title: { type: 'STRING', description: 'Título curto e objetivo da nota.' },
      content: {
        type: 'STRING',
        description:
          'Conteúdo completo da nota. Pode incluir receitas, planos, explicações, materiais, etapas e observações.',
      },
      checklist: {
        type: 'ARRAY',
        description:
          'Etapas acionáveis ou itens de verificação, em ordem, quando forem úteis.',
        items: { type: 'STRING' },
      },
    },
    required: ['title', 'content'],
  },
} as const;

export const KYRUBIA_QUERY_PRODUCTS_DECLARATION = {
  name: KYRUBIA_QUERY_PRODUCTS_TOOL_NAME,
  description:
    'Consulta produtos e serviços reais do catálogo usando filtros combináveis, ordenação e limite. Use esta ferramenta em vez de inventar uma ferramenta específica para cada combinação. Somente leitura.',
  parameters: {
    type: 'OBJECT',
    properties: {
      nameContains: { type: 'STRING' },
      categoryContains: { type: 'STRING' },
      hasImage: { type: 'BOOLEAN' },
      hasDescription: { type: 'BOOLEAN' },
      isService: { type: 'BOOLEAN' },
      stockMin: { type: 'NUMBER' },
      stockMax: { type: 'NUMBER' },
      priceMin: { type: 'NUMBER' },
      priceMax: { type: 'NUMBER' },
      sortBy: { type: 'STRING', enum: ['name', 'category', 'price', 'stock'] },
      sortDirection: { type: 'STRING', enum: ['asc', 'desc'] },
      limit: { type: 'INTEGER' },
    },
  },
} as const;

export const KYRUBIA_ERP_READ_DECLARATIONS = [
  {
    name: 'read_store_summary',
    description:
      'Consulta os dados básicos e contagens operacionais da loja autenticada. Somente leitura.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'list_products',
    description:
      'Alias legado para listar produtos e serviços reais do catálogo. Para combinações de filtros, prefira query_products. Somente leitura.',
    parameters: {
      type: 'OBJECT',
      properties: {
        search: { type: 'STRING' },
        category: { type: 'STRING' },
        limit: { type: 'INTEGER' },
      },
    },
  },
  {
    name: 'list_low_stock_products',
    description: 'Alias legado para produtos físicos com estoque baixo. Somente leitura.',
    parameters: {
      type: 'OBJECT',
      properties: {
        threshold: { type: 'INTEGER' },
        limit: { type: 'INTEGER' },
      },
    },
  },
  {
    name: 'list_pending_orders',
    description:
      'Lista pedidos ainda em andamento na loja autenticada, sem expor dados pessoais do cliente. Somente leitura.',
    parameters: {
      type: 'OBJECT',
      properties: { limit: { type: 'INTEGER' } },
    },
  },
] as const;

export const KYRUBIA_MUTATION_TOOL = {
  functionDeclarations: [KYRUBIA_CREATE_NOTE_DECLARATION],
};

export const KYRUBIA_ALL_TOOLS = {
  functionDeclarations: [
    KYRUBIA_CREATE_NOTE_DECLARATION,
    KYRUBIA_QUERY_PRODUCTS_DECLARATION,
    ...KYRUBIA_ERP_READ_DECLARATIONS,
  ],
};

export const normalizeKyrubiaToolArguments = (
  value: unknown
): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
};

export const kyrubiaFunctionCallsFromGeminiParts = (
  parts: unknown[],
  createId: () => string
): KyrubiaNormalizedToolCall[] =>
  parts.flatMap(part => {
    if (!part || typeof part !== 'object') return [];
    const rawPart = part as Record<string, unknown>;
    const functionCall = rawPart.functionCall;
    if (!functionCall || typeof functionCall !== 'object') return [];
    const call = functionCall as Record<string, unknown>;
    const name = cleanText(call.name, 120);
    if (!name) return [];
    return [{
      id: cleanText(call.id, 120) || createId(),
      name,
      args: normalizeKyrubiaToolArguments(call.args),
      part: rawPart,
    }];
  });

export const kyrubiaCreateNoteProposalFromCall = (
  call: KyrubiaNormalizedToolCall
): KyrubiaCreateNoteProposal | undefined => {
  if (call.name !== 'create_note') return undefined;
  const title = cleanText(call.args.title, MAX_NOTE_TITLE_CHARACTERS);
  const content = cleanText(call.args.content, MAX_NOTE_CONTENT_CHARACTERS);
  const checklist = Array.isArray(call.args.checklist)
    ? call.args.checklist
        .map(item => cleanText(item, MAX_NOTE_CHECKLIST_ITEM_CHARACTERS))
        .filter(Boolean)
        .slice(0, MAX_NOTE_CHECKLIST_ITEMS)
    : [];
  if (!title || !content) {
    throw new KyrubiaSharedToolError(
      'AI_UNAVAILABLE',
      'A Kyrubia não conseguiu preparar todos os dados da nota. Reformule o pedido e tente novamente.'
    );
  }
  return {
    id: call.id,
    type: 'create_note',
    title,
    content,
    checklist,
    requiresConfirmation: true,
  };
};

export const isKyrubiaErpReadTool = (name: string): boolean =>
  name === KYRUBIA_QUERY_PRODUCTS_TOOL_NAME ||
  (KYRUBIA_ERP_READ_ACTIONS as readonly string[]).includes(name);

const executeGenericProductQuery = (
  call: KyrubiaNormalizedToolCall,
  context: KyrubErpContextSnapshot
): Record<string, unknown> => {
  if (!context.availability.products) {
    return {
      available: false,
      reason: 'products_unavailable',
      warnings: context.warnings,
    };
  }

  const filters: KyrubiaProductQueryFilter[] = [];
  const nameContains = cleanText(call.args.nameContains, 120);
  const categoryContains = cleanText(call.args.categoryContains, 120);
  if (nameContains) filters.push({ field: 'name', operator: 'contains', value: nameContains });
  if (categoryContains) {
    filters.push({ field: 'category', operator: 'contains', value: categoryContains });
  }
  if (typeof call.args.hasImage === 'boolean') {
    filters.push({ field: 'hasImage', operator: 'eq', value: call.args.hasImage });
  }
  if (typeof call.args.hasDescription === 'boolean') {
    filters.push({ field: 'hasDescription', operator: 'eq', value: call.args.hasDescription });
  }
  if (typeof call.args.isService === 'boolean') {
    filters.push({ field: 'isService', operator: 'eq', value: call.args.isService });
  }

  const numericFilters: Array<[
    'stock' | 'price',
    'gte' | 'lte',
    unknown
  ]> = [
    ['stock', 'gte', call.args.stockMin],
    ['stock', 'lte', call.args.stockMax],
    ['price', 'gte', call.args.priceMin],
    ['price', 'lte', call.args.priceMax],
  ];
  for (const [field, operator, rawValue] of numericFilters) {
    const value = optionalFiniteNumber(rawValue);
    if (value !== undefined) {
      filters.push({ field, operator, value: Math.max(0, value) });
    }
  }

  const sortBy = cleanText(call.args.sortBy, 24);
  const allowedSortFields = ['name', 'category', 'price', 'stock'] as const;
  const sort: KyrubiaProductQuerySort | undefined =
    (allowedSortFields as readonly string[]).includes(sortBy)
      ? {
          field: sortBy as KyrubiaProductQuerySort['field'],
          direction: cleanText(call.args.sortDirection, 8) === 'desc' ? 'desc' : 'asc',
        }
      : undefined;

  const result = executeKyrubiaProductQuery(
    context,
    createKyrubiaProductQuery({
      filters,
      sort,
      limit: clampInteger(call.args.limit, 20, 1, MAX_TOOL_ITEMS),
    })
  );

  return {
    available: result.available,
    generatedAt: result.generatedAt,
    query: result.query,
    totalCatalog: context.productCount,
    totalMatched: result.totalMatched,
    returned: result.items.length,
    items: result.items,
    truncated: result.truncated,
    warnings: result.warnings,
  };
};

export const executeKyrubiaSharedReadTool = (
  call: KyrubiaNormalizedToolCall,
  context: KyrubErpContextSnapshot | null
): Record<string, unknown> => {
  if (!isKyrubiaErpReadTool(call.name)) {
    return { available: false, reason: 'unknown_read_action' };
  }
  if (!context) {
    return {
      available: false,
      reason: 'erp_context_unavailable',
      message: 'O Kyrub não conseguiu disponibilizar o snapshot do ERP nesta solicitação.',
    };
  }
  if (call.name === KYRUBIA_QUERY_PRODUCTS_TOOL_NAME) {
    return executeGenericProductQuery(call, context);
  }
  if (call.name === 'read_store_summary') {
    return {
      available: context.availability.store,
      generatedAt: context.generatedAt,
      store: context.store,
      productCount: context.productCount,
      pendingOrderCount: context.pendingOrderCount,
      warnings: context.warnings,
    };
  }
  if (call.name === 'list_products') {
    if (!context.availability.products) {
      return { available: false, reason: 'products_unavailable', warnings: context.warnings };
    }
    const search = cleanText(call.args.search, 120).toLocaleLowerCase('pt-BR');
    const category = cleanText(call.args.category, 120).toLocaleLowerCase('pt-BR');
    const requestedLimit = clampInteger(call.args.limit, 20, 1, MAX_TOOL_ITEMS);
    const filtered = context.products.filter(product => {
      const matchesSearch = !search ||
        product.name.toLocaleLowerCase('pt-BR').includes(search) ||
        product.category.toLocaleLowerCase('pt-BR').includes(search);
      const matchesCategory = !category ||
        product.category.toLocaleLowerCase('pt-BR') === category;
      return matchesSearch && matchesCategory;
    });
    return {
      available: true,
      generatedAt: context.generatedAt,
      totalCatalog: context.productCount,
      returned: Math.min(filtered.length, requestedLimit),
      items: filtered.slice(0, requestedLimit),
      truncated: context.productsTruncated || filtered.length > requestedLimit,
      warnings: context.warnings,
    };
  }
  if (call.name === 'list_low_stock_products') {
    if (!context.availability.products) {
      return { available: false, reason: 'products_unavailable', warnings: context.warnings };
    }
    const threshold = clampInteger(call.args.threshold, context.lowStockThreshold, 0, 999_999);
    const requestedLimit = clampInteger(call.args.limit, 20, 1, MAX_TOOL_ITEMS);
    const lowStock = context.products
      .filter(product => !product.isService && product.stock <= threshold)
      .sort((left, right) =>
        left.stock - right.stock || left.name.localeCompare(right.name, 'pt-BR')
      );
    return {
      available: true,
      generatedAt: context.generatedAt,
      threshold,
      returned: Math.min(lowStock.length, requestedLimit),
      items: lowStock.slice(0, requestedLimit),
      truncated: context.productsTruncated || lowStock.length > requestedLimit,
      warnings: context.warnings,
    };
  }
  if (!context.availability.orders) {
    return { available: false, reason: 'orders_unavailable', warnings: context.warnings };
  }
  const requestedLimit = clampInteger(call.args.limit, 15, 1, 30);
  return {
    available: true,
    generatedAt: context.generatedAt,
    totalPending: context.pendingOrderCount,
    returned: Math.min(context.pendingOrders.length, requestedLimit),
    items: context.pendingOrders.slice(0, requestedLimit),
    truncated: context.ordersTruncated || context.pendingOrders.length > requestedLimit,
    warnings: context.warnings,
  };
};
