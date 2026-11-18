export const normalizeCatalogCategoryValue = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR');

export const splitCatalogCategoryPath = (value: string): string[] =>
  value
    .split(/\s*(?:>|\/)\s*/)
    .map(segment => segment.trim())
    .filter(Boolean);

export const joinCatalogCategoryPath = (segments: string[]): string =>
  segments.map(segment => segment.trim()).filter(Boolean).join(' > ');
