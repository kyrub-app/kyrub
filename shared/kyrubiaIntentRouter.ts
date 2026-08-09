import type { KyrubiaTurnContext } from './kyrubiaContext';
import type {
  KyrubiaProductQueryFilter,
  KyrubiaProductQuerySort,
} from './kyrubiaQueryLanguage';

export type KyrubiaLocalProductIntentKind =
  | 'catalog'
  | 'missing_image'
  | 'missing_description'
  | 'low_stock'
  | 'filtered';

export type KyrubiaLocalProductIntent = {
  entity: 'product';
  operation: 'query';
  filters: KyrubiaProductQueryFilter[];
  sort?: KyrubiaProductQuerySort;
  limit: number;
  candidateIds?: string[];
  saveAsNote: boolean;
  kind: KyrubiaLocalProductIntentKind;
  title: string;
  matchedConcepts: string[];
};

export const normalizeKyrubiaIntentText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9$.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const KYRUBIA_OPEN_REASONING =
  /\b(analise|analisar|priorize|priorizar|recomende|recomendar|sugira|sugerir|compare|comparar|explique|explicar|estrategia|estrategias|oportunidade|oportunidades|avalie|avaliar|diagnostique|diagnosticar)\b|\bpor que\b/;

export const KYRUBIA_MUTATION_VERBS =
  /\b(crie|criar|adicione|adicionar|salve|salvar|guarde|guardar|registre|registrar|altere|alterar|mude|mudar|atualize|atualizar|exclua|excluir|apague|apagar|publique|publicar|desconte|aplique|aplicar)\b/;

const QUERY_VERBS = new Set([
  'liste', 'listar', 'mostre', 'mostrar', 'quais', 'qual', 'ver', 'veja',
  'encontre', 'encontrar', 'pegue', 'pegar', 'separe', 'separar', 'traga',
  'buscar', 'busque', 'procure', 'procurar', 'quero', 'exiba', 'exibir',
]);

const PRODUCT_NOUNS = new Set([
  'produto', 'produtos', 'item', 'itens', 'catalogo', 'mercadoria',
  'mercadorias', 'artigo', 'artigos', 'produto-fisico', 'produtos-fisicos',
]);

const SERVICE_NOUNS = new Set(['servico', 'servicos']);
const PHYSICAL_CUES = [
  'produto fisico', 'produtos fisicos', 'item fisico', 'itens fisicos',
  'mercadoria', 'mercadorias',
];

const IMAGE_TERMS = ['imagem', 'imagens', 'foto', 'fotos', 'fotografia', 'fotografias', 'midia visual'];
const DESCRIPTION_TERMS = ['descricao', 'descricoes', 'texto descritivo'];
const STOCK_TERMS = ['estoque', 'unidade', 'unidades', 'saldo de estoque', 'quantidade em estoque'];
const PRICE_TERMS = ['preco', 'precos', 'valor', 'valores'];

const MISSING_CUES = ['sem', 'faltando', 'ausente', 'ausentes', 'nao tem', 'nao possui', 'nao possuem', 'falta', 'faltam'];
const PRESENT_CUES = ['com', 'tem', 'possuem', 'possui'];
const CONTEXT_CUES = ['desses', 'dessas', 'daqueles', 'daquelas', 'dessa lista', 'daquela lista', 'deles', 'delas'];

const NUMBER_WORDS: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  quatorze: 14,
  catorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezessete: 17,
  dezoito: 18,
  dezenove: 19,
  vinte: 20,
  trinta: 30,
  quarenta: 40,
  cinquenta: 50,
};

const NUMBER_PATTERN =
  '(?:\\d+(?:[.,]\\d+)?|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta)';

const parseLocalizedNumber = (value: string | undefined): number | null => {
  if (!value) return null;
  const normalized = value.trim().toLocaleLowerCase('pt-BR');
  if (normalized in NUMBER_WORDS) return NUMBER_WORDS[normalized];
  const parsed = Number(normalized.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

const containsPhrase = (intent: string, phrase: string): boolean =>
  ` ${intent} `.includes(` ${phrase} `);

const containsAnyPhrase = (intent: string, phrases: string[]): boolean =>
  phrases.some(phrase => containsPhrase(intent, phrase));

const intentTokens = (intent: string): string[] => intent.split(' ').filter(Boolean);

const hasAnyToken = (tokens: string[], vocabulary: Set<string>): boolean =>
  tokens.some(token => vocabulary.has(token));

const phrasePositions = (intent: string, terms: string[]): Array<{ start: number; end: number; term: string }> => {
  const results: Array<{ start: number; end: number; term: string }> = [];
  for (const term of terms) {
    let cursor = 0;
    while (cursor < intent.length) {
      const index = intent.indexOf(term, cursor);
      if (index < 0) break;
      const before = index === 0 ? ' ' : intent[index - 1];
      const afterIndex = index + term.length;
      const after = afterIndex >= intent.length ? ' ' : intent[afterIndex];
      if (/\s/.test(before) && /\s/.test(after)) {
        results.push({ start: index, end: afterIndex, term });
      }
      cursor = index + term.length;
    }
  }
  return results;
};

const localWindow = (
  intent: string,
  position: { start: number; end: number },
  radius = 28
): string => intent.slice(
  Math.max(0, position.start - radius),
  Math.min(intent.length, position.end + radius)
);

const booleanFieldFilter = (
  intent: string,
  field: 'hasImage' | 'hasDescription',
  terms: string[]
): KyrubiaProductQueryFilter | null => {
  for (const position of phrasePositions(intent, terms)) {
    const window = localWindow(intent, position);
    if (containsAnyPhrase(window, MISSING_CUES)) {
      return { field, operator: 'eq', value: false };
    }
    if (containsAnyPhrase(window, PRESENT_CUES)) {
      return { field, operator: 'eq', value: true };
    }
  }
  return null;
};

type NumericOperator = Extract<
  KyrubiaProductQueryFilter['operator'],
  'eq' | 'lt' | 'lte' | 'gt' | 'gte'
>;

const COMPARATORS: Array<{ operator: NumericOperator; phrase: string }> = [
  { operator: 'lte', phrase: 'menor ou igual a' },
  { operator: 'lte', phrase: 'no maximo' },
  { operator: 'lte', phrase: 'ate' },
  { operator: 'lt', phrase: 'abaixo de' },
  { operator: 'lt', phrase: 'menor que' },
  { operator: 'lt', phrase: 'menos de' },
  { operator: 'gte', phrase: 'maior ou igual a' },
  { operator: 'gte', phrase: 'pelo menos' },
  { operator: 'gte', phrase: 'no minimo' },
  { operator: 'gte', phrase: 'a partir de' },
  { operator: 'gt', phrase: 'acima de' },
  { operator: 'gt', phrase: 'maior que' },
  { operator: 'gt', phrase: 'mais de' },
  { operator: 'eq', phrase: 'exatamente' },
  { operator: 'eq', phrase: 'igual a' },
];

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const numericFieldFilter = (
  intent: string,
  field: 'stock' | 'price',
  terms: string[]
): KyrubiaProductQueryFilter | null => {
  const termPattern = terms.map(escapeRegex).join('|');
  const currency = field === 'price' ? '(?:r\\$\\s*)?' : '';
  const unitSuffix = field === 'stock' ? '(?:\\s+unidades?)?' : '(?:\\s+reais?)?';

  for (const { operator, phrase } of COMPARATORS) {
    const comparator = escapeRegex(phrase);
    const patterns = [
      new RegExp(`\\b(?:${termPattern})(?:\\s+de)?\\s+${comparator}\\s+${currency}(${NUMBER_PATTERN})${unitSuffix}\\b`),
      new RegExp(`\\b${comparator}\\s+${currency}(${NUMBER_PATTERN})${unitSuffix}\\s+(?:de\\s+)?(?:${termPattern})\\b`),
    ];
    if (field === 'stock') {
      patterns.push(
        new RegExp(`\\b${comparator}\\s+(${NUMBER_PATTERN})\\s+unidades?\\b`)
      );
    }
    if (field === 'price') {
      patterns.push(
        new RegExp(`\\b${comparator}\\s+(?:r\\$\\s*)(${NUMBER_PATTERN})(?:\\s+reais?)?\\b`)
      );
    }

    for (const pattern of patterns) {
      const match = pattern.exec(intent);
      const value = parseLocalizedNumber(match?.[1]);
      if (value !== null) return { field, operator, value };
    }
  }
  return null;
};

const extractSort = (intent: string): KyrubiaProductQuerySort | undefined => {
  const priceDesc = [
    'mais caro', 'mais caros', 'maior preco', 'maiores precos', 'maior valor',
    'maiores valores', 'de maior valor', 'precos mais altos', 'valores mais altos',
  ];
  const priceAsc = [
    'mais barato', 'mais baratos', 'menor preco', 'menores precos', 'menor valor',
    'menores valores', 'de menor valor', 'precos mais baixos', 'valores mais baixos',
  ];
  const stockAsc = [
    'menor estoque', 'menores estoques', 'estoque mais baixo', 'estoques mais baixos',
    'menos unidades', 'mais critico', 'mais criticos',
  ];
  const stockDesc = [
    'maior estoque', 'maiores estoques', 'estoque mais alto', 'estoques mais altos',
    'mais unidades',
  ];

  if (containsAnyPhrase(intent, priceDesc)) return { field: 'price', direction: 'desc' };
  if (containsAnyPhrase(intent, priceAsc)) return { field: 'price', direction: 'asc' };
  if (containsAnyPhrase(intent, stockAsc)) return { field: 'stock', direction: 'asc' };
  if (containsAnyPhrase(intent, stockDesc)) return { field: 'stock', direction: 'desc' };
  if (containsAnyPhrase(intent, ['ordem alfabetica', 'alfabetica', 'alfabetico'])) {
    return { field: 'name', direction: 'asc' };
  }
  return undefined;
};

const extractLimit = (intent: string): number => {
  const entity = '(?:produtos?|itens?|mercadorias?|artigos?|servicos?)';
  const ordering = '(?:de\\s+(?:maior|menor)\\s+(?:valor|preco)|mais\\s+(?:caros?|baratos?)|primeiros?|primeiras?)';
  const patterns = [
    new RegExp(`\\btop\\s+(${NUMBER_PATTERN})\\b`),
    new RegExp(`\\b(${NUMBER_PATTERN})\\s+(?:primeiros|primeiras)\\b`),
    new RegExp(`\\b(?:primeiros|primeiras)\\s+(${NUMBER_PATTERN})\\b`),
    new RegExp(`\\b(?:os|as)?\\s*(${NUMBER_PATTERN})\\s+${entity}\\b`),
    new RegExp(`\\b(?:liste|mostre|pegue|separe|traga|quero|exiba)\\s+(?:os|as)?\\s*(${NUMBER_PATTERN})\\b`),
    new RegExp(`\\b(?:os|as)\\s+(${NUMBER_PATTERN})\\s+${ordering}\\b`),
  ];

  for (const pattern of patterns) {
    const value = parseLocalizedNumber(pattern.exec(intent)?.[1]);
    if (value !== null) return Math.min(50, Math.max(1, Math.trunc(value)));
  }
  return 20;
};

export const kyrubiaAsksToSaveAsNote = (intent: string): boolean =>
  /\b(nota|notas)\b/.test(intent) &&
  /\b(salve|salvar|guarde|guardar|registre|registrar|crie|criar|adicione|adicionar|anote|anotar)\b/.test(intent);

const hasLowStockConcept = (intent: string): boolean =>
  containsAnyPhrase(intent, [
    'estoque baixo', 'baixo estoque', 'estoque minimo', 'pouco estoque',
    'estoque acabando', 'estoques acabando', 'quase sem estoque',
  ]);

const dedupeFilters = (
  filters: KyrubiaProductQueryFilter[]
): KyrubiaProductQueryFilter[] => {
  const seen = new Set<string>();
  return filters.filter(filter => {
    const key = `${filter.field}:${filter.operator}:${String(filter.value)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const routeKyrubiaLocalProductIntent = (
  message: string,
  options: {
    lowStockThreshold?: number;
    turnContext?: KyrubiaTurnContext;
  } = {}
): KyrubiaLocalProductIntent | null => {
  const intent = normalizeKyrubiaIntentText(message);
  if (!intent || KYRUBIA_OPEN_REASONING.test(intent)) return null;

  const tokens = intentTokens(intent);
  const saveAsNote = kyrubiaAsksToSaveAsNote(intent);
  const imageFilter = booleanFieldFilter(intent, 'hasImage', IMAGE_TERMS);
  const descriptionFilter = booleanFieldFilter(intent, 'hasDescription', DESCRIPTION_TERMS);
  const stockFilter = numericFieldFilter(intent, 'stock', STOCK_TERMS);
  const priceFilter = numericFieldFilter(intent, 'price', PRICE_TERMS);
  const lowStock = hasLowStockConcept(intent);
  const sort = extractSort(intent) ??
    (lowStock ? { field: 'stock' as const, direction: 'asc' as const } : undefined);

  const explicitProduct = hasAnyToken(tokens, PRODUCT_NOUNS);
  const explicitService = hasAnyToken(tokens, SERVICE_NOUNS);
  const explicitPhysical = containsAnyPhrase(intent, PHYSICAL_CUES);
  const hasFieldSignal = Boolean(
    imageFilter || descriptionFilter || stockFilter || priceFilter || lowStock || sort
  );
  const hasQueryVerb = hasAnyToken(tokens, QUERY_VERBS);
  const hasContextCue = containsAnyPhrase(intent, CONTEXT_CUES);

  if (!explicitProduct && !explicitService && !hasFieldSignal && !hasContextCue) {
    return null;
  }
  if (!hasQueryVerb && !saveAsNote && !hasFieldSignal && !hasContextCue) {
    return null;
  }

  const filters: KyrubiaProductQueryFilter[] = [];
  if (imageFilter) filters.push(imageFilter);
  if (descriptionFilter) filters.push(descriptionFilter);
  if (stockFilter) {
    filters.push(stockFilter);
  } else if (lowStock) {
    filters.push({ field: 'stock', operator: 'lte', value: options.lowStockThreshold ?? 5 });
    filters.push({ field: 'isService', operator: 'eq', value: false });
  }
  if (priceFilter) filters.push(priceFilter);
  if (explicitPhysical) filters.push({ field: 'isService', operator: 'eq', value: false });
  if (explicitService && !explicitProduct) {
    filters.push({ field: 'isService', operator: 'eq', value: true });
  }

  const candidateIds = hasContextCue &&
    options.turnContext?.entities.length &&
    options.turnContext.entities.every(entity => entity.entityType === 'product')
      ? options.turnContext.entities.map(entity => entity.entityId)
      : undefined;

  let kind: KyrubiaLocalProductIntentKind = 'filtered';
  let title = 'Consulta de produtos';
  if (lowStock && !imageFilter && !descriptionFilter && !priceFilter) {
    kind = 'low_stock';
    title = 'Produtos com estoque baixo';
  } else if (imageFilter?.value === false && !descriptionFilter && !stockFilter && !priceFilter && !lowStock) {
    kind = 'missing_image';
    title = 'Produtos sem imagem';
  } else if (descriptionFilter?.value === false && !imageFilter && !stockFilter && !priceFilter && !lowStock) {
    kind = 'missing_description';
    title = 'Produtos sem descrição';
  } else if (filters.length === 0 && !sort) {
    kind = 'catalog';
    title = 'Produtos do catálogo';
  }

  const matchedConcepts = [
    explicitProduct ? 'entity:product' : '',
    explicitService ? 'entity:service' : '',
    imageFilter ? 'field:image' : '',
    descriptionFilter ? 'field:description' : '',
    stockFilter || lowStock ? 'field:stock' : '',
    priceFilter ? 'field:price' : '',
    sort ? `sort:${sort.field}:${sort.direction}` : '',
    saveAsNote ? 'compose:create_note' : '',
    candidateIds?.length ? 'scope:previous_products' : '',
  ].filter(Boolean);

  return {
    entity: 'product',
    operation: 'query',
    filters: dedupeFilters(filters),
    ...(sort ? { sort } : {}),
    limit: extractLimit(intent),
    ...(candidateIds?.length ? { candidateIds } : {}),
    saveAsNote,
    kind,
    title,
    matchedConcepts,
  };
};
