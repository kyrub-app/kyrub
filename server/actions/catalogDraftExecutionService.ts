import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import type {
  KyrubActionExecutionResult,
  KyrubAiPrepareProductDraftProposal,
  KyrubExecutionEnvelope,
  KyrubInputProvenance,
  KyrubPolicyDecision,
} from '../../shared/kyrubActions.js';
import type {
  KyrubCatalogDraftField,
  KyrubCatalogDraftFieldProvenance,
  KyrubCatalogDraftIssue,
  KyrubCatalogDraftIssueCode,
  KyrubCatalogDraftListItem,
  KyrubCatalogDraftListResponse,
  KyrubCatalogDraftProductInput,
  KyrubCatalogDraftSource,
  KyrubCatalogDraftSourceKind,
} from '../../shared/kyrubCatalogDrafts.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';
import { KyrubActionExecutionError } from './actionExecutionService.js';
import { evaluateKyrubActionPolicy } from './kyrubiaPolicyEngine.js';

const MAX_NAME = 120;
const MAX_DESCRIPTION = 2_000;
const MAX_CATEGORY = 120;
const MAX_IMAGE = 2_000;
const MAX_SOURCE_REF = 500;
const MAX_SOURCE_REFS = 20;
const MAX_ISSUES = 30;
const MAX_ISSUE_MESSAGE = 300;
const MAX_LIST_RESULTS = 30;
const EXECUTION_ENVELOPE_TTL_MS = 5 * 60 * 1_000;

const INPUT_PROVENANCE = new Set<KyrubInputProvenance>([
  'user_intent',
  'quoted_content',
  'document_content',
  'tool_output',
  'ai_generated_content',
  'sensor_inference',
]);
const DRAFT_FIELD_PROVENANCE = new Set<KyrubCatalogDraftFieldProvenance>([
  'user_intent',
  'quoted_content',
  'document_content',
  'tool_output',
  'ai_generated_content',
  'sensor_inference',
]);
const DRAFT_FIELDS = new Set<KyrubCatalogDraftField>([
  'name',
  'description',
  'price',
  'stock',
  'category',
  'image',
  'isService',
  'isComplimentary',
]);
const SOURCE_KINDS = new Set<KyrubCatalogDraftSourceKind>([
  'conversation',
  'manual',
  'image',
  'pdf',
  'catalog_analysis',
]);
const ISSUE_CODES = new Set<KyrubCatalogDraftIssueCode>([
  'missing_required_field',
  'possible_duplicate',
  'ambiguous_value',
  'unreadable_source',
]);

const requestRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new KyrubActionExecutionError(
      400,
      'INVALID_REQUEST',
      'A solicitação de rascunho é inválida.'
    );
  }
  return value as Record<string, unknown>;
};

const cleanText = (value: unknown, maximum: number): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const optionalText = (value: unknown, maximum: number): string | undefined => {
  const cleaned = cleanText(value, maximum);
  return cleaned || undefined;
};

const safeActionId = (value: unknown): string => {
  const normalized = cleanText(value, 120)
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  if (!normalized) {
    throw new KyrubActionExecutionError(
      400,
      'INVALID_ACTION',
      'O rascunho não possui um identificador de ação válido.'
    );
  }
  return normalized;
};

const finiteNonNegative = (
  value: unknown,
  maximum: number
): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum
    ? value
    : undefined;

const integerNonNegative = (
  value: unknown,
  maximum: number
): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum
    ? value
    : undefined;

const normalizeProduct = (value: unknown): KyrubCatalogDraftProductInput => {
  const candidate = requestRecord(value);
  const name = cleanText(candidate.name, MAX_NAME);
  if (!name) {
    throw new KyrubActionExecutionError(
      400,
      'INVALID_PRODUCT_DRAFT',
      'O rascunho precisa ter pelo menos um nome de produto válido.'
    );
  }

  const product: KyrubCatalogDraftProductInput = { name };
  const description = optionalText(candidate.description, MAX_DESCRIPTION);
  const category = optionalText(candidate.category, MAX_CATEGORY);
  const image = optionalText(candidate.image, MAX_IMAGE);
  const price = finiteNonNegative(candidate.price, 1_000_000_000);
  const stock = integerNonNegative(candidate.stock, 1_000_000_000);

  if (candidate.price !== undefined && price === undefined) {
    throw new KyrubActionExecutionError(400, 'INVALID_PRODUCT_DRAFT', 'O preço do rascunho é inválido.');
  }
  if (candidate.stock !== undefined && stock === undefined) {
    throw new KyrubActionExecutionError(400, 'INVALID_PRODUCT_DRAFT', 'O estoque do rascunho é inválido.');
  }
  if (candidate.isService !== undefined && typeof candidate.isService !== 'boolean') {
    throw new KyrubActionExecutionError(400, 'INVALID_PRODUCT_DRAFT', 'O indicador de serviço do rascunho é inválido.');
  }
  if (
    candidate.isComplimentary !== undefined &&
    typeof candidate.isComplimentary !== 'boolean'
  ) {
    throw new KyrubActionExecutionError(400, 'INVALID_PRODUCT_DRAFT', 'O indicador de cortesia do rascunho é inválido.');
  }

  if (description !== undefined) product.description = description;
  if (category !== undefined) product.category = category;
  if (image !== undefined) product.image = image;
  if (price !== undefined) product.price = price;
  if (stock !== undefined) product.stock = stock;
  if (typeof candidate.isService === 'boolean') product.isService = candidate.isService;
  if (typeof candidate.isComplimentary === 'boolean') {
    product.isComplimentary = candidate.isComplimentary;
  }
  return product;
};

const normalizeSource = (value: unknown): KyrubCatalogDraftSource => {
  const candidate = requestRecord(value);
  const kind = cleanText(candidate.kind, 40) as KyrubCatalogDraftSourceKind;
  if (!SOURCE_KINDS.has(kind)) {
    throw new KyrubActionExecutionError(
      400,
      'INVALID_DRAFT_SOURCE',
      'A origem do rascunho não é suportada.'
    );
  }

  const source: KyrubCatalogDraftSource = { kind };
  const conversationId = optionalText(candidate.conversationId, 160);
  if (conversationId) source.conversationId = conversationId;
  if (candidate.sourceRefs !== undefined) {
    if (!Array.isArray(candidate.sourceRefs) || candidate.sourceRefs.length > MAX_SOURCE_REFS) {
      throw new KyrubActionExecutionError(400, 'INVALID_DRAFT_SOURCE', 'As referências do rascunho são inválidas.');
    }
    source.sourceRefs = candidate.sourceRefs
      .map(item => cleanText(item, MAX_SOURCE_REF))
      .filter(Boolean);
  }
  return source;
};

const normalizeFieldProvenance = (
  value: unknown
): KyrubAiPrepareProductDraftProposal['fieldProvenance'] => {
  if (value === undefined) return {};
  const candidate = requestRecord(value);
  const result: KyrubAiPrepareProductDraftProposal['fieldProvenance'] = {};
  for (const [field, provenance] of Object.entries(candidate)) {
    if (!DRAFT_FIELDS.has(field as KyrubCatalogDraftField)) continue;
    if (
      typeof provenance !== 'string' ||
      !DRAFT_FIELD_PROVENANCE.has(provenance as KyrubCatalogDraftFieldProvenance)
    ) {
      throw new KyrubActionExecutionError(
        400,
        'INVALID_DRAFT_PROVENANCE',
        'A proveniência de um campo do rascunho é inválida.'
      );
    }
    result[field as KyrubCatalogDraftField] = provenance as KyrubCatalogDraftFieldProvenance;
  }
  return result;
};

const normalizeIssues = (value: unknown): KyrubCatalogDraftIssue[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ISSUES) {
    throw new KyrubActionExecutionError(400, 'INVALID_DRAFT_ISSUES', 'As pendências do rascunho são inválidas.');
  }
  return value.map(item => {
    const candidate = requestRecord(item);
    const code = cleanText(candidate.code, 60) as KyrubCatalogDraftIssueCode;
    const message = cleanText(candidate.message, MAX_ISSUE_MESSAGE);
    const field = optionalText(candidate.field, 40) as KyrubCatalogDraftField | undefined;
    if (!ISSUE_CODES.has(code) || !message || (field && !DRAFT_FIELDS.has(field))) {
      throw new KyrubActionExecutionError(400, 'INVALID_DRAFT_ISSUES', 'Uma pendência do rascunho é inválida.');
    }
    return { code, ...(field ? { field } : {}), message };
  });
};

const normalizeProvenance = (value: unknown): KyrubInputProvenance =>
  typeof value === 'string' && INPUT_PROVENANCE.has(value as KyrubInputProvenance)
    ? value as KyrubInputProvenance
    : 'ai_generated_content';

const normalizeProposal = (value: unknown): KyrubAiPrepareProductDraftProposal => {
  const candidate = requestRecord(value);
  if (candidate.type !== 'prepare_product_draft') {
    throw new KyrubActionExecutionError(
      400,
      'UNSUPPORTED_ACTION',
      'Esta ação não prepara um rascunho de produto suportado.'
    );
  }
  if (candidate.requiresConfirmation !== false) {
    throw new KyrubActionExecutionError(
      400,
      'INVALID_PRODUCT_DRAFT',
      'A preparação simples de rascunho não deve publicar nem solicitar confirmação de publicação.'
    );
  }

  return {
    id: safeActionId(candidate.id),
    type: 'prepare_product_draft',
    product: normalizeProduct(candidate.product),
    source: normalizeSource(candidate.source),
    fieldProvenance: normalizeFieldProvenance(candidate.fieldProvenance),
    issues: normalizeIssues(candidate.issues),
    requiresConfirmation: false,
    origin: 'kyrubia',
    risk: 'low',
    inputProvenance: normalizeProvenance(candidate.inputProvenance),
    impact: { entityCount: 1, reversibility: 'easy' },
    ...(cleanText(candidate.idempotencyKey, 240)
      ? { idempotencyKey: cleanText(candidate.idempotencyKey, 240) }
      : {}),
  };
};

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const verifyActor = async (authorization: string) => {
  const token = bearerToken(authorization);
  if (!token) {
    throw new KyrubActionExecutionError(401, 'AUTH_REQUIRED', 'Faça login novamente para acessar seus rascunhos.');
  }
  try {
    return await verifyFirebaseIdToken(token);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
    if (code === 'AUTH_UNAVAILABLE') {
      throw new KyrubActionExecutionError(503, 'AUTH_UNAVAILABLE', 'Não foi possível validar sua sessão agora.');
    }
    throw new KyrubActionExecutionError(401, 'AUTH_REQUIRED', 'Sua sessão expirou. Entre novamente no Kyrub.');
  }
};

const idempotencyKeyFor = (
  proposal: KyrubAiPrepareProductDraftProposal,
  actorUid: string
): string => proposal.idempotencyKey?.trim() ||
  `kyrubia:${proposal.type}:${actorUid}:${proposal.id}`;

const canonicalPayload = (
  proposal: KyrubAiPrepareProductDraftProposal,
  idempotencyKey: string
): Record<string, unknown> => ({
  id: proposal.id,
  type: proposal.type,
  product: proposal.product,
  source: proposal.source,
  fieldProvenance: proposal.fieldProvenance,
  issues: proposal.issues,
  requiresConfirmation: false,
  origin: proposal.origin ?? 'kyrubia',
  risk: 'low',
  inputProvenance: proposal.inputProvenance ?? 'ai_generated_content',
  impact: proposal.impact ?? { entityCount: 1, reversibility: 'easy' },
  idempotencyKey,
});

const proposalHash = (
  proposal: KyrubAiPrepareProductDraftProposal,
  idempotencyKey: string
): string => createHash('sha256')
  .update(JSON.stringify(canonicalPayload(proposal, idempotencyKey)))
  .digest('hex');

const deterministicExecutionId = (actorUid: string, idempotencyKey: string): string =>
  `exec_${createHash('sha256').update(`${actorUid}:${idempotencyKey}`).digest('hex').slice(0, 40)}`;

const deterministicDraftId = (actorUid: string, proposalId: string): string =>
  `draft_${createHash('sha256').update(`${actorUid}:${proposalId}`).digest('hex').slice(0, 32)}`;

const buildEnvelope = (
  proposal: KyrubAiPrepareProductDraftProposal,
  actorUid: string,
  idempotencyKey: string,
  policyDecision: KyrubPolicyDecision,
  confirmed: boolean,
  now = new Date()
): KyrubExecutionEnvelope => ({
  version: 1,
  executionId: deterministicExecutionId(actorUid, idempotencyKey),
  actionId: proposal.id,
  actionType: proposal.type,
  actorUid,
  origin: proposal.origin ?? 'kyrubia',
  inputProvenance: proposal.inputProvenance ?? 'ai_generated_content',
  impact: proposal.impact ?? { entityCount: 1, reversibility: 'easy' },
  proposalHash: proposalHash(proposal, idempotencyKey),
  policyDecisionId: policyDecision.id,
  authorizationMode: confirmed ? 'human_confirmation' : 'preauthorized',
  authorizedAt: now.toISOString(),
  expiresAt: new Date(now.getTime() + EXECUTION_ENVELOPE_TTL_MS).toISOString(),
  idempotencyKey,
});

const receiptPayload = (
  envelope: KyrubExecutionEnvelope,
  draftId: string,
  result: 'success' | 'already_applied' = 'success'
) => ({
  schemaVersion: 1,
  executionId: envelope.executionId,
  actionId: envelope.actionId,
  actionType: envelope.actionType,
  actorUid: envelope.actorUid,
  origin: envelope.origin,
  inputProvenance: envelope.inputProvenance,
  impact: envelope.impact,
  proposalHash: envelope.proposalHash,
  policyDecisionId: envelope.policyDecisionId,
  authorizationMode: envelope.authorizationMode,
  authorizedAt: envelope.authorizedAt,
  expiresAt: envelope.expiresAt,
  idempotencyKey: envelope.idempotencyKey,
  targetType: 'product_draft',
  targetId: draftId,
  result,
  createdAt: FieldValue.serverTimestamp(),
});

const privateStoreForActor = async (uid: string) => {
  const snapshot = await adminDb.doc(`users/${uid}/stores/${uid}`).get();
  if (!snapshot.exists) {
    throw new KyrubActionExecutionError(
      409,
      'STORE_REQUIRED',
      'Ative sua Loja Kyrub antes de preparar rascunhos de catálogo.'
    );
  }
  const data = snapshot.data() as Record<string, unknown>;
  if (!cleanText(data.name, 160)) {
    throw new KyrubActionExecutionError(
      409,
      'STORE_REQUIRED',
      'Informe o nome da sua Loja Kyrub antes de preparar rascunhos de catálogo.'
    );
  }
  return data;
};

const mapPolicyFailure = (decision: KyrubPolicyDecision): never => {
  if (decision.reasons.includes('AUTH_REQUIRED')) {
    throw new KyrubActionExecutionError(401, 'AUTH_REQUIRED', 'Faça login novamente.');
  }
  if (decision.reasons.includes('PERMISSION_REQUIRED')) {
    throw new KyrubActionExecutionError(403, 'PERMISSION_REQUIRED', 'Sua sessão não pode preparar este rascunho.');
  }
  if (
    decision.reasons.includes('CONFIRMATION_REQUIRED') ||
    decision.reasons.includes('UNTRUSTED_INPUT_REQUIRES_CONFIRMATION')
  ) {
    throw new KyrubActionExecutionError(
      409,
      'CONFIRMATION_REQUIRED',
      'Conteúdo inferido, documental ou gerado não pode virar rascunho persistente sem revisão humana.'
    );
  }
  throw new KyrubActionExecutionError(403, 'ACTION_DENIED', 'A política de segurança bloqueou este rascunho.');
};

export const isKyrubCatalogDraftExecutionRequest = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proposal = (value as Record<string, unknown>).proposal;
  return Boolean(
    proposal &&
    typeof proposal === 'object' &&
    !Array.isArray(proposal) &&
    (proposal as Record<string, unknown>).type === 'prepare_product_draft'
  );
};

export const isKyrubCatalogDraftListRequest = (value: unknown): boolean =>
  Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).operation === 'list_catalog_drafts'
  );

export const executeAuthorizedKyrubCatalogDraft = async (
  authorization: string,
  rawRequest: unknown
): Promise<KyrubActionExecutionResult> => {
  const actor = await verifyActor(authorization);
  const body = requestRecord(rawRequest);
  const proposal = normalizeProposal(body.proposal);
  const confirmed = body.confirmed === true;

  const decision = evaluateKyrubActionPolicy(proposal, {
    actorUid: actor.uid,
    permissions: ['products.drafts.write'],
    confirmed,
  });
  if (decision.outcome !== 'allow') mapPolicyFailure(decision);

  const store = await privateStoreForActor(actor.uid);
  const idempotencyKey = idempotencyKeyFor(proposal, actor.uid);
  const envelope = buildEnvelope(proposal, actor.uid, idempotencyKey, decision, confirmed);
  const draftId = deterministicDraftId(actor.uid, proposal.id);
  const draftReference = adminDb.doc(`kyrub_catalog_drafts/${actor.uid}/drafts/${draftId}`);
  const receiptReference = adminDb.doc(`kyrub_action_receipts/${envelope.executionId}`);
  const now = envelope.authorizedAt;

  const status = await adminDb.runTransaction(async transaction => {
    const [existingDraft, existingReceipt] = await Promise.all([
      transaction.get(draftReference),
      transaction.get(receiptReference),
    ]);

    if (existingReceipt.exists) {
      const data = existingReceipt.data() as Record<string, unknown>;
      if (
        data.idempotencyKey === envelope.idempotencyKey &&
        data.proposalHash === envelope.proposalHash &&
        data.actorUid === actor.uid &&
        data.targetId === draftId
      ) return 'already_applied' as const;
      throw new KyrubActionExecutionError(409, 'IDEMPOTENCY_CONFLICT', 'Este rascunho já foi usado com outro conteúdo.');
    }

    if (existingDraft.exists) {
      const data = existingDraft.data() as Record<string, unknown>;
      if (
        data.actionIdempotencyKey === envelope.idempotencyKey &&
        data.actionProposalHash === envelope.proposalHash &&
        data.ownerUid === actor.uid
      ) {
        transaction.set(receiptReference, receiptPayload(envelope, draftId, 'already_applied'));
        return 'already_applied' as const;
      }
      throw new KyrubActionExecutionError(409, 'IDEMPOTENCY_CONFLICT', 'Já existe outro rascunho com este identificador.');
    }

    transaction.set(draftReference, {
      schemaVersion: 1,
      id: draftId,
      ownerUid: actor.uid,
      storeId: actor.uid,
      ...(cleanText(store.canonicalStoreId, 160)
        ? { canonicalStoreId: cleanText(store.canonicalStoreId, 160) }
        : {}),
      status: 'draft',
      source: proposal.source,
      product: proposal.product,
      fieldProvenance: proposal.fieldProvenance,
      issues: proposal.issues,
      createdAtIso: now,
      updatedAtIso: now,
      serverUpdatedAt: FieldValue.serverTimestamp(),
      actionOrigin: envelope.origin,
      actionType: proposal.type,
      actionId: proposal.id,
      actionIdempotencyKey: envelope.idempotencyKey,
      actionProposalHash: envelope.proposalHash,
      actionExecutionId: envelope.executionId,
      actionPolicyDecisionId: envelope.policyDecisionId,
    });
    transaction.set(receiptReference, receiptPayload(envelope, draftId));
    return 'success' as const;
  });

  return {
    actionId: proposal.id,
    type: proposal.type,
    status,
    entityId: draftId,
    origin: envelope.origin,
    idempotencyKey: envelope.idempotencyKey,
    executionEnvelope: envelope,
  };
};

const listItemFromData = (data: Record<string, unknown>): KyrubCatalogDraftListItem | null => {
  if (
    typeof data.id !== 'string' ||
    data.status !== 'draft' ||
    !data.product || typeof data.product !== 'object' || Array.isArray(data.product) ||
    !data.source || typeof data.source !== 'object' || Array.isArray(data.source) ||
    !Array.isArray(data.issues) ||
    typeof data.createdAtIso !== 'string' ||
    typeof data.updatedAtIso !== 'string'
  ) return null;

  const product = data.product as KyrubCatalogDraftProductInput;
  if (typeof product.name !== 'string' || !product.name.trim()) return null;

  return {
    id: data.id,
    storeId: typeof data.storeId === 'string' ? data.storeId : '',
    ...(typeof data.canonicalStoreId === 'string'
      ? { canonicalStoreId: data.canonicalStoreId }
      : {}),
    status: 'draft',
    source: data.source as KyrubCatalogDraftSource,
    product,
    issues: data.issues as KyrubCatalogDraftIssue[],
    createdAtIso: data.createdAtIso,
    updatedAtIso: data.updatedAtIso,
  };
};

export const listAuthorizedKyrubCatalogDrafts = async (
  authorization: string
): Promise<KyrubCatalogDraftListResponse> => {
  const actor = await verifyActor(authorization);
  await privateStoreForActor(actor.uid);
  const snapshot = await adminDb
    .collection(`kyrub_catalog_drafts/${actor.uid}/drafts`)
    .orderBy('updatedAtIso', 'desc')
    .limit(MAX_LIST_RESULTS)
    .get();

  return {
    drafts: snapshot.docs.flatMap(document => {
      const item = listItemFromData(document.data() as Record<string, unknown>);
      return item ? [item] : [];
    }),
  };
};
