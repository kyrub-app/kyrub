import type { Product, ProductOptionGroup } from '../types';
import { splitCatalogCategoryPath, joinCatalogCategoryPath } from './catalogCategoryTree';
import {
  parseProductOptionGroups,
  parseProductQuickNotes,
} from './productCustomization';

export interface CatalogCustomizationDefaults {
  path: string;
  quickNotes: string[];
  optionGroups: ProductOptionGroup[];
}

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR');

const normalizePath = (value: string): string =>
  splitCatalogCategoryPath(value).map(normalize).join(' > ');

const isAncestorOrSelf = (candidatePath: string, productPath: string): boolean => {
  const candidate = splitCatalogCategoryPath(candidatePath).map(normalize);
  const product = splitCatalogCategoryPath(productPath).map(normalize);
  return (
    candidate.length >= 2 &&
    candidate.length <= product.length &&
    candidate.every((segment, index) => product[index] === segment)
  );
};

export const parseCatalogCustomizationDefaults = (
  value: unknown
): CatalogCustomizationDefaults[] => {
  if (!Array.isArray(value)) return [];

  const byPath = new Map<string, CatalogCustomizationDefaults>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as Record<string, unknown>;
    const rawPath = typeof record.path === 'string' ? record.path.trim() : '';
    const segments = splitCatalogCategoryPath(rawPath).slice(0, 3);
    if (segments.length < 2) continue;

    const path = joinCatalogCategoryPath(segments);
    byPath.set(normalizePath(path), {
      path,
      quickNotes: parseProductQuickNotes(record.quickNotes),
      optionGroups: parseProductOptionGroups(record.optionGroups),
    });
  }

  return [...byPath.values()].sort(
    (left, right) =>
      splitCatalogCategoryPath(left.path).length -
        splitCatalogCategoryPath(right.path).length ||
      left.path.localeCompare(right.path, 'pt-BR')
  );
};

const mergeQuickNotes = (...sources: unknown[]): string[] =>
  parseProductQuickNotes(sources.flatMap(source => parseProductQuickNotes(source)));

const mergeOptionGroups = (...sources: unknown[]): ProductOptionGroup[] => {
  const byName = new Map<string, ProductOptionGroup>();
  for (const source of sources) {
    for (const group of parseProductOptionGroups(source)) {
      byName.set(normalize(group.name), group);
    }
  }
  return [...byName.values()].slice(0, 10);
};

export const resolveCatalogCustomization = (
  product: Pick<Product, 'category' | 'quickNotes' | 'optionGroups'>,
  defaults: CatalogCustomizationDefaults[]
): { quickNotes: string[]; optionGroups: ProductOptionGroup[] } => {
  const inherited = parseCatalogCustomizationDefaults(defaults)
    .filter(entry => isAncestorOrSelf(entry.path, product.category))
    .sort(
      (left, right) =>
        splitCatalogCategoryPath(left.path).length -
        splitCatalogCategoryPath(right.path).length
    );

  return {
    quickNotes: mergeQuickNotes(
      ...inherited.map(entry => entry.quickNotes),
      product.quickNotes
    ),
    optionGroups: mergeOptionGroups(
      ...inherited.map(entry => entry.optionGroups),
      product.optionGroups
    ),
  };
};

export const upsertCatalogCustomizationDefaults = (
  current: CatalogCustomizationDefaults[],
  path: string,
  patch: {
    quickNotes?: unknown;
    optionGroups?: unknown;
  }
): CatalogCustomizationDefaults[] => {
  const segments = splitCatalogCategoryPath(path).slice(0, 3);
  if (segments.length < 2) {
    throw new Error('Os padrões podem ser definidos apenas em Grupo ou Subgrupo.');
  }
  const cleanPath = joinCatalogCategoryPath(segments);
  const key = normalizePath(cleanPath);
  const parsed = parseCatalogCustomizationDefaults(current);
  const existing = parsed.find(entry => normalizePath(entry.path) === key);
  const next: CatalogCustomizationDefaults = {
    path: cleanPath,
    quickNotes: patch.quickNotes === undefined
      ? existing?.quickNotes ?? []
      : parseProductQuickNotes(patch.quickNotes),
    optionGroups: patch.optionGroups === undefined
      ? existing?.optionGroups ?? []
      : parseProductOptionGroups(patch.optionGroups),
  };

  return [
    ...parsed.filter(entry => normalizePath(entry.path) !== key),
    next,
  ].sort(
    (left, right) =>
      splitCatalogCategoryPath(left.path).length -
        splitCatalogCategoryPath(right.path).length ||
      left.path.localeCompare(right.path, 'pt-BR')
  );
};
