import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import {
  KYRUB_ACTION_REGISTRY,
  type KyrubActionExecutionResult,
  type KyrubActionImpact,
  type KyrubAiCreateNoteProposal,
  type KyrubExecutionEnvelope,
  type KyrubInputProvenance,
  type KyrubPolicyDecision,
} from '../../shared/kyrubActions.js';
import { adminAuth, adminDb } from '../firebaseAdmin.js';
import { evaluateKyrubActionPolicy } from './kyrubiaPolicyEngine.js';

const MAX_TITLE_CHARACTERS = 120;
const MAX_CONTENT_CHARACTERS = 8_000;
const MAX_CHECKLIST_ITEMS = 20;
const MAX_CHECKLIST_ITEM_CHARACTERS = 180;
const EXECUTION_ENVELOPE_TTL_MS = 5 * 60 * 1_000;

const INPUT_PROVENANCE = new Set<KyrubInputProvenance>([
  'user_intent',
  'quoted_content',
  'document_content',
  'tool_output',
  'ai_generated_content',
  'sensor_inference',
]);

export class KyrubActionExecutionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'KyrubActionExecutionError';
  }
}

const cleanText = (value: unknown, maximum: number): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

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

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

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

const normalizeProvenance = (value: unknown): KyrubInputProvenance =>
  typeof value === 'string' && INPUT_PROVENANCE.has(value as KyrubInputProvenance)
    ? value as KyrubInputProvenance
    : 'ai_generated_content';

export const normalizeCreateNoteExecutionProposal = (
  value: unknown
): KyrubAiCreateNoteProposal => {
  const candidate = requestRecord(value);
  if (candidate.type !== 'create_note') {
    throw new KyrubActionExecutionError(
      400,
      'UNSUPPORTED_ACTION',
      'Esta ação ainda não está habilitada para execução pela Kyrubia.'
    );
  }

  const title = cleanText(candidate.title, MAX_TITLE_CHARACTERS);
  const content = typeof candidate.content === 'string'
    ? candidate.content.trim().slice(0, MAX_CONTENT_CHARACTERS)
    : '';
  if (!title || !content) {
    throw new KyrubActionExecutionError(
      400,
      'INVALID_ACTION',
      'A nota precisa ter título e conteúdo antes da confirmação.'
    );
  }

  const checklist = Array.isArray(candidate.checklist)
    ? candidate.checklist
        .map(item => cleanText(item, MAX_CHECKLIST_ITEM_CHARACTERS))
        .filter(Boolean)
        .slice(0, MAX_CHECKLIST_ITEMS)
    : [];

  return {
    id: safeActionId(candidate.id),
    type: 'create_note',
    title,
    content,
    checklist,
    requiresConfirmation: true,
    origin: 'kyrubia',
    risk: KYRUB_ACTION_REGISTRY.create_note.risk,
    inputProvenance: normalizeProvenance(candidate.inputProvenance),
    impact: {
      entityCount: 1,
      reversibility: 'easy',
    },
    ...(cleanText(candidate.idempotencyKey, 240)
      ? { idempotencyKey: cleanText(candidate.idempotencyKey, 240) }
      : {}),
  };
};

const canonicalProposalPayload = (
  proposal: KyrubAiCreateNoteProposal,
  idempotencyKey: string
) => ({
  id: proposal.id,
  type: proposal.type,
  title: proposal.title,
  content: proposal.content,
  checklist: proposal.checklist,
  requiresConfirmation: true,
  origin: proposal.origin ?? 'kyrubia',
  risk: proposal.risk ?? 'low',
  inputProvenance: proposal.inputProvenance ?? 'ai_generated_content',
  impact: proposal.impact ?? { entityCount: 1, reversibility: 'easy' as const },
  idempotencyKey,
});

export const hashKyrubActionProposal = (
  proposal: KyrubAiCreateNoteProposal,
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

export const buildKyrubExecutionEnvelope = (
  proposal: KyrubAiCreateNoteProposal,
  actorUid: string,
  idempotencyKey: string,
  policyDecision: KyrubPolicyDecision,
  now = new Date()
): KyrubExecutionEnvelope => {
  const authorizedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + EXECUTION_ENVELOPE_TTL_MS).toISOString();
  const impact: KyrubActionImpact = proposal.impact ?? {
    entityCount: 1,
    reversibility: 'easy',
  };

  return {
    version: 1,
    executionId: deterministicExecutionId(actorUid, idempotencyKey),
    actionId: proposal.id,
    actionType: proposal.type,
    actorUid,
    origin: proposal.origin ?? 'kyrubia',
    inputProvenance: proposal.inputProvenance ?? 'ai_generated_content',
    impact,
    proposalHash: hashKyrubActionProposal(proposal, idempotencyKey),
    policyDecisionId: policyDecision.id,
    authorizationMode: 'human_confirmation',
    authorizedAt,
    expiresAt,
    idempotencyKey,
  };
};

const ownerNameFor = (actor: {
  name?: string;
  email?: string;
}): string => actor.name?.trim() || actor.email?.split('@')[0] || 'Usuário do Kyrub';

const executeCreateNote = async (
  actor: {
    uid: string;
    name?: string;
    email?: string;
    picture?: string;
  },
  proposal: KyrubAiCreateNoteProposal,
  envelope: KyrubExecutionEnvelope
): Promise<KyrubActionExecutionResult> => {
  const noteId = `kyrubia-note-${proposal.id}`;
  const noteReference = adminDb.doc(`users/${actor.uid}/tasks/${noteId}`);
  const receiptReference = adminDb.doc(
    `kyrub_action_receipts/${envelope.executionId}`
  );
  const ownerName = ownerNameFor(actor);
  const now = envelope.authorizedAt;

  const status = await adminDb.runTransaction(async transaction => {
    const existing = await transaction.get(noteReference);
    if (existing.exists) {
      const data = existing.data() as Record<string, unknown>;
      if (
        data.actionIdempotencyKey === envelope.idempotencyKey &&
        data.actionProposalHash === envelope.proposalHash
      ) {
        return 'already_applied' as const;
      }
      throw new KyrubActionExecutionError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'Esta ação já foi utilizada com outro conteúdo. Gere uma nova proposta antes de tentar novamente.'
      );
    }

    transaction.set(noteReference, {
      schemaVersion: 1,
      id: noteId,
      ownerId: actor.uid,
      ownerName,
      ownerEmail: actor.email ?? '',
      ownerAvatar: actor.picture ?? '',
      title: proposal.title.toUpperCase(),
      content: proposal.content,
      associatedUsers: ['Você'],
      checklist: proposal.checklist.map((text, index) => ({
        id: `${noteId}-item-${index + 1}`,
        text,
        done: false,
      })),
      auditLogs: [
        {
          user: ownerName,
          action: 'Criou a nota pela Kyrubia após confirmação',
          timestamp: now,
          userId: actor.uid,
        },
      ],
      shared: false,
      mediaUrls: [],
      reminderDateTime: null,
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

    transaction.set(receiptReference, {
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
      targetType: 'note',
      targetId: noteId,
      result: 'success',
      createdAt: FieldValue.serverTimestamp(),
    });

    return 'success' as const;
  });

  return {
    actionId: proposal.id,
    type: proposal.type,
    status,
    entityId: noteId,
    origin: envelope.origin,
    idempotencyKey: envelope.idempotencyKey,
    executionEnvelope: envelope,
  };
};

const mapPolicyFailure = (decision: KyrubPolicyDecision): never => {
  if (decision.outcome === 'require_confirmation') {
    throw new KyrubActionExecutionError(
      409,
      'CONFIRMATION_REQUIRED',
      'Revise e confirme esta ação antes da execução.'
    );
  }

  throw new KyrubActionExecutionError(
    403,
    'POLICY_DENIED',
    'A política de segurança do Kyrub bloqueou esta execução.'
  );
};

export const executeAuthorizedKyrubAction = async (
  authorization: string,
  rawRequest: unknown
): Promise<KyrubActionExecutionResult> => {
  const token = bearerToken(authorization);
  if (!token) {
    throw new KyrubActionExecutionError(
      401,
      'AUTH_REQUIRED',
      'Faça login novamente antes de confirmar a ação.'
    );
  }

  const actor = await adminAuth.verifyIdToken(token, true);
  const body = requestRecord(rawRequest);
  const proposal = normalizeCreateNoteExecutionProposal(body.proposal);
  const confirmed = body.confirmed === true;
  const idempotencyKey = proposal.idempotencyKey?.trim() ||
    `kyrubia:create_note:${actor.uid}:${proposal.id}`;
  const normalizedProposal: KyrubAiCreateNoteProposal = {
    ...proposal,
    idempotencyKey,
  };
  const policyDecision = evaluateKyrubActionPolicy(normalizedProposal, {
    actorUid: actor.uid,
    permissions: ['notes.write'],
    confirmed,
  });

  if (policyDecision.outcome !== 'allow') mapPolicyFailure(policyDecision);

  const envelope = buildKyrubExecutionEnvelope(
    normalizedProposal,
    actor.uid,
    idempotencyKey,
    policyDecision
  );

  return executeCreateNote(
    {
      uid: actor.uid,
      name: typeof actor.name === 'string' ? actor.name : undefined,
      email: typeof actor.email === 'string' ? actor.email : undefined,
      picture: typeof actor.picture === 'string' ? actor.picture : undefined,
    },
    normalizedProposal,
    envelope
  );
};

export const mapKyrubActionExecutionError = (error: unknown): {
  status: number;
  body: { error: string; code: string };
} => {
  if (error instanceof KyrubActionExecutionError) {
    return {
      status: error.status,
      body: { error: error.message, code: error.code },
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/id-token|expired|revoked|auth/i.test(message)) {
    return {
      status: 401,
      body: {
        error: 'Sua sessão expirou. Entre novamente no Kyrub.',
        code: 'AUTH_REQUIRED',
      },
    };
  }
  if (/default credentials|credential implementation|could not load/i.test(message)) {
    return {
      status: 503,
      body: {
        error: 'O executor seguro ainda não possui credencial do Firebase neste ambiente.',
        code: 'EXECUTOR_NOT_CONFIGURED',
      },
    };
  }

  console.error('[Kyrub Safe Execution]', error);
  return {
    status: 503,
    body: {
      error: 'Não foi possível executar a ação com segurança agora.',
      code: 'EXECUTION_UNAVAILABLE',
    },
  };
};
