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
const BULK_PRODUCT_SIGNAL = /\b(produtos|itens|cardapio|catalogo|menu|lista)\b/;
const SINGLE_PRODUCT_REFERENCE =
  /\b(?:um|1)\s+(?:unico|so)\s+produto\b|\b(?:mesmo|unico)\s+produto\b|\bproduto\s+chamad[oa]\b/;
const CONTEXT_SIGNAL = /\b(esse|esses|essa|essas|deste|destes|dessa|dessas|imagem|imagens|img|foto|fotos|anexo|anexado|anexada|anexados|anexadas|arquivo|print|screenshot|captura|analise|lista|cardapio|catalogo|menu)\b/;
const EXPLICIT_OTHER_ARTIFACT = /\b(?:nota|notas|tarefa|tarefas|lembrete|lembretes|checklist)\b/;

export const isKyrubiaCatalogImportText = (message: string): boolean => {
  const intent = normalize(message);
  if (
    !intent ||
    EXPLICIT_OTHER_ARTIFACT.test(intent) ||
    !IMPORT_VERB.test(intent) ||
    !CONTEXT_SIGNAL.test(intent)
  ) {
    return false;
  }

  // Imagens podem ser apenas referências visuais do mesmo produto. Esse caso
  // pertence ao fluxo normal de criação de produto e não ao importador em lote
  // de catálogo/cardápio. A ressalva vem antes do plural porque a própria
  // frase pode negar múltiplos produtos ("não são três produtos").
  if (SINGLE_PRODUCT_REFERENCE.test(intent)) return false;

  return BULK_PRODUCT_SIGNAL.test(intent);
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
