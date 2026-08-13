import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';
import { KyrubActionExecutionError } from './actionExecutionService.js';

const EXECUTION_ID_PATTERN = /^exec_[a-f0-9]{40}$/;
const MAX_ACTION_TYPE_CHARACTERS = 80;
const MAX_PROPOSAL_ID_CHARACTERS = 120;
const MAX_ENTITY_ID_CHARACTERS = 180;

const cleanText = (value: unknown, maximum: number): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const requestRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new KyrubActionExecutionError(
      400,
      'INVALID_REQUEST',
      'A solicitação de verificação de recibo é inválida.'
    );
  }
  return value as Record<string, unknown>;
};

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const verifyReceiptActor = async (authorization: string) => {
  const token = bearerToken(authorization);
  if (!token) {
    throw new KyrubActionExecutionError(
      401,
      'AUTH_REQUIRED',
      'Faça login novamente antes de verificar o resultado desta ação.'
    );
  }

  try {
    return await verifyFirebaseIdToken(token);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
    if (code === 'AUTH_UNAVAILABLE') {
      throw new KyrubActionExecutionError(
        503,
        'AUTH_UNAVAILABLE',
        'Não foi possível validar sua sessão agora. Tente novamente em instantes.'
      );
    }
    throw new KyrubActionExecutionError(
      401,
      'AUTH_REQUIRED',
      'Sua sessão expirou. Entre novamente no Kyrub.'
    );
  }
};

export type KyrubActionReceiptVerificationRequest = {
  operation: 'verify_receipt';
  executionId: string;
  actionType: string;
  proposalId: string;
  entityId: string;
};

export type KyrubActionReceiptVerificationResult =
  | {
      verified: true;
      executionId: string;
      actionType: string;
      proposalId: string;
      entityType: string;
      entityId: string;
    }
  | { verified: false };

export const isKyrubActionReceiptVerificationRequest = (
  value: unknown
): boolean =>
  Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).operation === 'verify_receipt'
  );

const normalizeVerificationRequest = (
  value: unknown
): KyrubActionReceiptVerificationRequest => {
  const candidate = requestRecord(value);
  if (candidate.operation !== 'verify_receipt') {
    throw new KyrubActionExecutionError(
      400,
      'INVALID_REQUEST',
      'A operação de verificação de recibo não é válida.'
    );
  }

  const executionId = cleanText(candidate.executionId, 64);
  const actionType = cleanText(candidate.actionType, MAX_ACTION_TYPE_CHARACTERS);
  const proposalId = cleanText(candidate.proposalId, MAX_PROPOSAL_ID_CHARACTERS);
  const entityId = cleanText(candidate.entityId, MAX_ENTITY_ID_CHARACTERS);

  if (
    !EXECUTION_ID_PATTERN.test(executionId) ||
    !actionType ||
    !proposalId ||
    !entityId
  ) {
    throw new KyrubActionExecutionError(
      400,
      'INVALID_RECEIPT_REFERENCE',
      'A referência do recibo não é válida.'
    );
  }

  return {
    operation: 'verify_receipt',
    executionId,
    actionType,
    proposalId,
    entityId,
  };
};

export const verifyAuthorizedKyrubActionReceipt = async (
  authorization: string,
  rawRequest: unknown
): Promise<KyrubActionReceiptVerificationResult> => {
  const actor = await verifyReceiptActor(authorization);
  const request = normalizeVerificationRequest(rawRequest);
  const snapshot = await adminDb.doc(
    `kyrub_action_receipts/${request.executionId}`
  ).get();

  if (!snapshot.exists) return { verified: false };
  const data = snapshot.data() as Record<string, unknown>;

  if (
    data.actorUid !== actor.uid ||
    data.executionId !== request.executionId ||
    data.actionType !== request.actionType ||
    data.actionId !== request.proposalId ||
    data.targetId !== request.entityId ||
    (data.result !== 'success' && data.result !== 'already_applied')
  ) {
    return { verified: false };
  }

  const entityType = cleanText(data.targetType, 80);
  if (!entityType) return { verified: false };

  return {
    verified: true,
    executionId: request.executionId,
    actionType: request.actionType,
    proposalId: request.proposalId,
    entityType,
    entityId: request.entityId,
  };
};
