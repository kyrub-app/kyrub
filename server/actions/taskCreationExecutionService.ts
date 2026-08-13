import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import type {
  KyrubActionExecutionResult,
  KyrubAiCreateTaskProposal,
  KyrubExecutionEnvelope,
  KyrubInputProvenance,
  KyrubPolicyDecision,
} from '../../shared/kyrubActions.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';
import { KyrubActionExecutionError } from './actionExecutionService.js';
import { evaluateKyrubActionPolicy } from './kyrubiaPolicyEngine.js';

const MAX_TITLE_CHARACTERS = 120;
const MAX_CONTENT_CHARACTERS = 8_000;
const EXECUTION_ENVELOPE_TTL_MS = 5 * 60 * 1_000;
const REMINDER_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const INPUT_PROVENANCE = new Set<KyrubInputProvenance>([
  'user_intent',
  'quoted_content',
  'document_content',
  'tool_output',
  'ai_generated_content',
  'sensor_inference',
]);

const cleanText = (value: unknown, maximum: number): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const requestRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new KyrubActionExecutionError(
      400,
      'INVALID_REQUEST',
      'A solicitação de execução é inválida.'
    );
  }
  return value as Record<string, unknown>;
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
      'A ação não possui um identificador válido.'
    );
  }
  return normalized;
};

const normalizeProvenance = (value: unknown): KyrubInputProvenance =>
  typeof value === 'string' && INPUT_PROVENANCE.has(value as KyrubInputProvenance)
    ? value as KyrubInputProvenance
    : 'ai_generated_content';

const validReminder = (value: string): boolean => {
  if (!REMINDER_PATTERN.test(value)) return false;
  const [datePart, timePart] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    month < 1 || month > 12 ||
    day < 1 || day > 31 ||
    hour < 0 || hour > 23 ||
    minute < 0 || minute > 59
  ) return false;

  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute;
};

const normalizeProposal = (value: unknown): KyrubAiCreateTaskProposal => {
  const candidate = requestRecord(value);
  if (candidate.type !== 'create_task') {
    throw new KyrubActionExecutionError(
      400,
      'UNSUPPORTED_ACTION',
      'Esta ação não é uma criação de tarefa suportada.'
    );
  }

  const title = cleanText(candidate.title, MAX_TITLE_CHARACTERS);
  const content = typeof candidate.content === 'string'
    ? candidate.content.trim().slice(0, MAX_CONTENT_CHARACTERS)
    : '';
  if (!title || !content) {
    throw new KyrubActionExecutionError(
      400,
      'INVALID_TASK',
      'A tarefa precisa ter uma descrição válida antes da confirmação.'
    );
  }

  let reminderDateTime: string | null = null;
  if (candidate.reminderDateTime !== null && candidate.reminderDateTime !== undefined) {
    const reminder = cleanText(candidate.reminderDateTime, 16);
    if (!validReminder(reminder)) {
      throw new KyrubActionExecutionError(
        400,
        'INVALID_TASK_REMINDER',
        'O lembrete da tarefa não possui uma data e horário válidos.'
      );
    }
    reminderDateTime = reminder;
  }

  return {
    id: safeActionId(candidate.id),
    type: 'create_task',
    title,
    content,
    reminderDateTime,
    requiresConfirmation: true,
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

const verifyActionActor = async (token: string) => {
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

const idempotencyKeyFor = (
  proposal: KyrubAiCreateTaskProposal,
  actorUid: string
): string => proposal.idempotencyKey?.trim() ||
  `kyrubia:${proposal.type}:${actorUid}:${proposal.id}`;

const canonicalProposalPayload = (
  proposal: KyrubAiCreateTaskProposal,
  idempotencyKey: string
): Record<string, unknown> => ({
  id: proposal.id,
  type: proposal.type,
  title: proposal.title,
  content: proposal.content,
  reminderDateTime: proposal.reminderDateTime,
  requiresConfirmation: true,
  origin: proposal.origin ?? 'kyrubia',
  risk: 'low',
  inputProvenance: proposal.inputProvenance ?? 'ai_generated_content',
  impact: proposal.impact ?? { entityCount: 1, reversibility: 'easy' },
  idempotencyKey,
});

const proposalHash = (
  proposal: KyrubAiCreateTaskProposal,
  idempotencyKey: string
): string => createHash('sha256')
  .update(JSON.stringify(canonicalProposalPayload(proposal, idempotencyKey)))
  .digest('hex');

const deterministicExecutionId = (
  actorUid: string,
  idempotencyKey: string
): string => `exec_${createHash('sha256')
  .update(`${actorUid}:${idempotencyKey}`)
  .digest('hex')
  .slice(0, 40)}`;

const buildEnvelope = (
  proposal: KyrubAiCreateTaskProposal,
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
  impact: proposal.impact ?? { entityCount: 1, reversibility: 'easy' },
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

const receiptPayload = (
  envelope: KyrubExecutionEnvelope,
  taskId: string,
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
  targetType: 'task',
  targetId: taskId,
  result,
  createdAt: FieldValue.serverTimestamp(),
});

const ownerNameFor = (actor: { name?: string; email?: string }): string =>
  actor.name?.trim() || actor.email?.split('@')[0] || 'Usuário do Kyrub';

const executeTaskCreation = async (
  actor: { uid: string; name?: string; email?: string },
  proposal: KyrubAiCreateTaskProposal,
  envelope: KyrubExecutionEnvelope
): Promise<KyrubActionExecutionResult> => {
  const taskId = `kyrubia-task-${proposal.id}`;
  const taskReference = adminDb.doc(`users/${actor.uid}/tasks/${taskId}`);
  const receiptReference = receiptReferenceFor(envelope);
  const ownerName = ownerNameFor(actor);
  const now = envelope.authorizedAt;

  const status = await adminDb.runTransaction(async transaction => {
    const [existingTask, existingReceipt] = await Promise.all([
      transaction.get(taskReference),
      transaction.get(receiptReference),
    ]);

    if (existingReceipt.exists) {
      const data = existingReceipt.data() as Record<string, unknown>;
      if (receiptMatches(data, envelope)) return 'already_applied' as const;
      throw new KyrubActionExecutionError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'Esta criação de tarefa já foi utilizada com outro conteúdo.'
      );
    }

    if (existingTask.exists) {
      const data = existingTask.data() as Record<string, unknown>;
      if (
        data.actionIdempotencyKey === envelope.idempotencyKey &&
        data.actionProposalHash === envelope.proposalHash &&
        data.ownerId === actor.uid
      ) {
        transaction.set(
          receiptReference,
          receiptPayload(envelope, taskId, 'already_applied')
        );
        return 'already_applied' as const;
      }
      throw new KyrubActionExecutionError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'Já existe uma tarefa diferente com este identificador de ação.'
      );
    }

    transaction.set(taskReference, {
      schemaVersion: 1,
      id: taskId,
      ownerId: actor.uid,
      ownerName,
      ownerEmail: actor.email ?? '',
      ownerAvatar: '',
      title: proposal.title.toUpperCase(),
      content: proposal.content,
      associatedUsers: ['Você'],
      checklist: [],
      auditLogs: [
        {
          user: ownerName,
          action: 'Criou a tarefa pela Kyrubia após confirmação',
          timestamp: now,
          userId: actor.uid,
        },
      ],
      shared: false,
      mediaUrls: [],
      reminderDateTime: proposal.reminderDateTime,
      isPublishedToFeed: false,
      collaborators: [],
      sharedWith: [],
      acceptedWith: [],
      createdAtIso: now,
      updatedAtIso: now,
      serverUpdatedAt: FieldValue.serverTimestamp(),
      actionOrigin: envelope.origin,
      actionType: proposal.type,
      actionId: proposal.id,
      actionIdempotencyKey: envelope.idempotencyKey,
      actionConfirmedAtIso: now,
      actionProposalHash: envelope.proposalHash,
      actionExecutionId: envelope.executionId,
      actionPolicyDecisionId: envelope.policyDecisionId,
    });
    transaction.set(receiptReference, receiptPayload(envelope, taskId));
    return 'success' as const;
  });

  return {
    actionId: proposal.id,
    type: proposal.type,
    status,
    entityId: taskId,
    origin: envelope.origin,
    idempotencyKey: envelope.idempotencyKey,
    executionEnvelope: envelope,
  };
};

const mapPolicyFailure = (decision: KyrubPolicyDecision): never => {
  if (decision.reasons.includes('AUTH_REQUIRED')) {
    throw new KyrubActionExecutionError(401, 'AUTH_REQUIRED', 'Faça login novamente.');
  }
  if (decision.reasons.includes('PERMISSION_REQUIRED')) {
    throw new KyrubActionExecutionError(
      403,
      'PERMISSION_REQUIRED',
      'Sua sessão não possui permissão para criar esta tarefa.'
    );
  }
  if (
    decision.reasons.includes('CONFIRMATION_REQUIRED') ||
    decision.reasons.includes('UNTRUSTED_INPUT_REQUIRES_CONFIRMATION')
  ) {
    throw new KyrubActionExecutionError(
      409,
      'CONFIRMATION_REQUIRED',
      'Revise e confirme a tarefa antes de salvar.'
    );
  }
  throw new KyrubActionExecutionError(
    403,
    'ACTION_DENIED',
    'A política de segurança bloqueou esta criação de tarefa.'
  );
};

export const isKyrubTaskCreationExecutionRequest = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  const proposal = body.proposal;
  return Boolean(
    proposal &&
    typeof proposal === 'object' &&
    !Array.isArray(proposal) &&
    (proposal as Record<string, unknown>).type === 'create_task'
  );
};

export const executeAuthorizedKyrubTaskCreation = async (
  authorization: string,
  rawRequest: unknown
): Promise<KyrubActionExecutionResult> => {
  const token = bearerToken(authorization);
  if (!token) {
    throw new KyrubActionExecutionError(
      401,
      'AUTH_REQUIRED',
      'Faça login novamente antes de confirmar a tarefa.'
    );
  }

  const actor = await verifyActionActor(token);
  const body = requestRecord(rawRequest);
  const proposal = normalizeProposal(body.proposal);
  const confirmed = body.confirmed === true;
  const idempotencyKey = idempotencyKeyFor(proposal, actor.uid);
  const normalizedProposal: KyrubAiCreateTaskProposal = {
    ...proposal,
    idempotencyKey,
  };
  const policyDecision = evaluateKyrubActionPolicy(normalizedProposal, {
    actorUid: actor.uid,
    permissions: ['tasks.write'],
    confirmed,
  });

  if (policyDecision.outcome !== 'allow') mapPolicyFailure(policyDecision);

  const envelope = buildEnvelope(
    normalizedProposal,
    actor.uid,
    idempotencyKey,
    policyDecision
  );

  return executeTaskCreation(
    { uid: actor.uid, name: actor.name, email: actor.email },
    normalizedProposal,
    envelope
  );
};
