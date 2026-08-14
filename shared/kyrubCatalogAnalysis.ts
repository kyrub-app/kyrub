export type KyrubCatalogAnalysisConfidence = 'low' | 'medium' | 'high';
export type KyrubCatalogAnalysisItemKind = 'product' | 'service' | 'unknown';
export type KyrubCatalogObservedFieldStatus = 'observed' | 'ambiguous' | 'missing';
export type KyrubCatalogAnalysisSourceKind = 'text' | 'multimodal';

export type KyrubCatalogAnalysisItem = {
  ref: string;
  kind: KyrubCatalogAnalysisItemKind;
  name: string;
  category: string;
  description: string;
  price: number | null;
  priceStatus: KyrubCatalogObservedFieldStatus;
  stock: number | null;
  stockStatus: KyrubCatalogObservedFieldStatus;
  variations: string[];
  addOns: string[];
  evidence: string[];
  issues: string[];
};

export type KyrubCatalogAnalysis = {
  schemaVersion: 1;
  sourceKind: KyrubCatalogAnalysisSourceKind;
  attachmentCount: number;
  summary: string;
  segment: string;
  segmentConfidence: KyrubCatalogAnalysisConfidence;
  categories: string[];
  items: KyrubCatalogAnalysisItem[];
  conflicts: string[];
  duplicates: string[];
  warnings: string[];
  readyForDraftCount: number;
  needsReviewCount: number;
  authoritative: false;
  writesPerformed: false;
  publicationStatus: 'analysis_only';
};

const cleanText = (value: unknown, maximum: number): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maximum) : '';

const cleanStringList = (
  value: unknown,
  maximumItems: number,
  maximumCharacters: number
): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => cleanText(item, maximumCharacters))
    .filter(Boolean)
    .slice(0, maximumItems);
};

const cleanNonNegativeNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;

const cleanNonNegativeInteger = (value: unknown): number | null => {
  const number = cleanNonNegativeNumber(value);
  return number === null ? null : Math.trunc(number);
};

const fieldStatus = (value: unknown): KyrubCatalogObservedFieldStatus =>
  value === 'observed' || value === 'ambiguous' ? value : 'missing';

const itemKind = (value: unknown): KyrubCatalogAnalysisItemKind =>
  value === 'product' || value === 'service' ? value : 'unknown';

const confidence = (value: unknown): KyrubCatalogAnalysisConfidence =>
  value === 'high' || value === 'medium' ? value : 'low';

const normalizeItem = (
  value: unknown,
  index: number
): KyrubCatalogAnalysisItem | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const name = cleanText(candidate.name, 180);
  const priceStatus = fieldStatus(candidate.priceStatus);
  const stockStatus = fieldStatus(candidate.stockStatus);
  const observedPrice = priceStatus === 'observed'
    ? cleanNonNegativeNumber(candidate.price)
    : null;
  const observedStock = stockStatus === 'observed'
    ? cleanNonNegativeInteger(candidate.stock)
    : null;

  return {
    ref: cleanText(candidate.ref, 48) || `item-${index + 1}`,
    kind: itemKind(candidate.kind),
    name,
    category: cleanText(candidate.category, 120),
    description: cleanText(candidate.description, 600),
    price: observedPrice,
    priceStatus: observedPrice === null && priceStatus === 'observed'
      ? 'ambiguous'
      : priceStatus,
    stock: observedStock,
    stockStatus: observedStock === null && stockStatus === 'observed'
      ? 'ambiguous'
      : stockStatus,
    variations: cleanStringList(candidate.variations, 20, 120),
    addOns: cleanStringList(candidate.addOns, 20, 120),
    evidence: cleanStringList(candidate.evidence, 8, 180),
    issues: cleanStringList(candidate.issues, 12, 180),
  };
};

const itemNeedsReview = (item: KyrubCatalogAnalysisItem): boolean =>
  !item.name ||
  item.kind === 'unknown' ||
  item.priceStatus !== 'observed' ||
  item.issues.length > 0;

export const normalizeKyrubCatalogAnalysis = (
  value: unknown,
  source: { sourceKind: KyrubCatalogAnalysisSourceKind; attachmentCount: number }
): KyrubCatalogAnalysis | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const items = Array.isArray(candidate.items)
    ? candidate.items
        .map((item, index) => normalizeItem(item, index))
        .filter((item): item is KyrubCatalogAnalysisItem => Boolean(item))
        .slice(0, 120)
    : [];
  const needsReviewCount = items.filter(itemNeedsReview).length;

  return {
    schemaVersion: 1,
    sourceKind: source.sourceKind,
    attachmentCount: Math.max(0, Math.trunc(source.attachmentCount)),
    summary: cleanText(candidate.summary, 800),
    segment: cleanText(candidate.segment, 160),
    segmentConfidence: confidence(candidate.segmentConfidence),
    categories: cleanStringList(candidate.categories, 40, 120),
    items,
    conflicts: cleanStringList(candidate.conflicts, 30, 220),
    duplicates: cleanStringList(candidate.duplicates, 30, 220),
    warnings: cleanStringList(candidate.warnings, 30, 220),
    readyForDraftCount: items.length - needsReviewCount,
    needsReviewCount,
    authoritative: false,
    writesPerformed: false,
    publicationStatus: 'analysis_only',
  };
};

export const summarizeKyrubCatalogAnalysis = (
  analysis: KyrubCatalogAnalysis
): string => {
  const lines = ['Analisei o material sem alterar nem publicar nada no catálogo.'];
  if (analysis.segment) {
    lines.push(`Segmento provável: ${analysis.segment} (${analysis.segmentConfidence}).`);
  }
  lines.push(
    `Itens identificados: ${analysis.items.length}. Prontos para rascunho: ${analysis.readyForDraftCount}. Precisam de revisão: ${analysis.needsReviewCount}.`
  );
  if (analysis.categories.length > 0) {
    lines.push(`Categorias: ${analysis.categories.slice(0, 8).join(', ')}${analysis.categories.length > 8 ? '…' : ''}`);
  }
  const preview = analysis.items.slice(0, 10).map(item => {
    const name = item.name || item.ref;
    const price = item.priceStatus === 'observed' && item.price !== null
      ? `R$ ${item.price.toFixed(2).replace('.', ',')}`
      : item.priceStatus === 'ambiguous'
        ? 'preço ambíguo'
        : 'preço não identificado';
    return `• ${name} — ${price}${item.issues.length ? ` — revisar: ${item.issues[0]}` : ''}`;
  });
  if (preview.length > 0) lines.push('', ...preview);
  if (analysis.items.length > preview.length) {
    lines.push(`…e mais ${analysis.items.length - preview.length} item(ns) estruturado(s).`);
  }
  if (analysis.conflicts.length > 0) {
    lines.push('', `Conflitos: ${analysis.conflicts.slice(0, 3).join(' | ')}`);
  }
  if (analysis.duplicates.length > 0) {
    lines.push(`Possíveis duplicidades: ${analysis.duplicates.slice(0, 3).join(' | ')}`);
  }
  if (analysis.warnings.length > 0) {
    lines.push(`Avisos: ${analysis.warnings.slice(0, 3).join(' | ')}`);
  }
  lines.push('', 'Esta é somente uma análise. Nenhum produto, rascunho ou publicação foi criado.');
  return lines.join('\n');
};
