import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import type {
  KyrubActionExecutionResult,
  KyrubAiSetProductPublicationProposal,
  KyrubExecutionEnvelope,
  KyrubInputProvenance,
  KyrubPolicyDecision,
  KyrubProductPublicationStatus,
} from '../../shared/kyrubActions.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';
import { KyrubActionExecutionError } from './actionExecutionService.js';
import { setAuthorizedKyrubCatalogProductPublication } from './catalogProductLifecycleService.js';
import { evaluateKyrubActionPolicy } from './kyrubiaPolicyEngine.js';

const EXECUTION_ENVELOPE_TTL_MS = 5 * 60 * 1_000;
const INPUT_PROVENANCE = new Set<KyrubInputProvenance>([
  'user_intent',
  'quoted_content',
  'document_content',
  'tool_output',
  'ai_generated_content',
  'sensor_inference',
]);

const clean = (value: unknown, maximum = 180): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const requestRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new KyrubActionExecutionError(400, 'INVALID_REQUEST', 'A solicitação de publicação é inválida.');
  }
  return value as Record<string, unknown>;
};

const safeActionId = (value: unknown): string => {
  const id = clean(value, 120)
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  if (!id) throw new KyrubActionExecutionError(400, 'INVALID_ACTION', 'A ação não possui identificador válido.');
  return id;
};

const safeProductId = (value: unknown): string => {
  const id = clean(value, 180);
  if (!id || id.includes('/') || id.includes('..')) {
    throw new KyrubActionExecutionError(400, 'INVALID_PRODUCT', 'O produto não possui identificador válido.');
  }
  return id;
};

const normalizeStatus = (value: unknown): KyrubProductPublicationStatus => {
  if (value === 'draft' || value === 'published') return value;
  throw new KyrubActionExecutionError(400, 'INVALID_PUBLICATION_STATUS', 'O status atual esperado do produto é inválido.');
};

const normalizeProvenance = (value: unknown): KyrubInputProvenance =>
  typeof value === 'string' && INPUT_PROVENANCE.has(value as KyrubInputProvenance)
    ? value as KyrubInputProvenance
    : 'ai_generated_content';

const normalizeProposal = (value: unknown): KyrubAiSetProductPublicationProposal => {
  const candidate = requestRecord(value);
  if (candidate.type !== 'set_product_publication') {
    throw new KyrubActionExecutionError(400, 'UNSUPPORTED_ACTION', 'Esta ação não é uma publicação de produto suportada.');
  }
  const productName = clean(candidate.productName, 160);
  if (!productName || typeof candidate.published !== 'boolean') {
    throw new KyrubActionExecutionError(400, 'INVALID_PUBLICATION_REQUEST', 'Revise o produto e o estado de publicação solicitado.');
  }
  return {
    id: safeActionId(candidate.id),
    type: 'set_product_publication',
    productId: safeProductId(candidate.productId),
    productName,
    expectedCurrentStatus: normalizeStatus(candidate.expectedCurrentStatus),
    published: candidate.published,
    requiresConfirmation: true,
    origin: 'kyrubia',
    risk: 'medium',
    inputProvenance: normalizeProvenance(candidate.inputProvenance),
    impact: { entityCount: 1, reversibility: 'easy' },
    ...(clean(candidate.idempotencyKey, 240)
      ? { idempotencyKey: clean(candidate.idempotencyKey, 240) }
      : {}),
  };
};

export const isKyrubProductPublicationExecutionRequest = (rawRequest: unknown): boolean => {
  if (!rawRequest || typeof rawRequest !== 'object' || Array.isArray(rawRequest)) return false;
  const proposal = (rawRequest as Record<string, unknown>).proposal;
  return Boolean(
    proposal &&
    typeof proposal === 'object' &&
    !Array.isArray(proposal) &&
    (proposal as Record<string, unknown>).type === 'set_product_publication'
  );
};

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const verifyActor = async (authorization: string) => {
  const token = bearerToken(authorization);
  if (!token) throw new KyrubActionExecutionError(401, 'AUTH_REQUIRED', 'Faça login novamente antes de confirmar a publicação.');
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

const idempotencyKeyFor = (proposal: KyrubAiSetProductPublicationProposal, actorUid: string): string =>
  proposal.idempotencyKey?.trim() || `kyrubia:${proposal.type}:${actorUid}:${proposal.id}`;

const proposalHash = (proposal: KyrubAiSetProductPublicationProposal, idempotencyKey: string): string =>
  createHash('sha256').update(JSON.stringify({
    id: proposal.id,
    type: proposal.type,
    productId: proposal.productId,
    productName: proposal.productName,
    expectedCurrentStatus: proposal.expectedCurrentStatus,
    published: proposal.published,
    idempotencyKey,
  })).digest('hex');

const executionIdFor = (actorUid: string, idempotencyKey: string): string =>
  `exec_${createHash('sha256').update(`${actorUid}:${idempotencyKey}`).digest('hex').slice(0, 40)}`;

const buildEnvelope = (
  proposal: KyrubAiSetProductPublicationProposal,
  actorUid: string,
  idempotencyKey: string,
  policy: KyrubPolicyDecision,
  now = new Date()
): KyrubExecutionEnvelope => ({
  version: 1,
  executionId: executionIdFor(actorUid, idempotencyKey),
  actionId: proposal.id,
  actionType: proposal.type,
  actorUid,
  origin: proposal.origin ?? 'kyrubia',
  inputProvenance: proposal.inputProvenance ?? 'ai_generated_content',
  impact: proposal.impact ?? { entityCount: 1, reversibility: 'easy' },
  proposalHash: proposalHash(proposal, idempotencyKey),
  policyDecisionId: policy.id,
  authorizationMode: 'human_confirmation',
  authorizedAt: now.toISOString(),
  expiresAt: new Date(now.getTime() + EXECUTION_ENVELOPE_TTL_MS).toISOString(),
  idempotencyKey,
});

const canonicalProductFor = async (actorUid: string, productId: string) => {
  const privateStore = await adminDb.doc(`users/${actorUid}/stores/${actorUid}`).get();
  const canonicalStoreId = clean(privateStore.data()?.canonicalStoreId, 180);
  if (!canonicalStoreId) {
    throw new KyrubActionExecutionError(409, 'CANONICAL_STORE_REQUIRED', 'A loja ainda não possui catálogo canônico ativo.');
  }
  const reference = adminDb.doc(`stores/${canonicalStoreId}/products/${productId}`);
  const snapshot = await reference.get();
  if (!snapshot.exists) throw new KyrubActionExecutionError(404, 'PRODUCT_NOT_FOUND', 'Este produto não foi encontrado no catálogo da loja.');
  return snapshot.data() as Record<string, unknown>;
};

const mapPolicyFailure = (decision: KyrubPolicyDecision): never => {
  if (decision.outcome === 'require_confirmation') {
    throw new KyrubActionExecutionError(409, 'CONFIRMATION_REQUIRED', 'Revise e confirme a publicação antes da execução.');
  }
  throw new KyrubActionExecutionError(403, 'POLICY_DENIED', 'A política de segurança do Kyrub bloqueou esta execução.');
};

export const executeAuthorizedKyrubProductPublication = async (
  authorization: string,
  rawRequest: unknown
): Promise<KyrubActionExecutionResult> => {
  const actor = await verifyActor(authorization);
  const body = requestRecord(rawRequest);
  const proposal = normalizeProposal(body.proposal);
  const idempotencyKey = idempotencyKeyFor(proposal, actor.uid);
  const normalizedProposal = { ...proposal, idempotencyKey };
  const policy = evaluateKyrubActionPolicy(normalizedProposal, {
    actorUid: actor.uid,
    permissions: ['products.write'],
    confirmed: body.confirmed === true,
  });
  if (policy.outcome !== 'allow') mapPolicyFailure(policy);

  const envelope = buildEnvelope(normalizedProposal, actor.uid, idempotencyKey, policy);
  const receiptReference = adminDb.doc(`kyrub_action_receipts/${envelope.executionId}`);
  const existingReceipt = await receiptReference.get();
  if (existingReceipt.exists) {
    const data = existingReceipt.data() as Record<string, unknown>;
    if (
      data.idempotencyKey === envelope.idempotencyKey &&
      data.proposalHash === envelope.proposalHash &&
      data.actorUid === envelope.actorUid &&
      data.actionType === envelope.actionType
    ) {
      return {
        actionId: proposal.id,
        type: proposal.type,
        status: 'already_applied',
        entityId: proposal.productId,
        origin: envelope.origin,
        idempotencyKey,
        executionEnvelope: envelope,
      };
    }
    throw new KyrubActionExecutionError(409, 'IDEMPOTENCY_CONFLICT', 'Esta publicação já foi utilizada com outro conteúdo.');
  }

  const current = await canonicalProductFor(actor.uid, proposal.productId);
  const currentName = clean(current.name, 160);
  const currentStatus = clean(current.publicationStatus, 20);
  if (currentName !== proposal.productName || currentStatus !== proposal.expectedCurrentStatus) {
    throw new KyrubActionExecutionError(
      409,
      'PRODUCT_CHANGED',
      'O produto ou seu status de publicação mudou desde a leitura da Kyrubia. Atualize a conversa antes de confirmar novamente.'
    );
  }

  await setAuthorizedKyrubCatalogProductPublication(authorization, {
    operation: 'set_catalog_product_publication',
    productId: proposal.productId,
    published: proposal.published,
  });

  await receiptReference.set({
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
    targetType: 'product',
    targetId: proposal.productId,
    result: 'success',
    createdAt: FieldValue.serverTimestamp(),
  });

  return {
    actionId: proposal.id,
    type: proposal.type,
    status: 'success',
    entityId: proposal.productId,
    origin: envelope.origin,
    idempotencyKey,
    executionEnvelope: envelope,
  };
};
