import type { KyrubCatalogAnalysis, KyrubCatalogAnalysisItem } from './kyrubCatalogAnalysis';
import type {
  KyrubAiImportCatalogDraftProposal,
  KyrubCatalogDraftImportItem,
} from './kyrubActions';

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

const IMPORT_VERB = /\b(cadastre|cadastrar|cadastro|adicione|adicionar|inclua|incluir|importe|importar|crie|criar|recadastre|recadastrar)\b/;
const PRODUCT_SIGNAL = /\b(produto|produtos|item|itens|cardapio|catalogo|menu|lista|vitrine)\b/;
const CONTEXT_SIGNAL = /\b(esse|esses|essa|essas|deste|destes|dessa|dessas|imagem|foto|anexo|analise|lista|cardapio|catalogo|menu)\b/;

export const isKyrubiaCatalogImportText = (message: string): boolean => {
  const intent = normalize(message);
  return Boolean(
    intent &&
    IMPORT_VERB.test(intent) &&
    PRODUCT_SIGNAL.test(intent) &&
    CONTEXT_SIGNAL.test(intent)
  );
};

export const isKyrubCatalogAnalysisItemReadyForImport = (
  item: KyrubCatalogAnalysisItem
): boolean =>
  Boolean(
    item.name.trim() &&
    item.category.trim() &&
    item.kind !== 'unknown' &&
    item.priceStatus === 'observed' &&
    item.price !== null &&
    item.issues.length === 0
  );

const safeId = (value: string): string =>
  value
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'catalog';

const stableHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

const importItem = (item: KyrubCatalogAnalysisItem): KyrubCatalogDraftImportItem => ({
  ref: safeId(item.ref),
  product: {
    name: item.name.trim(),
    description: item.description.trim(),
    price: item.price ?? undefined,
    ...(item.stockStatus === 'observed' && item.stock !== null
      ? { stock: item.stock }
      : {}),
    category: item.category.trim(),
    isService: item.kind === 'service',
  },
  fieldProvenance: {
    name: 'document_content',
    description: 'document_content',
    price: 'document_content',
    ...(item.stockStatus === 'observed' ? { stock: 'document_content' as const } : {}),
    category: 'document_content',
    isService: 'document_content',
  },
  issues: [],
});

export const buildKyrubiaCatalogImportProposal = (
  analysis: KyrubCatalogAnalysis,
  conversationId: string
): KyrubAiImportCatalogDraftProposal | null => {
  const readyItems = analysis.items.filter(isKyrubCatalogAnalysisItemReadyForImport);
  if (readyItems.length === 0) return null;

  const safeConversationId = safeId(conversationId);
  const fingerprint = stableHash(
    `${safeConversationId}:${readyItems.map(item => `${item.ref}:${item.name}:${item.price}`).join('|')}`
  );

  return {
    id: `catalog-import-${fingerprint}`,
    type: 'import_catalog_draft',
    conversationId: safeConversationId,
    source: {
      kind: 'catalog_analysis',
      conversationId: safeConversationId,
      sourceRefs: readyItems.map(item => safeId(item.ref)),
    },
    items: readyItems.map(importItem),
    requiresConfirmation: true,
    origin: 'kyrubia',
    risk: 'low',
    inputProvenance: 'document_content',
    impact: { entityCount: readyItems.length, reversibility: 'easy' },
    idempotencyKey: `kyrubia:import_catalog_draft:${safeConversationId}:${fingerprint}`,
  };
};
