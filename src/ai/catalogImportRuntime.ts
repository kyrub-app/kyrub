import type { KyrubAiConsultantResponse } from '../../shared/aiConsultant';
import type {
  KyrubAiImportCatalogDraftProposal,
  KyrubCatalogDraftImportItem,
} from '../../shared/kyrubActions';
import type { KyrubCatalogAnalysisItem } from '../../shared/kyrubCatalogAnalysis';
import { loadKyrubiaCatalogAnalysis } from './catalogAnalysisStore';

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

const IMPORT_VERB = /\b(cadastre|cadastrar|cadastro|adicione|adicionar|inclua|incluir|importe|importar|crie|criar)\b/;
const PRODUCT_SIGNAL = /\b(produto|produtos|item|itens|cardapio|catalogo|menu|lista|vitrine)\b/;
const CONTEXT_SIGNAL = /\b(esse|esses|essa|essas|deste|destes|dessa|dessas|imagem|foto|anexo|analise|lista|cardapio|catalogo|menu)\b/;

export const isKyrubiaCatalogImportRequest = (message: string): boolean => {
  const intent = normalize(message);
  return Boolean(
    intent &&
    IMPORT_VERB.test(intent) &&
    PRODUCT_SIGNAL.test(intent) &&
    CONTEXT_SIGNAL.test(intent)
  );
};

const stableHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

const safeId = (value: string): string =>
  value
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'catalog';

const isReadyItem = (item: KyrubCatalogAnalysisItem): boolean =>
  Boolean(
    item.name.trim() &&
    item.category.trim() &&
    item.kind !== 'unknown' &&
    item.priceStatus === 'observed' &&
    item.price !== null &&
    item.issues.length === 0
  );

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

const capabilities = (): KyrubAiConsultantResponse['capabilities'] => ({
  actionsEnabled: true,
  enabledActions: [
    'create_note',
    'create_task',
    'start_store_activation',
    'update_store_profile',
    'prepare_product_draft',
    'import_catalog_draft',
    'create_product',
  ],
  enabledReadActions: [
    'read_store_summary',
    'list_products',
    'list_low_stock_products',
    'list_pending_orders',
  ],
  voiceEnabled: false,
  persistentCloudHistoryEnabled: false,
});

export const resolveKyrubiaCatalogImportRuntime = (
  storage: Storage,
  uid: string,
  conversationId: string,
  message: string
): KyrubAiConsultantResponse | null => {
  if (!isKyrubiaCatalogImportRequest(message)) return null;
  const analysis = loadKyrubiaCatalogAnalysis(storage, uid, conversationId);
  if (!analysis) return null;

  const readyItems = analysis.items.filter(isReadyItem);
  const reviewItems = analysis.items.filter(item => !isReadyItem(item));
  if (readyItems.length === 0) {
    return {
      reply:
        'Eu tenho a análise deste cardápio, mas nenhum item está seguro para cadastrar ainda. ' +
        'Preço, categoria ou identificação de um ou mais itens precisa ser revisado antes da gravação.',
      provider: 'kyrub',
      model: 'kyrub-catalog-import-runtime-v1',
      mode: 'deterministic',
      requestId: `catalog-import-${stableHash(`${conversationId}:${message}`)}`,
      capabilities: capabilities(),
    };
  }

  const fingerprint = stableHash(
    `${conversationId}:${readyItems.map(item => `${item.ref}:${item.name}:${item.price}`).join('|')}`
  );
  const proposal: KyrubAiImportCatalogDraftProposal = {
    id: `catalog-import-${fingerprint}`,
    type: 'import_catalog_draft',
    conversationId: safeId(conversationId),
    source: {
      kind: 'catalog_analysis',
      conversationId: safeId(conversationId),
      sourceRefs: readyItems.map(item => safeId(item.ref)),
    },
    items: readyItems.map(importItem),
    requiresConfirmation: true,
    origin: 'kyrubia',
    risk: 'low',
    inputProvenance: 'document_content',
    impact: { entityCount: readyItems.length, reversibility: 'easy' },
    idempotencyKey: `kyrubia:import_catalog_draft:${safeId(conversationId)}:${fingerprint}`,
  };

  const reviewNotice = reviewItems.length > 0
    ? ` ${reviewItems.length} item(ns) ficaram de fora porque precisam de revisão antes do cadastro.`
    : '';

  return {
    reply:
      `Encontrei ${readyItems.length} item(ns) prontos para cadastro a partir da análise deste cardápio.${reviewNotice} ` +
      'Vou adicioná-los como produtos não publicados. Revise a lista e confirme; nada entrará na vitrine automaticamente.',
    provider: 'kyrub',
    model: 'kyrub-catalog-import-runtime-v1',
    mode: 'deterministic',
    requestId: `catalog-import-${fingerprint}`,
    actionProposal: proposal,
    capabilities: capabilities(),
  };
};
