import type {
  KyrubErpContextSnapshot,
  KyrubErpProductSummary,
} from './kyrubErpContext';

export type KyrubiaProductQueryField =
  | 'name'
  | 'category'
  | 'price'
  | 'stock'
  | 'isService'
  | 'hasDescription'
  | 'hasImage';

export type KyrubiaProductQueryOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte';

export type KyrubiaProductQueryFilter = {
  field: KyrubiaProductQueryField;
  operator: KyrubiaProductQueryOperator;
  value: string | number | boolean;
};

export type KyrubiaProductQuerySort = {
  field: 'name' | 'category' | 'price' | 'stock';
  direction: 'asc' | 'desc';
};

export type KyrubiaProductQuery = {
  version: 1;
  entity: 'product';
  filters: KyrubiaProductQueryFilter[];
  sort?: KyrubiaProductQuerySort;
  limit: number;
  /**
   * Restricts the query to entities already shown in a previous Kyrub turn.
   * This is runtime context, not authorization. IDs are always revalidated
   * against the current ERP snapshot before they are used.
   */
  candidateIds?: string[];
};

export type KyrubiaProductQueryResult = {
  available: boolean;
  query: KyrubiaProductQuery;
  generatedAt: string;
  totalMatched: number;
  items: KyrubErpProductSummary[];
  truncated: boolean;
  candidateMissingCount: number;
  warnings: string[];
};

const MAX_FILTERS = 12;
const MAX_RESULTS = 50;
const MAX_CANDIDATE_IDS = 50;

const normalizeText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim();

const clampLimit = (value: number): number =>
  Math.min(MAX_RESULTS, Math.max(1, Math.trunc(value || 20)));

const isNumericField = (
  field: KyrubiaProductQueryField
): field is 'price' | 'stock' => field === 'price' || field === 'stock';

const isBooleanField = (
  field: KyrubiaProductQueryField
): field is 'isService' | 'hasDescription' | 'hasImage' =>
  field === 'isService' || field === 'hasDescription' || field === 'hasImage';

const isStringField = (
  field: KyrubiaProductQueryField
): field is 'name' | 'category' => field === 'name' || field === 'category';

const filterMatches = (
  product: KyrubErpProductSummary,
  filter: KyrubiaProductQueryFilter
): boolean => {
  const actual = product[filter.field];

  if (isNumericField(filter.field)) {
    if (typeof filter.value !== 'number' || !Number.isFinite(filter.value)) {
      return false;
    }
    const expected = filter.value;
    if (filter.operator === 'eq') return actual === expected;
    if (filter.operator === 'neq') return actual !== expected;
    if (filter.operator === 'lt') return actual < expected;
    if (filter.operator === 'lte') return actual <= expected;
    if (filter.operator === 'gt') return actual > expected;
    if (filter.operator === 'gte') return actual >= expected;
    return false;
  }

  if (isBooleanField(filter.field)) {
    if (typeof filter.value !== 'boolean') return false;
    if (filter.operator === 'eq') return actual === filter.value;
    if (filter.operator === 'neq') return actual !== filter.value;
    return false;
  }

  if (isStringField(filter.field)) {
    if (typeof filter.value !== 'string') return false;
    const current = normalizeText(actual);
    const expected = normalizeText(filter.value);
    if (filter.operator === 'eq') return current === expected;
    if (filter.operator === 'neq') return current !== expected;
    if (filter.operator === 'contains') return current.includes(expected);
    return false;
  }

  return false;
};

const compareProducts = (
  left: KyrubErpProductSummary,
  right: KyrubErpProductSummary,
  sort: KyrubiaProductQuerySort
): number => {
  const direction = sort.direction === 'desc' ? -1 : 1;
  const leftValue = left[sort.field];
  const rightValue = right[sort.field];

  if (typeof leftValue === 'number' && typeof rightValue === 'number') {
    const numeric = leftValue - rightValue;
    if (numeric !== 0) return numeric * direction;
  } else {
    const lexical = String(leftValue).localeCompare(String(rightValue), 'pt-BR');
    if (lexical !== 0) return lexical * direction;
  }

  return left.name.localeCompare(right.name, 'pt-BR');
};

export const createKyrubiaProductQuery = (
  options: Partial<Omit<KyrubiaProductQuery, 'version' | 'entity'>> = {}
): KyrubiaProductQuery => ({
  version: 1,
  entity: 'product',
  filters: (options.filters ?? []).slice(0, MAX_FILTERS),
  ...(options.sort ? { sort: options.sort } : {}),
  limit: clampLimit(options.limit ?? 20),
  ...(options.candidateIds?.length
    ? {
        candidateIds: [...new Set(options.candidateIds)]
          .filter(Boolean)
          .slice(0, MAX_CANDIDATE_IDS),
      }
    : {}),
});

export const executeKyrubiaProductQuery = (
  context: KyrubErpContextSnapshot | undefined,
  input: KyrubiaProductQuery
): KyrubiaProductQueryResult => {
  const query = createKyrubiaProductQuery(input);
  if (!context || !context.availability.products) {
    return {
      available: false,
      query,
      generatedAt: context?.generatedAt ?? '',
      totalMatched: 0,
      items: [],
      truncated: false,
      candidateMissingCount: 0,
      warnings: context?.warnings ?? [],
    };
  }

  const candidateIds = query.candidateIds?.length
    ? new Set(query.candidateIds)
    : null;
  const availableCandidateIds = candidateIds
    ? new Set(
        context.products
          .filter(product => candidateIds.has(product.id))
          .map(product => product.id)
      )
    : null;
  const candidateMissingCount = candidateIds && availableCandidateIds
    ? candidateIds.size - availableCandidateIds.size
    : 0;

  let items = context.products.filter(product =>
    (!candidateIds || candidateIds.has(product.id)) &&
    query.filters.every(filter => filterMatches(product, filter))
  );

  if (query.sort) {
    items = [...items].sort((left, right) => compareProducts(left, right, query.sort!));
  }

  return {
    available: true,
    query,
    generatedAt: context.generatedAt,
    totalMatched: items.length,
    items: items.slice(0, query.limit),
    truncated: context.productsTruncated || items.length > query.limit,
    candidateMissingCount,
    warnings: context.warnings,
  };
};
