export const KYRUB_CATALOG_ANALYSIS_MAX_ITEMS = 60 as const;

export type KyrubCatalogAnalysisConfidence = 'low' | 'medium' | 'high';
export type KyrubCatalogAnalysisItemKind = 'product' | 'service' | 'unknown';
export type KyrubCatalogObservedFieldStatus = 'observed' | 'ambiguous' | 'missing';
export type KyrubCatalogAnalysisSourceKind = 'text' | 'multimodal';

export type KyrubCatalogObservedCharacterEvidence = {
  char: string;
  confidence: KyrubCatalogAnalysisConfidence;
};

export type KyrubCatalogObservedEvidence = {
  sourceRefText: string;
  sourceRefCharacters: KyrubCatalogObservedCharacterEvidence[];
  sourceRefCharacterProofValid: boolean;
  nameText: string;
  categoryText: string;
  descriptionText: string;
  priceText: string;
  sourceRefConfidence: KyrubCatalogAnalysisConfidence;
  nameConfidence: KyrubCatalogAnalysisConfidence;
  categoryConfidence: KyrubCatalogAnalysisConfidence;
  descriptionConfidence: KyrubCatalogAnalysisConfidence;
  priceConfidence: KyrubCatalogAnalysisConfidence;
  confidence: KyrubCatalogAnalysisConfidence;
};

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
  observed: KyrubCatalogObservedEvidence;
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

const evidenceValue = (evidence: string[], key: string, maximum: number): string => {
  const prefix = `${key.toLowerCase()}:`;
  const match = evidence.find(item => item.toLowerCase().startsWith(prefix));
  return match ? cleanText(match.slice(prefix.length), maximum) : '';
};

const evidenceConfidence = (evidence: string[]): KyrubCatalogAnalysisConfidence =>
  confidence(evidenceValue(evidence, 'confidence', 16).toLowerCase());

const evidenceFieldConfidence = (
  evidence: string[],
  key: string
): KyrubCatalogAnalysisConfidence => {
  const explicit = evidenceValue(evidence, `${key}_confidence`, 16).toLowerCase();
  return explicit ? confidence(explicit) : evidenceConfidence(evidence);
};

const parseSourceRefCharacters = (
  evidence: string[]
): KyrubCatalogObservedCharacterEvidence[] => {
  const raw = evidenceValue(evidence, 'code_chars', 320);
  if (!raw) return [];
  return raw
    .split('|')
    .map(part => {
      const match = part.trim().match(/^(.*)=(high|medium|low)$/i);
      if (!match) return null;
      const char = match[1];
      if (!char || Array.from(char).length !== 1) return null;
      return { char, confidence: confidence(match[2].toLowerCase()) };
    })
    .filter((entry): entry is KyrubCatalogObservedCharacterEvidence => Boolean(entry));
};

const hasValidSourceRefCharacterProof = (
  sourceRefText: string,
  characters: KyrubCatalogObservedCharacterEvidence[]
): boolean => {
  if (!sourceRefText) return false;
  const sourceCharacters = Array.from(sourceRefText);
  return sourceCharacters.length === characters.length &&
    sourceCharacters.every((char, index) =>
      characters[index]?.char === char && characters[index]?.confidence === 'high'
    );
};

const VISUAL_RISK_PATTERN = /(reflex|reflection|glare|brilho|shine|sombra|shadow|blur|borrad|desfoc|crop|cortad|overlap|sobrepos|obstru|incert|ambigu|ileg[ií]vel|unclear|uncertain)/i;

const VISUAL_FIELD_PATTERNS = {
  sourceRef: /(c[oó]digo|sku|refer[eê]ncia|numera|d[ií]gito|code|reference|digit)/i,
  name: /(nome|name|t[ií]tulo|title)/i,
  category: /(categoria|category|se[cç][aã]o|heading)/i,
  description: /(descri[cç][aã]o|description|texto|text|ingrediente)/i,
  price: /(pre[cç]o|valor|price|amount|r\$)/i,
} as const;

const downgradeHighConfidence = (
  value: KyrubCatalogAnalysisConfidence
): KyrubCatalogAnalysisConfidence => value === 'high' ? 'medium' : value;

const calibrateObservedConfidenceFromIssues = (
  observed: KyrubCatalogObservedEvidence,
  issues: string[]
): KyrubCatalogObservedEvidence => {
  const riskIssues = issues.filter(issue => VISUAL_RISK_PATTERN.test(issue));
  if (riskIssues.length === 0) return observed;

  const riskText = riskIssues.join(' | ');
  const mentionsSpecificField = Object.values(VISUAL_FIELD_PATTERNS)
    .some(pattern => pattern.test(riskText));
  const affects = (pattern: RegExp): boolean =>
    !mentionsSpecificField || pattern.test(riskText);

  return {
    ...observed,
    sourceRefConfidence: observed.sourceRefText && affects(VISUAL_FIELD_PATTERNS.sourceRef)
      ? downgradeHighConfidence(observed.sourceRefConfidence)
      : observed.sourceRefConfidence,
    nameConfidence: observed.nameText && affects(VISUAL_FIELD_PATTERNS.name)
      ? downgradeHighConfidence(observed.nameConfidence)
      : observed.nameConfidence,
    categoryConfidence: observed.categoryText && affects(VISUAL_FIELD_PATTERNS.category)
      ? downgradeHighConfidence(observed.categoryConfidence)
      : observed.categoryConfidence,
    descriptionConfidence: observed.descriptionText && affects(VISUAL_FIELD_PATTERNS.description)
      ? downgradeHighConfidence(observed.descriptionConfidence)
      : observed.descriptionConfidence,
    priceConfidence: observed.priceText && affects(VISUAL_FIELD_PATTERNS.price)
      ? downgradeHighConfidence(observed.priceConfidence)
      : observed.priceConfidence,
    confidence: downgradeHighConfidence(observed.confidence),
  };
};

const normalizeItem = (
  value: unknown,
  index: number,
  sourceKind: KyrubCatalogAnalysisSourceKind
): KyrubCatalogAnalysisItem | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const candidateName = cleanText(candidate.name, 180);
  const candidateCategory = cleanText(candidate.category, 120);
  const candidateDescription = cleanText(candidate.description, 600);
  const requestedPriceStatus = fieldStatus(candidate.priceStatus);
  const stockStatus = fieldStatus(candidate.stockStatus);
  const candidatePrice = requestedPriceStatus === 'observed'
    ? cleanNonNegativeNumber(candidate.price)
    : null;
  const observedStock = stockStatus === 'observed'
    ? cleanNonNegativeInteger(candidate.stock)
    : null;
  const evidence = cleanStringList(candidate.evidence, 20, 320);
  const overallConfidence = evidenceConfidence(evidence);
  const issues = cleanStringList(candidate.issues, 12, 180);
  const sourceRefText = sourceKind === 'multimodal'
    ? evidenceValue(evidence, 'code', 80) || evidenceValue(evidence, 'source_ref', 80)
    : '';
  const sourceRefCharacters = sourceKind === 'multimodal'
    ? parseSourceRefCharacters(evidence)
    : [];
  const sourceRefCharacterProofValid = sourceKind === 'multimodal'
    ? hasValidSourceRefCharacterProof(sourceRefText, sourceRefCharacters)
    : true;
  const declaredSourceRefConfidence = evidenceFieldConfidence(evidence, 'code');
  const failClosedSourceRefConfidence: KyrubCatalogAnalysisConfidence =
    sourceKind === 'multimodal' && sourceRefText && !sourceRefCharacterProofValid
      ? downgradeHighConfidence(declaredSourceRefConfidence)
      : declaredSourceRefConfidence;

  const initialObserved: KyrubCatalogObservedEvidence = sourceKind === 'multimodal'
    ? {
        sourceRefText,
        sourceRefCharacters,
        sourceRefCharacterProofValid,
        nameText: evidenceValue(evidence, 'name', 180),
        categoryText: evidenceValue(evidence, 'category', 120),
        descriptionText: evidenceValue(evidence, 'description', 600),
        priceText: evidenceValue(evidence, 'price', 80),
        sourceRefConfidence: failClosedSourceRefConfidence,
        nameConfidence: evidenceFieldConfidence(evidence, 'name'),
        categoryConfidence: evidenceFieldConfidence(evidence, 'category'),
        descriptionConfidence: evidenceFieldConfidence(evidence, 'description'),
        priceConfidence: evidenceFieldConfidence(evidence, 'price'),
        confidence: overallConfidence,
      }
    : {
        sourceRefText: '',
        sourceRefCharacters: [],
        sourceRefCharacterProofValid: true,
        nameText: candidateName,
        categoryText: candidateCategory,
        descriptionText: candidateDescription,
        priceText: candidatePrice === null ? '' : String(candidatePrice),
        sourceRefConfidence: 'high',
        nameConfidence: 'high',
        categoryConfidence: 'high',
        descriptionConfidence: 'high',
        priceConfidence: 'high',
        confidence: 'high',
      };
  const observed = sourceKind === 'multimodal'
    ? calibrateObservedConfidenceFromIssues(initialObserved, issues)
    : initialObserved;

  const name = sourceKind === 'multimodal'
    ? observed.nameText && observed.nameConfidence === 'high' ? candidateName : ''
    : candidateName;
  const category = sourceKind === 'multimodal'
    ? observed.categoryText && observed.categoryConfidence === 'high' ? candidateCategory : ''
    : candidateCategory;
  const description = sourceKind === 'multimodal'
    ? observed.descriptionText && observed.descriptionConfidence === 'high' ? candidateDescription : ''
    : candidateDescription;
  const observedPrice = sourceKind === 'multimodal'
    ? requestedPriceStatus === 'observed' &&
      observed.priceText &&
      observed.priceConfidence === 'high'
        ? candidatePrice
        : null
    : candidatePrice;
  const priceStatus: KyrubCatalogObservedFieldStatus = requestedPriceStatus === 'observed'
    ? observedPrice === null ? 'ambiguous' : 'observed'
    : requestedPriceStatus;

  if (sourceKind === 'multimodal') {
    if (!observed.nameText) {
      issues.push('Nome sem transcrição-fonte verificável.');
    } else if (observed.nameConfidence !== 'high') {
      issues.push('Nome visual ambíguo; confirme na fonte antes de usar.');
    }
    if (observed.sourceRefText && !observed.sourceRefCharacterProofValid) {
      issues.push('Código/referência visual sem prova completa por caractere; confirme na fonte antes de usar.');
    } else if (observed.sourceRefText && observed.sourceRefConfidence !== 'high') {
      issues.push('Código/referência visual ambíguo; confirme na fonte antes de usar.');
    }
    if (candidateCategory && (!observed.categoryText || observed.categoryConfidence !== 'high')) {
      issues.push('Categoria organizada sem evidência visual de alta confiança.');
    }
    if (requestedPriceStatus === 'observed') {
      if (!observed.priceText) {
        issues.push('Preço marcado como observado sem transcrição-fonte verificável.');
      } else if (observed.priceConfidence !== 'high') {
        issues.push('Preço visual ambíguo; confirme na fonte antes de usar.');
      }
    }
    if (observed.confidence !== 'high') {
      issues.push('Leitura do material requer confirmação humana.');
    }
  }

  return {
    ref: cleanText(candidate.ref, 48) || `item-${index + 1}`,
    kind: itemKind(candidate.kind),
    name,
    category,
    description,
    price: observedPrice,
    priceStatus,
    stock: observedStock,
    stockStatus: observedStock === null && stockStatus === 'observed'
      ? 'ambiguous'
      : stockStatus,
    variations: cleanStringList(candidate.variations, 20, 120),
    addOns: cleanStringList(candidate.addOns, 20, 120),
    evidence,
    observed,
    issues: [...new Set(issues)].slice(0, 12),
  };
};

const itemNeedsReview = (item: KyrubCatalogAnalysisItem): boolean =>
  !item.name ||
  !item.category ||
  item.kind === 'unknown' ||
  item.priceStatus !== 'observed' ||
  item.issues.length > 0;

export const normalizeKyrubCatalogAnalysis = (
  value: unknown,
  source: { sourceKind: KyrubCatalogAnalysisSourceKind; attachmentCount: number }
): KyrubCatalogAnalysis | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const rawItems = Array.isArray(candidate.items) ? candidate.items : [];
  const normalizedItems = rawItems
    .map((item, index) => normalizeItem(item, index, source.sourceKind))
    .filter((item): item is KyrubCatalogAnalysisItem => Boolean(item));
  const truncated = rawItems.length > KYRUB_CATALOG_ANALYSIS_MAX_ITEMS;
  const items = normalizedItems.slice(0, KYRUB_CATALOG_ANALYSIS_MAX_ITEMS);
  const needsReviewCount = items.filter(itemNeedsReview).length;
  const warnings = cleanStringList(candidate.warnings, truncated ? 29 : 30, 220);
  if (truncated) {
    warnings.push(
      `A análise foi truncada pelo Kyrub ao limite de ${KYRUB_CATALOG_ANALYSIS_MAX_ITEMS} itens.`
    );
  }

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
    warnings,
    readyForDraftCount: items.length - needsReviewCount,
    needsReviewCount,
    authoritative: false,
    writesPerformed: false,
    publicationStatus: 'analysis_only',
  };
};

const money = (value: number): string =>
  `R$ ${value.toFixed(2).replace('.', ',')}`;

const uncertain = (label: string, value: string): string =>
  `[${label} incerto: ${value}]`;

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

  if (analysis.items.length > 0) {
    lines.push('', 'Transcrição estruturada do material:');
    for (const item of analysis.items) {
      const code = item.observed.sourceRefText
        ? item.observed.sourceRefConfidence === 'high' && item.observed.sourceRefCharacterProofValid
          ? item.observed.sourceRefText
          : uncertain('código', item.observed.sourceRefText)
        : '';
      const nameSource = item.observed.nameText || item.name || item.ref;
      const observedName = item.observed.nameText && item.observed.nameConfidence !== 'high'
        ? uncertain('nome', item.observed.nameText)
        : nameSource;
      const price = item.observed.priceText
        ? item.observed.priceConfidence === 'high'
          ? item.observed.priceText
          : uncertain('preço', item.observed.priceText)
        : item.priceStatus === 'observed' && item.price !== null
          ? money(item.price)
          : item.priceStatus === 'ambiguous'
            ? 'preço ambíguo'
            : 'preço não identificado';
      const organizedDiffers = Boolean(
        item.name &&
        item.observed.nameText &&
        item.observed.nameConfidence === 'high' &&
        item.name !== item.observed.nameText
      );
      const review = item.issues.length ? ` — revisar: ${item.issues[0]}` : '';
      lines.push(
        `• ${code ? `${code} ` : ''}${observedName} — ${price}${organizedDiffers ? ` — organizado como: ${item.name}` : ''}${review}`
      );
      if (item.observed.descriptionText) {
        const description = item.observed.descriptionConfidence === 'high'
          ? item.observed.descriptionText
          : uncertain('descrição', item.observed.descriptionText);
        lines.push(`  ↳ ${description}`);
      }
    }
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