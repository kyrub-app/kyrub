import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import type {
  KyrubActionExecutionResult,
  KyrubAiUpdateOrderStatusProposal,
  KyrubExecutionEnvelope,
  KyrubInputProvenance,
  KyrubOrderMutableStatus,
  KyrubOrderStatus,
  KyrubPolicyDecision,
} from '../../shared/kyrubActions.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';
import { sendNinetyNineFoodOrderStatus } from '../integrations/ninetyNineFoodService.js';
import {
  transitionOrderStatusWithInventory,
  type OrderStatusDecisionInput,
} from '../inventory/orderInventoryService.js';
import { KyrubActionExecutionError } from './actionExecutionService.js';
import { evaluateKyrubActionPolicy } from './kyrubiaPolicyEngine.js';

const EXECUTION_ENVELOPE_TTL_MS = 5 * 60 * 1_000;
const MAX_DECISION_TEXT = 500;
const ORDER_STATUSES = new Set<KyrubOrderStatus>([
  'pending',
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'rejected',
  'cancelled',
]);
const MUTABLE_ORDER_STATUSES = new Set<KyrubOrderMutableStatus>([
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'rejected',
  'cancelled',
]);
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
    throw new KyrubActionExecutionError(400, 'INVALID_REQUEST', 'A solicitação de execução é inválida.');
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

const safeOrderId = (value: unknown): string => {
  const id = clean(value, 180);
  if (!id || id.includes('/') || id.includes('..')) {
    throw new KyrubActionExecutionError(400, 'INVALID_ORDER', 'O pedido não possui um identificador válido.');
  }
  return id;
};

const normalizeStatus = <T extends KyrubOrderStatus>(
  value: unknown,
  allowed: Set<T>,
  label: string
): T => {
  if (typeof value === 'string' && allowed.has(value as T)) return value as T;
  throw new KyrubActionExecutionError(400, 'INVALID_ORDER_STATUS', `${label} do pedido é inválido.`);
};

const normalizeDecision = (value: unknown): OrderStatusDecisionInput => {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    reason: clean(record.reason, MAX_DECISION_TEXT),
    alternative: clean(record.alternative, MAX_DECISION_TEXT),
  };
};

const normalizeProvenance = (value: unknown): KyrubInputProvenance =>
  typeof value === 'string' && INPUT_PROVENANCE.has(value as KyrubInputProvenance)
    ? value as KyrubInputProvenance
    : 'ai_generated_content';

const normalizeProposal = (value: unknown): KyrubAiUpdateOrderStatusProposal => {
  const candidate = requestRecord(value);
  if (candidate.type !== 'update_order_status') {
    throw new KyrubActionExecutionError(400, 'UNSUPPORTED_ACTION', 'Esta ação não é uma atualização de pedido suportada.');
  }
  const expectedCurrentStatus = normalizeStatus(
    candidate.expectedCurrentStatus,
    ORDER_STATUSES,
    'O status atual esperado'
  );
  const nextStatus = normalizeStatus(
    candidate.nextStatus,
    MUTABLE_ORDER_STATUSES,
    'O novo status'
  );
  const decision = normalizeDecision(candidate.decision);
  if ((nextStatus === 'rejected' || nextStatus === 'cancelled') && !decision.reason) {
    throw new KyrubActionExecutionError(
      400,
      'ORDER_DECISION_REASON_REQUIRED',
      'Informe o motivo antes de recusar ou cancelar o pedido.'
    );
  }

  return {
    id: safeActionId(candidate.id),
    type: 'update_order_status',
    orderId: safeOrderId(candidate.orderId),
    expectedCurrentStatus,
    nextStatus,
    ...(decision.reason || decision.alternative ? { decision } : {}),
    requiresConfirmation: true,
    origin: 'kyrubia',
    risk: 'medium',
    inputProvenance: normalizeProvenance(candidate.inputProvenance),
    impact: { entityCount: 1, reversibility: 'limited' },
    ...(clean(candidate.idempotencyKey, 240)
      ? { idempotencyKey: clean(candidate.idempotencyKey, 240) }
      : {}),
  };
};

export const isKyrubOrderStatusExecutionRequest = (rawRequest: unknown): boolean => {
  if (!rawRequest || typeof rawRequest !== 'object' || Array.isArray(rawRequest)) return false;
  const proposal = (rawRequest as Record<string, unknown>).proposal;
  return Boolean(
    proposal &&
    typeof proposal === 'object' &&
    !Array.isArray(proposal) &&
    (proposal as Record<string, unknown>).type === 'update_order_status'
  );
};

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const verifyActor = async (token: string) => {
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
  proposal: KyrubAiUpdateOrderStatusProposal,
  actorUid: string
): string => proposal.idempotencyKey?.trim() ||
  `kyrubia:${proposal.type}:${actorUid}:${proposal.id}`;

const canonicalPayload = (
  proposal: KyrubAiUpdateOrderStatusProposal,
  idempotencyKey: string
) => ({
  id: proposal.id,
  type: proposal.type,
  orderId: proposal.orderId,
  expectedCurrentStatus: proposal.expectedCurrentStatus,
  nextStatus: proposal.nextStatus,
  decision: proposal.decision ?? {},
  requiresConfirmation: true,
  origin: proposal.origin ?? 'kyrubia',
  risk: 'medium',
  inputProvenance: proposal.inputProvenance ?? 'ai_generated_content',
  impact: proposal.impact ?? { entityCount: 1, reversibility: 'limited' as const },
  idempotencyKey,
});

const proposalHash = (
  proposal: KyrubAiUpdateOrderStatusProposal,
  idempotencyKey: string
): string => createHash('sha256')
  .update(JSON.stringify(canonicalPayload(proposal, idempotencyKey)))
  .digest('hex');

const deterministicExecutionId = (actorUid: string, idempotencyKey: string): string =>
  `exec_${createHash('sha256').update(`${actorUid}:${idempotencyKey}`).digest('hex').slice(0, 40)}`;

const buildEnvelope = (
  proposal: KyrubAiUpdateOrderStatusProposal,
  actorUid: string,
  idempotencyKey: string,
  policyDecision: KyrubPolicyDecision,
  now = new Date()
): KyrubExecutionEnvelope => ({
  version: 1,
  executionId: deterministicExecutionId(actorUid, idempotencyKey),
  actionId: proposal.id,
  actionType: proposal.type,
  actorUid,
  origin: proposal.origin ?? 'kyrubia',
  inputProvenance: proposal.inputProvenance ?? 'ai_generated_content',
  impact: proposal.impact ?? { entityCount: 1, reversibility: 'limited' },
  proposalHash: proposalHash(proposal, idempotencyKey),
  policyDecisionId: policyDecision.id,
  authorizationMode: 'human_confirmation',
  authorizedAt: now.toISOString(),
  expiresAt: new Date(now.getTime() + EXECUTION_ENVELOPE_TTL_MS).toISOString(),
  idempotencyKey,
});

const receiptReferenceFor = (envelope: KyrubExecutionEnvelope) =>
  adminDb.doc(`kyrub_action_receipts/${envelope.executionId}`);

const receiptMatches = (
  data: Record<string, unknown>,
  envelope: KyrubExecutionEnvelope
): boolean =>
  data.idempotencyKey === envelope.idempotencyKey &&
  data.proposalHash === envelope.proposalHash &&
  data.actorUid === envelope.actorUid &&
  data.actionType === envelope.actionType &&
  data.actionId === envelope.actionId;

const orderReference = (tenantId: string, orderId: string) =>
  adminDb.doc(`artifacts/${tenantId}/public/data/customerOrders/${orderId}`);

const currentOrderStatus = async (
  tenantId: string,
  orderId: string
): Promise<KyrubOrderStatus> => {
  const snapshot = await orderReference(tenantId, orderId).get();
  if (!snapshot.exists) {
    throw new KyrubActionExecutionError(404, 'ORDER_NOT_FOUND', 'Pedido não encontrado.');
  }
  const status = snapshot.data()?.status;
  if (typeof status !== 'string' || !ORDER_STATUSES.has(status as KyrubOrderStatus)) {
    throw new KyrubActionExecutionError(409, 'ORDER_STATUS_INVALID', 'O pedido possui um status que não pode ser operado pela Kyrubia.');
  }
  return status as KyrubOrderStatus;
};

const markPartnerSyncError = async (
  tenantId: string,
  orderId: string,
  message: string
): Promise<void> => {
  await orderReference(tenantId, orderId).update({
    'integration.outboundStatus': 'attention',
    'integration.outboundError': message.slice(0, 500),
    'integration.outboundUpdatedAt': new Date().toISOString(),
  });
};

const markPartnerSyncSuccess = async (
  tenantId: string,
  orderId: string
): Promise<void> => {
  await orderReference(tenantId, orderId).update({
    'integration.outboundStatus': 'sent',
    'integration.outboundError': FieldValue.delete(),
    'integration.outboundUpdatedAt': new Date().toISOString(),
  });
};

const persistReceipt = async (
  envelope: KyrubExecutionEnvelope,
  orderId: string,
  inventoryAction: string,
  partnerSync: string,
  partnerWarning: string
): Promise<void> => {
  await receiptReferenceFor(envelope).set({
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
    targetType: 'order',
    targetId: orderId,
    result: 'success',
    inventoryAction,
    partnerSync,
    partnerWarning: partnerWarning.slice(0, 500),
    createdAt: FieldValue.serverTimestamp(),
  });
};

export const executeAuthorizedKyrubOrderStatus = async (
  authorization: string,
  rawRequest: unknown
): Promise<KyrubActionExecutionResult> => {
  const token = bearerToken(authorization);
  if (!token) throw new KyrubActionExecutionError(401, 'AUTH_REQUIRED', 'Faça login novamente antes de confirmar a ação.');
  const actor = await verifyActor(token);
  const body = requestRecord(rawRequest);
  const proposal = normalizeProposal(body.proposal);
  const confirmed = body.confirmed === true;
  const idempotencyKey = idempotencyKeyFor(proposal, actor.uid);
  const normalizedProposal: KyrubAiUpdateOrderStatusProposal = {
    ...proposal,
    idempotencyKey,
  };
  const policyDecision = evaluateKyrubActionPolicy(normalizedProposal, {
    actorUid: actor.uid,
    permissions: ['orders.write'],
    confirmed,
  });
  if (policyDecision.outcome === 'require_confirmation') {
    throw new KyrubActionExecutionError(409, 'CONFIRMATION_REQUIRED', 'Revise e confirme a mudança do pedido antes da execução.');
  }
  if (policyDecision.outcome !== 'allow') {
    throw new KyrubActionExecutionError(403, 'POLICY_DENIED', 'A política de segurança bloqueou esta alteração do pedido.');
  }

  const envelope = buildEnvelope(normalizedProposal, actor.uid, idempotencyKey, policyDecision);
  const receiptReference = receiptReferenceFor(envelope);
  const existingReceipt = await receiptReference.get();
  if (existingReceipt.exists) {
    const data = existingReceipt.data() as Record<string, unknown>;
    if (!receiptMatches(data, envelope)) {
      throw new KyrubActionExecutionError(409, 'IDEMPOTENCY_CONFLICT', 'Esta confirmação já foi usada com outro conteúdo.');
    }
    return {
      actionId: normalizedProposal.id,
      type: normalizedProposal.type,
      status: 'already_applied',
      entityId: normalizedProposal.orderId,
      origin: envelope.origin,
      idempotencyKey,
      executionEnvelope: envelope,
    };
  }

  const observedStatus = await currentOrderStatus(actor.uid, normalizedProposal.orderId);
  if (observedStatus !== normalizedProposal.expectedCurrentStatus) {
    throw new KyrubActionExecutionError(
      409,
      'ORDER_STATUS_STALE',
      `O pedido mudou de status: a proposta esperava “${normalizedProposal.expectedCurrentStatus}”, mas o status atual é “${observedStatus}”. Peça à Kyrubia para reler o pedido antes de confirmar.`
    );
  }

  const result = await transitionOrderStatusWithInventory(
    actor.uid,
    normalizedProposal.orderId,
    normalizedProposal.nextStatus,
    normalizedProposal.decision ?? {}
  );

  let partnerSync = 'not-applicable';
  let partnerWarning = '';
  if (result.provider === '99food' && result.externalOrderId) {
    try {
      await sendNinetyNineFoodOrderStatus(
        actor.uid,
        result.externalOrderId,
        result.status,
        normalizedProposal.decision?.reason ?? ''
      );
      partnerSync = 'sent';
      await markPartnerSyncSuccess(actor.uid, result.orderId);
    } catch (error) {
      partnerSync = 'attention';
      partnerWarning = error instanceof Error ? error.message : String(error);
      await markPartnerSyncError(actor.uid, result.orderId, partnerWarning).catch(() => undefined);
    }
  }

  await persistReceipt(
    envelope,
    result.orderId,
    result.inventoryAction,
    partnerSync,
    partnerWarning
  );

  return {
    actionId: normalizedProposal.id,
    type: normalizedProposal.type,
    status: 'success',
    entityId: result.orderId,
    origin: envelope.origin,
    idempotencyKey,
    executionEnvelope: envelope,
  };
};