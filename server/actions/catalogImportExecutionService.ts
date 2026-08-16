import type {
  KyrubActionExecutionResult,
  KyrubAiImportCatalogDraftProposal,
} from '../../shared/kyrubActions.js';
import type {
  KyrubCatalogDraftField,
  KyrubCatalogDraftFieldProvenance,
  KyrubCatalogDraftIssue,
  KyrubCatalogDraftProductInput,
  KyrubCatalogDraftSource,
} from '../../shared/kyrubCatalogDrafts.js';
import { KyrubActionExecutionError } from './actionExecutionService.js';
import { executeAuthorizedKyrubCatalogDraft } from './catalogProductLifecycleService.js';

const MAX_IMPORT_ITEMS = 60;

const cleanText = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const safeId = (value: unknown): string =>
  cleanText(value, 120)
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new KyrubActionExecutionError(400, 'INVALID_REQUEST', 'A importação do catálogo é inválida.');
  }
  return value as Record<string, unknown>;
};

const finiteNonNegative = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;

const integerNonNegative = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;

const normalizeProduct = (value: unknown): KyrubCatalogDraftProductInput => {
  const candidate = record(value);
  const name = cleanText(candidate.name, 160);
  const category = cleanText(candidate.category, 240);
  const price = finiteNonNegative(candidate.price);
  if (!name || !category || price === undefined) {
    throw new KyrubActionExecutionError(
      400,
      'INVALID_CATALOG_IMPORT_ITEM',
      'Um item da análise não possui nome, categoria ou preço seguro para cadastro.'
    );
  }
  const isService = candidate.isService === true;
  const stock = isService ? 0 : integerNonNegative(candidate.stock);
  return {
    name,
    description: cleanText(candidate.description, 4_000),
    price,
    ...(stock !== undefined ? { stock } : {}),
    category,
    image: cleanText(candidate.image, 2_000),
    isService,
    isComplimentary: candidate.isComplimentary === true,
  };
};

const normalizeSource = (value: unknown): KyrubCatalogDraftSource => {
  const candidate = record(value);
  return {
    kind: 'catalog_analysis',
    ...(cleanText(candidate.conversationId, 120)
      ? { conversationId: safeId(candidate.conversationId) }
      : {}),
    ...(Array.isArray(candidate.sourceRefs)
      ? {
          sourceRefs: candidate.sourceRefs
            .map(item => safeId(item))
            .filter(Boolean)
            .slice(0, MAX_IMPORT_ITEMS),
        }
      : {}),
  };
};

const normalizeFieldProvenance = (
  value: unknown
): Partial<Record<KyrubCatalogDraftField, KyrubCatalogDraftFieldProvenance>> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const candidate = value as Record<string, unknown>;
  const fields: KyrubCatalogDraftField[] = [
    'name', 'description', 'price', 'stock', 'category', 'image', 'isService', 'isComplimentary',
  ];
  const result: Partial<Record<KyrubCatalogDraftField, KyrubCatalogDraftFieldProvenance>> = {};
  for (const field of fields) {
    if (candidate[field] === 'document_content') result[field] = 'document_content';
  }
  return result;
};

const normalizeIssues = (value: unknown): KyrubCatalogDraftIssue[] =>
  Array.isArray(value)
    ? value.flatMap(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const candidate = item as Record<string, unknown>;
        const message = cleanText(candidate.message, 180);
        if (!message) return [];
        return [{
          code: candidate.code === 'possible_duplicate' ||
            candidate.code === 'ambiguous_value' ||
            candidate.code === 'unreadable_source'
            ? candidate.code
            : 'missing_required_field',
          ...(typeof candidate.field === 'string'
            ? { field: candidate.field as KyrubCatalogDraftField }
            : {}),
          message,
        } satisfies KyrubCatalogDraftIssue];
      }).slice(0, 20)
    : [];

const normalizeProposal = (value: unknown): KyrubAiImportCatalogDraftProposal => {
  const candidate = record(value);
  if (candidate.type !== 'import_catalog_draft') {
    throw new KyrubActionExecutionError(400, 'UNSUPPORTED_ACTION', 'Ação de importação inválida.');
  }
  const id = safeId(candidate.id);
  if (!id || !Array.isArray(candidate.items) || candidate.items.length === 0) {
    throw new KyrubActionExecutionError(400, 'INVALID_CATALOG_IMPORT', 'Nenhum item foi informado para importação.');
  }
  if (candidate.items.length > MAX_IMPORT_ITEMS) {
    throw new KyrubActionExecutionError(400, 'CATALOG_IMPORT_TOO_LARGE', 'A importação pode conter no máximo 60 itens por confirmação.');
  }
  const source = normalizeSource(candidate.source);
  const items = candidate.items.map((item, index) => {
    const row = record(item);
    return {
      ref: safeId(row.ref) || `item-${index + 1}`,
      product: normalizeProduct(row.product),
      fieldProvenance: normalizeFieldProvenance(row.fieldProvenance),
      issues: normalizeIssues(row.issues),
    };
  });
  return {
    id,
    type: 'import_catalog_draft',
    conversationId: safeId(candidate.conversationId),
    source,
    items,
    requiresConfirmation: true,
    origin: 'kyrubia',
    risk: 'low',
    inputProvenance: 'document_content',
    impact: { entityCount: items.length, reversibility: 'easy' },
    ...(cleanText(candidate.idempotencyKey, 240)
      ? { idempotencyKey: cleanText(candidate.idempotencyKey, 240) }
      : {}),
  };
};

export const isKyrubCatalogImportExecutionRequest = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proposal = (value as Record<string, unknown>).proposal;
  return Boolean(
    proposal &&
    typeof proposal === 'object' &&
    !Array.isArray(proposal) &&
    (proposal as Record<string, unknown>).type === 'import_catalog_draft'
  );
};

export const executeAuthorizedKyrubCatalogImport = async (
  authorization: string,
  rawRequest: unknown
): Promise<KyrubActionExecutionResult> => {
  const body = record(rawRequest);
  if (body.confirmed !== true) {
    throw new KyrubActionExecutionError(
      409,
      'CONFIRMATION_REQUIRED',
      'Confirme a lista antes de cadastrar os produtos analisados.'
    );
  }

  const proposal = normalizeProposal(body.proposal);
  const baseKey = proposal.idempotencyKey ?? `kyrubia:import_catalog_draft:${proposal.conversationId}:${proposal.id}`;
  const results: KyrubActionExecutionResult[] = [];

  for (const [index, item] of proposal.items.entries()) {
    const childId = `${proposal.id}-${item.ref}-${index + 1}`.slice(0, 96);
    const child = await executeAuthorizedKyrubCatalogDraft(authorization, {
      confirmed: true,
      proposal: {
        id: childId,
        type: 'prepare_product_draft',
        product: item.product,
        source: {
          ...proposal.source,
          sourceRefs: [item.ref],
        },
        fieldProvenance: item.fieldProvenance,
        issues: item.issues,
        requiresConfirmation: false,
        origin: 'kyrubia',
        risk: 'low',
        inputProvenance: 'document_content',
        impact: { entityCount: 1, reversibility: 'easy' },
        idempotencyKey: `${baseKey}:${item.ref}:${index + 1}`,
      },
    });
    results.push(child);
  }

  const allAlreadyApplied = results.every(result => result.status === 'already_applied');
  return {
    actionId: proposal.id,
    type: 'import_catalog_draft',
    status: allAlreadyApplied ? 'already_applied' : 'success',
    entityId: proposal.id,
    origin: 'kyrubia',
    idempotencyKey: baseKey,
  };
};
