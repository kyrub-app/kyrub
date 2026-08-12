import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import {
  KYRUB_ACTION_REGISTRY,
  type KyrubActionAuthorizationGrant,
  type KyrubActionExecutionResult,
  type KyrubActionImpact,
  type KyrubActionProposal,
  type KyrubAiCreateNoteProposal,
  type KyrubAiCreateProductProposal,
  type KyrubAiStartStoreActivationProposal,
  type KyrubAiUpdateStoreProfileProposal,
  type KyrubAuthorizationMode,
  type KyrubExecutionEnvelope,
  type KyrubInputProvenance,
  type KyrubPolicyDecision,
  type KyrubStoreProfilePatch,
} from '../../shared/kyrubActions.js';
import {
  KYRUB_COMMERCIAL_PLANS_V1,
  type KyrubCommercialPlanId,
} from '../../shared/kyrubCommercialPlans.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';
import { evaluateKyrubActionPolicy } from './kyrubiaPolicyEngine.js';

const MAX_TITLE_CHARACTERS = 120;
const MAX_CONTENT_CHARACTERS = 8_000;
const MAX_CHECKLIST_ITEMS = 20;
const MAX_CHECKLIST_ITEM_CHARACTERS = 180;
const MAX_STORE_NAME_CHARACTERS = 120;
const MAX_STORE_DESCRIPTION_CHARACTERS = 1_000;
const MAX_STORE_ADDRESS_CHARACTERS = 240;
const MAX_STORE_CONTACT_CHARACTERS = 160;
const MAX_STORE_KEYWORDS = 30;
const MAX_STORE_KEYWORD_CHARACTERS = 60;
const MAX_PRODUCT_NAME_CHARACTERS = 160;
const MAX_PRODUCT_DESCRIPTION_CHARACTERS = 4_000;
const MAX_PRODUCT_CATEGORY_CHARACTERS = 240;
const MAX_PRODUCT_IMAGE_CHARACTERS = 2_000;
const MAX_PRODUCTS_PER_TENANT = 200;
const EXECUTION_ENVELOPE_TTL_MS = 5 * 60 * 1_000;
const STORE_ACTIVATION_GRANT_TTL_MS = 30 * 60 * 1_000;

const INPUT_PROVENANCE = new Set<KyrubInputProvenance>([
  'user_intent',
  'quoted_content',
  'document_content',
  'tool_output',
  'ai_generated_content',
  'sensor_inference',
]);

const STORE_ACTIVATION_FIELDS = [
  'name',
  'description',
  'address',
  'contact',
  'keywords',
] as const;

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

const normalizeExecutableStorePlan = (value: unknown): KyrubCommercialPlanId =>
  value === 'pro' || value === 'business' ? value : 'free';

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

const normalizeKeywords = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap(item => {
    const keyword = cleanText(item, MAX_STORE_KEYWORD_CHARACTERS)
      .toLocaleLowerCase('pt-BR');
    if (!keyword || seen.has(keyword)) return [];
    seen.add(keyword);
    return [keyword];
  }).slice(0, MAX_STORE_KEYWORDS);
};

const slugifyStoreName = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);

const finiteNonNegativeNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;

const nonNegativeInteger = (value: unknown): number | null => {
  const parsed = finiteNonNegativeNumber(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
};

const metadataFor = <Proposal extends KyrubActionProposal>(
  candidate: Record<string, unknown>,
  proposal: Proposal
): Proposal => ({
  ...proposal,
  origin: 'kyrubia',
  risk: KYRUB_ACTION_REGISTRY[proposal.type].risk,
  inputProvenance: normalizeProvenance(candidate.inputProvenance),
  impact: {
    entityCount: 1,
    reversibility: proposal.type === 'create_product' ? 'limited' : 'easy',
  },
  ...(cleanText(candidate.idempotencyKey, 240)
    ? { idempotencyKey: cleanText(candidate.idempotencyKey, 240) }
    : {}),
});

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

  return metadataFor(candidate, {
    id: safeActionId(candidate.id),
    type: 'create_note',
    title,
    content,
    checklist,
    requiresConfirmation: true,
  });
};

const normalizeStartStoreActivationProposal = (
  candidate: Record<string, unknown>
): KyrubAiStartStoreActivationProposal => metadataFor(candidate, {
  id: safeActionId(candidate.id),
  type: 'start_store_activation',
  purpose: candidate.purpose === 'create_product' ? 'create_product' : 'store_setup',
  requiresConfirmation: true,
});

const normalizeStorePatch = (value: unknown): KyrubStoreProfilePatch => {
  const candidate = requestRecord(value);
  const patch: KyrubStoreProfilePatch = {};
  if (Object.prototype.hasOwnProperty.call(candidate, 'name')) {
    const name = cleanText(candidate.name, MAX_STORE_NAME_CHARACTERS);
    if (!name) {
      throw new KyrubActionExecutionError(
        400,
        'INVALID_STORE_PROFILE',
        'O nome da loja não pode ficar vazio.'
      );
    }
    patch.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(candidate, 'description')) {
    patch.description = cleanText(
      candidate.description,
      MAX_STORE_DESCRIPTION_CHARACTERS
    );
  }
  if (Object.prototype.hasOwnProperty.call(candidate, 'address')) {
    patch.address = cleanText(candidate.address, MAX_STORE_ADDRESS_CHARACTERS);
  }
  if (Object.prototype.hasOwnProperty.call(candidate, 'contact')) {
    patch.contact = cleanText(candidate.contact, MAX_STORE_CONTACT_CHARACTERS);
  }
  if (Object.prototype.hasOwnProperty.call(candidate, 'keywords')) {
    const keywords = normalizeKeywords(candidate.keywords);
    if (keywords.length === 0) {
      throw new KyrubActionExecutionError(
        400,
        'INVALID_STORE_PROFILE',
        'Informe pelo menos uma palavra-chave válida para a loja.'
      );
    }
    patch.keywords = keywords;
  }
  if (Object.keys(patch).length === 0) {
    throw new KyrubActionExecutionError(
      400,
      'INVALID_STORE_PROFILE',
      'Nenhuma informação válida da loja foi informada.'
    );
  }
  return patch;
};

const normalizeUpdateStoreProfileProposal = (
  candidate: Record<string, unknown>
): KyrubAiUpdateStoreProfileProposal => {
  const requiresConfirmation = candidate.requiresConfirmation === true;
  const activationGrantId = requiresConfirmation
    ? ''
    : safeActionId(candidate.activationGrantId);
  return metadataFor(candidate, {
    id: safeActionId(candidate.id),
    type: 'update_store_profile',
    ...(activationGrantId ? { activationGrantId } : {}),
    patch: normalizeStorePatch(candidate.patch),
    requiresConfirmation,
  });
};

const normalizeCreateProductProposal = (
  candidate: Record<string, unknown>
): KyrubAiCreateProductProposal => {
  const name = cleanText(candidate.name, MAX_PRODUCT_NAME_CHARACTERS);
  const description = typeof candidate.description === 'string'
    ? candidate.description.trim().slice(0, MAX_PRODUCT_DESCRIPTION_CHARACTERS)
    : '';
  const category = cleanText(candidate.category, MAX_PRODUCT_CATEGORY_CHARACTERS);
  const image = cleanText(candidate.image, MAX_PRODUCT_IMAGE_CHARACTERS);
  const isService = candidate.isService === true;
  const isComplimentary = candidate.isComplimentary === true;
  const parsedPrice = isComplimentary ? 0 : finiteNonNegativeNumber(candidate.price);
  const parsedStock = isService ? 0 : nonNegativeInteger(candidate.stock);

  if (!name) {
    throw new KyrubActionExecutionError(400, 'INVALID_PRODUCT', 'Informe o nome do item.');
  }
  if (!category) {
    throw new KyrubActionExecutionError(400, 'INVALID_PRODUCT', 'Informe a categoria do item.');
  }
  if (parsedPrice === null) {
    throw new KyrubActionExecutionError(400, 'INVALID_PRODUCT', 'Informe um preço válido.');
  }
  if (parsedStock === null) {
    throw new KyrubActionExecutionError(400, 'INVALID_PRODUCT', 'Informe um estoque válido.');
  }

  return metadataFor(candidate, {
    id: safeActionId(candidate.id),
    type: 'create_product',
    name,
    description,
    price: parsedPrice,
    stock: parsedStock,
    category,
    image,
    isService,
    isComplimentary,
    requiresConfirmation: true,
  });
};

export const normalizeKyrubActionExecutionProposal = (
  value: unknown
): KyrubActionProposal => {
  const candidate = requestRecord(value);
  switch (candidate.type) {
    case 'create_note':
      return normalizeCreateNoteExecutionProposal(candidate);
    case 'start_store_activation':
      return normalizeStartStoreActivationProposal(candidate);
    case 'update_store_profile':
      return normalizeUpdateStoreProfileProposal(candidate);
    case 'create_product':
      return normalizeCreateProductProposal(candidate);
    default:
      throw new KyrubActionExecutionError(
        400,
        'UNSUPPORTED_ACTION',
        'Esta ação ainda não está habilitada para execução pela Kyrubia.'
      );
  }
};

const canonicalProposalPayload = (
  proposal: KyrubActionProposal,
  idempotencyKey: string
): Record<string, unknown> => {
  const common = {
    id: proposal.id,
    type: proposal.type,
    requiresConfirmation: proposal.requiresConfirmation,
    origin: proposal.origin ?? 'kyrubia',
    risk: proposal.risk ?? KYRUB_ACTION_REGISTRY[proposal.type].risk,
    inputProvenance: proposal.inputProvenance ?? 'ai_generated_content',
    impact: proposal.impact ?? { entityCount: 1, reversibility: 'easy' as const },
    idempotencyKey,
  };

  switch (proposal.type) {
    case 'create_note':
      return {
        ...common,
        title: proposal.title,
        content: proposal.content,
        checklist: proposal.checklist,
      };
    case 'start_store_activation':
      return { ...common, purpose: proposal.purpose };
    case 'update_store_profile':
      return {
        ...common,
        activationGrantId: proposal.activationGrantId,
        patch: proposal.patch,
      };
    case 'create_product':
      return {
        ...common,
        name: proposal.name,
        description: proposal.description,
        price: proposal.price,
        stock: proposal.stock,
        category: proposal.category,
        image: proposal.image,
        isService: proposal.isService,
        isComplimentary: proposal.isComplimentary,
      };
    default:
      return common;
  }
};

export const hashKyrubActionProposal = (
  proposal: KyrubActionProposal,
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

const deterministicGrantId = (
  actorUid: string,
  idempotencyKey: string
): string => `grant_${createHash('sha256')
  .update(`store_activation:${actorUid}:${idempotencyKey}`)
  .digest('hex')
  .slice(0, 40)}`;

const deterministicProductId = (
  actorUid: string,
  actionId: string
): string => `product-${createHash('sha256')
  .update(`kyrubia:${actorUid}:${actionId}`)
  .digest('hex')
  .slice(0, 32)}`;

export const buildKyrubExecutionEnvelope = (
  proposal: KyrubActionProposal,
  actorUid: string,
  idempotencyKey: string,
  policyDecision: KyrubPolicyDecision,
  now = new Date(),
  authorizationMode: KyrubAuthorizationMode = 'human_confirmation'
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
    authorizationMode,
    authorizedAt,
    expiresAt,
    idempotencyKey,
  };
};

const ownerNameFor = (actor: {
  name?: string;
  email?: string;
}): string => actor.name?.trim() || actor.email?.split('@')[0] || 'Usuário do Kyrub';

const receiptReferenceFor = (envelope: KyrubExecutionEnvelope) =>
  adminDb.doc(`kyrub_action_receipts/${envelope.executionId}`);

const receiptMatches = (
  data: Record<string, unknown>,
  envelope: KyrubExecutionEnvelope
): boolean =>
  data.idempotencyKey === envelope.idempotencyKey &&
  data.proposalHash === envelope.proposalHash &&
  data.actorUid === envelope.actorUid &&
  data.actionType === envelope.actionType;

const receiptPayload = (
  envelope: KyrubExecutionEnvelope,
  targetType: string,
  targetId: string,
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
  targetType,
  targetId,
  result,
  createdAt: FieldValue.serverTimestamp(),
});

const executeCreateNote = async (
  actor: {
    uid: string;
    name?: string;
    email?: string;
  },
  proposal: KyrubAiCreateNoteProposal,
  envelope: KyrubExecutionEnvelope
): Promise<KyrubActionExecutionResult> => {
  const noteId = `kyrubia-note-${proposal.id}`;
  const noteReference = adminDb.doc(`users/${actor.uid}/tasks/${noteId}`);
  const receiptReference = receiptReferenceFor(envelope);
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
      ownerAvatar: '',
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

    transaction.set(
      receiptReference,
      receiptPayload(envelope, 'note', noteId)
    );
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

const executeStartStoreActivation = async (
  actor: { uid: string },
  proposal: KyrubAiStartStoreActivationProposal,
  envelope: KyrubExecutionEnvelope
): Promise<KyrubActionExecutionResult> => {
  const grantId = deterministicGrantId(actor.uid, envelope.idempotencyKey);
  const grantReference = adminDb.doc(`kyrub_action_grants/${grantId}`);
  const receiptReference = receiptReferenceFor(envelope);
  const grantExpiresAt = new Date(
    Date.parse(envelope.authorizedAt) + STORE_ACTIVATION_GRANT_TTL_MS
  ).toISOString();

  const status = await adminDb.runTransaction(async transaction => {
    const [existingGrant, existingReceipt] = await Promise.all([
      transaction.get(grantReference),
      transaction.get(receiptReference),
    ]);

    if (existingReceipt.exists) {
      const data = existingReceipt.data() as Record<string, unknown>;
      if (receiptMatches(data, envelope)) return 'already_applied' as const;
      throw new KyrubActionExecutionError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'Esta autorização já foi utilizada com outro conteúdo.'
      );
    }

    if (existingGrant.exists) {
      const data = existingGrant.data() as Record<string, unknown>;
      if (
        data.actorUid === actor.uid &&
        data.scope === 'store_activation' &&
        data.sourceProposalHash === envelope.proposalHash
      ) {
        transaction.set(
          receiptReference,
          receiptPayload(envelope, 'authorization_grant', grantId)
        );
        return 'already_applied' as const;
      }
      throw new KyrubActionExecutionError(
        409,
        'AUTHORIZATION_CONFLICT',
        'Já existe uma autorização diferente com este identificador.'
      );
    }

    transaction.set(grantReference, {
      schemaVersion: 1,
      id: grantId,
      actorUid: actor.uid,
      scope: 'store_activation',
      purpose: proposal.purpose,
      status: 'active',
      allowedActions: ['update_store_profile'],
      allowedFields: [...STORE_ACTIVATION_FIELDS],
      sourceExecutionId: envelope.executionId,
      sourceProposalHash: envelope.proposalHash,
      authorizedAt: envelope.authorizedAt,
      expiresAt: grantExpiresAt,
      revokedAt: '',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(
      receiptReference,
      receiptPayload(envelope, 'authorization_grant', grantId)
    );
    return 'success' as const;
  });

  const authorizationGrant: KyrubActionAuthorizationGrant = {
    id: grantId,
    scope: 'store_activation',
    expiresAt: grantExpiresAt,
  };

  return {
    actionId: proposal.id,
    type: proposal.type,
    status,
    entityId: grantId,
    origin: envelope.origin,
    idempotencyKey: envelope.idempotencyKey,
    executionEnvelope: envelope,
    authorizationGrant,
  };
};

const assertActiveStoreActivationGrant = async (
  actorUid: string,
  grantId: string
): Promise<void> => {
  const snapshot = await adminDb.doc(`kyrub_action_grants/${grantId}`).get();
  if (!snapshot.exists) {
    throw new KyrubActionExecutionError(
      403,
      'AUTHORIZATION_REQUIRED',
      'A autorização para configurar a loja não foi encontrada. Confirme a ativação novamente.'
    );
  }
  const data = snapshot.data() as Record<string, unknown>;
  const allowedActions = Array.isArray(data.allowedActions)
    ? data.allowedActions.filter(item => typeof item === 'string')
    : [];
  const expiresAt = typeof data.expiresAt === 'string' ? data.expiresAt : '';
  if (
    data.actorUid !== actorUid ||
    data.scope !== 'store_activation' ||
    data.status !== 'active' ||
    !allowedActions.includes('update_store_profile')
  ) {
    throw new KyrubActionExecutionError(
      403,
      'AUTHORIZATION_INVALID',
      'Esta autorização não permite alterar o perfil desta loja.'
    );
  }
  if (!expiresAt || Date.parse(expiresAt) <= Date.now()) {
    throw new KyrubActionExecutionError(
      403,
      'AUTHORIZATION_EXPIRED',
      'A autorização de ativação expirou. Confirme novamente para continuar.'
    );
  }
};

const privateStorePath = (uid: string): string => `users/${uid}/stores/${uid}`;

const findCanonicalStoreForOwner = async (
  uid: string
): Promise<{ id: string; data: Record<string, unknown> } | null> => {
  const snapshot = await adminDb
    .collection('stores')
    .where('ownerId', '==', uid)
    .get();
  const matches = snapshot.docs
    .map(document => ({
      id: document.id,
      data: document.data() as Record<string, unknown>,
    }))
    .filter(store =>
      store.data.legacyTenantId === uid ||
      (!store.data.legacyTenantId && store.data.ownerId === uid)
    );
  if (matches.length > 1) {
    throw new KyrubActionExecutionError(
      409,
      'STORE_IDENTITY_CONFLICT',
      'Mais de uma loja canônica pertence a este cadastro. Revise a estrutura antes de continuar.'
    );
  }
  return matches[0] ?? null;
};

const deterministicCanonicalStoreId = (uid: string): string =>
  `store-${createHash('sha256').update(`owner:${uid}`).digest('hex').slice(0, 28)}`;

const ensureCanonicalStore = async (
  uid: string,
  name: string,
  plan: KyrubCommercialPlanId
): Promise<{ id: string; name: string }> => {
  const existing = await findCanonicalStoreForOwner(uid);
  if (existing) {
    const reference = adminDb.doc(`stores/${existing.id}`);
    await reference.set({
      name,
      plan,
      legacyTenantId: uid,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { id: existing.id, name };
  }

  const id = deterministicCanonicalStoreId(uid);
  await adminDb.doc(`stores/${id}`).set({
    id,
    ownerId: uid,
    name,
    publicationStatus: 'paused',
    plan,
    legacyTenantId: uid,
    migrationStatus: 'registry_only',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: false });
  return { id, name };
};

const executeUpdateStoreProfile = async (
  actor: { uid: string; email?: string },
  proposal: KyrubAiUpdateStoreProfileProposal,
  envelope: KyrubExecutionEnvelope
): Promise<KyrubActionExecutionResult> => {
  const storeReference = adminDb.doc(privateStorePath(actor.uid));
  const receiptReference = receiptReferenceFor(envelope);
  const patch = proposal.patch;
  let configuredStoreName = '';
  let configuredPlan: KyrubCommercialPlanId = 'free';

  const status = await adminDb.runTransaction(async transaction => {
    const [existingStore, existingReceipt] = await Promise.all([
      transaction.get(storeReference),
      transaction.get(receiptReference),
    ]);

    if (existingReceipt.exists) {
      const data = existingReceipt.data() as Record<string, unknown>;
      if (receiptMatches(data, envelope)) {
        const current = existingStore.data() as Record<string, unknown> | undefined;
        configuredStoreName = cleanText(current?.name, MAX_STORE_NAME_CHARACTERS);
        configuredPlan = normalizeExecutableStorePlan(current?.plan);
        return 'already_applied' as const;
      }
      throw new KyrubActionExecutionError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'Esta atualização da loja já foi usada com outro conteúdo.'
      );
    }

    const current = existingStore.data() as Record<string, unknown> | undefined;
    const currentName = cleanText(current?.name, MAX_STORE_NAME_CHARACTERS);
    if (
      envelope.authorizationMode === 'human_confirmation' &&
      (!existingStore.exists || !currentName)
    ) {
      throw new KyrubActionExecutionError(
        409,
        'STORE_ACTIVATION_REQUIRED',
        'Ative sua loja antes de alterar o perfil pela Kyrubia.'
      );
    }
    const nextName = patch.name ?? currentName;
    configuredStoreName = nextName;
    configuredPlan = normalizeExecutableStorePlan(current?.plan);

    const storeData: Record<string, unknown> = {
      ...(existingStore.exists ? {} : {
        id: actor.uid,
        ownerId: actor.uid,
        ownerEmail: actor.email ?? '',
        plan: 'free',
        slug: '',
        description: '',
        logo: '',
        banner: '',
        primaryColor: '',
        keywords: [],
        offerImages: [],
        address: '',
        contact: '',
        status: 'closed',
        createdAt: FieldValue.serverTimestamp(),
      }),
      ...patch,
      ...(patch.name ? { slug: slugifyStoreName(patch.name) } : {}),
      updatedAt: FieldValue.serverTimestamp(),
      actionOrigin: envelope.origin,
      actionExecutionId: envelope.executionId,
    };

    transaction.set(storeReference, storeData, { merge: true });
    transaction.set(
      receiptReference,
      receiptPayload(envelope, 'store_profile', actor.uid)
    );
    return 'success' as const;
  });

  if (configuredStoreName) {
    await ensureCanonicalStore(actor.uid, configuredStoreName, configuredPlan);
  }

  return {
    actionId: proposal.id,
    type: proposal.type,
    status,
    entityId: actor.uid,
    origin: envelope.origin,
    idempotencyKey: envelope.idempotencyKey,
    executionEnvelope: envelope,
  };
};

const productRecordIsUsable = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const product = value as Record<string, unknown>;
  return Boolean(cleanText(product.id, 180) && cleanText(product.name, MAX_PRODUCT_NAME_CHARACTERS));
};

const buildLegacyProduct = (
  actorUid: string,
  proposal: KyrubAiCreateProductProposal,
  productId: string,
  updatedAt: string,
  envelope: KyrubExecutionEnvelope
): Record<string, unknown> => ({
  id: productId,
  storeId: actorUid,
  supplierId: actorUid,
  name: proposal.name,
  description: proposal.description,
  price: proposal.isComplimentary ? 0 : proposal.price,
  image: proposal.image,
  stock: proposal.isService ? 0 : proposal.stock,
  category: proposal.category,
  isService: proposal.isService,
  isComplimentary: proposal.isComplimentary,
  updatedAt,
  actionOrigin: envelope.origin,
  actionId: proposal.id,
  actionIdempotencyKey: envelope.idempotencyKey,
  actionProposalHash: envelope.proposalHash,
  actionExecutionId: envelope.executionId,
});

const buildCanonicalProduct = (
  legacyProduct: Record<string, unknown>,
  canonicalStoreId: string,
  actorUid: string,
  envelope: KyrubExecutionEnvelope
): Record<string, unknown> => ({
  id: legacyProduct.id,
  storeId: canonicalStoreId,
  supplierId: canonicalStoreId,
  name: legacyProduct.name,
  description: legacyProduct.description,
  price: legacyProduct.price,
  image: legacyProduct.image,
  stock: legacyProduct.stock,
  category: legacyProduct.category,
  isService: legacyProduct.isService,
  isComplimentary: legacyProduct.isComplimentary,
  publicationStatus: 'published',
  createdByUserId: actorUid,
  createdByRole: 'owner',
  updatedByUserId: actorUid,
  updatedByRole: 'owner',
  legacyStoreId: actorUid,
  legacyProductId: legacyProduct.id,
  legacySupplierId: actorUid,
  legacyUpdatedAt: legacyProduct.updatedAt,
  migratedFromPath: `tenants/${actorUid}#publicProducts/${String(legacyProduct.id)}`,
  archivedAt: '',
  migration: {
    mode: 'dual_write',
    migratedByUserId: actorUid,
    migratedByRole: 'owner',
  },
  actionOrigin: envelope.origin,
  actionExecutionId: envelope.executionId,
});

const executeCreateProduct = async (
  actor: { uid: string; email?: string },
  proposal: KyrubAiCreateProductProposal,
  envelope: KyrubExecutionEnvelope
): Promise<KyrubActionExecutionResult> => {
  const storeReference = adminDb.doc(privateStorePath(actor.uid));
  const storeSnapshot = await storeReference.get();
  const storeData = storeSnapshot.data() as Record<string, unknown> | undefined;
  const storeName = cleanText(storeData?.name, MAX_STORE_NAME_CHARACTERS);
  if (!storeSnapshot.exists || !storeName) {
    throw new KyrubActionExecutionError(
      409,
      'STORE_ACTIVATION_REQUIRED',
      'Ative sua loja antes de cadastrar produtos.'
    );
  }
  const plan = normalizeExecutableStorePlan(storeData?.plan);
  const canonicalStore = await ensureCanonicalStore(actor.uid, storeName, plan);
  const productId = deterministicProductId(actor.uid, proposal.id);
  const tenantReference = adminDb.doc(`tenants/${actor.uid}`);
  const canonicalReference = adminDb.doc(
    `stores/${canonicalStore.id}/products/${productId}`
  );
  const receiptReference = receiptReferenceFor(envelope);
  const legacyProduct = buildLegacyProduct(
    actor.uid,
    proposal,
    productId,
    envelope.authorizedAt,
    envelope
  );
  const canonicalProduct = buildCanonicalProduct(
    legacyProduct,
    canonicalStore.id,
    actor.uid,
    envelope
  );

  const status = await adminDb.runTransaction(async transaction => {
    const [tenantSnapshot, canonicalSnapshot, existingReceipt] = await Promise.all([
      transaction.get(tenantReference),
      transaction.get(canonicalReference),
      transaction.get(receiptReference),
    ]);

    if (existingReceipt.exists) {
      const data = existingReceipt.data() as Record<string, unknown>;
      if (receiptMatches(data, envelope)) return 'already_applied' as const;
      throw new KyrubActionExecutionError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'Esta criação de produto já foi utilizada com outro conteúdo.'
      );
    }

    if (canonicalSnapshot.exists) {
      const existing = canonicalSnapshot.data() as Record<string, unknown>;
      if (
        existing.actionExecutionId === envelope.executionId &&
        existing.actionOrigin === envelope.origin
      ) {
        transaction.set(
          receiptReference,
          receiptPayload(envelope, 'product', productId)
        );
        return 'already_applied' as const;
      }
      throw new KyrubActionExecutionError(
        409,
        'PRODUCT_ID_CONFLICT',
        'O identificador deste produto já está em uso. Gere uma nova proposta.'
      );
    }

    const tenantData = tenantSnapshot.data() as Record<string, unknown> | undefined;
    const existingProducts = Array.isArray(tenantData?.publicProducts)
      ? tenantData.publicProducts.filter(productRecordIsUsable)
      : [];
    const alreadyExists = existingProducts.some(product => product.id === productId);
    const catalogLimit = KYRUB_COMMERCIAL_PLANS_V1[plan].activeCatalogLimit;
    if (
      !alreadyExists &&
      catalogLimit !== null &&
      existingProducts.length >= catalogLimit
    ) {
      throw new KyrubActionExecutionError(
        409,
        'PLAN_PRODUCT_LIMIT_REACHED',
        `O plano ${KYRUB_COMMERCIAL_PLANS_V1[plan].name} permite até ${catalogLimit} produtos ou serviços ativos por loja.`
      );
    }

    const nextProducts = [
      legacyProduct,
      ...existingProducts.filter(product => product.id !== productId),
    ].slice(0, MAX_PRODUCTS_PER_TENANT);

    transaction.set(tenantReference, {
      id: actor.uid,
      ownerId: actor.uid,
      email: actor.email ?? '',
      role: 'retailer',
      plan,
      publicationStatus:
        tenantData?.publicationStatus === 'published' ? 'published' : 'paused',
      publicProducts: nextProducts,
      updatedAt: FieldValue.serverTimestamp(),
      ...(tenantSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    }, { merge: true });

    transaction.set(canonicalReference, {
      ...canonicalProduct,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(
      receiptReference,
      receiptPayload(envelope, 'product', productId)
    );
    return 'success' as const;
  });

  return {
    actionId: proposal.id,
    type: proposal.type,
    status,
    entityId: productId,
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
  proposal: KyrubActionProposal,
  actorUid: string
): string => proposal.idempotencyKey?.trim() ||
  `kyrubia:${proposal.type}:${actorUid}:${proposal.id}`;

const permissionsAndAuthorizationFor = async (
  proposal: KyrubActionProposal,
  actorUid: string
): Promise<{
  permissions: string[];
  authorizationMode: KyrubAuthorizationMode;
}> => {
  if (proposal.type === 'update_store_profile') {
    if (proposal.requiresConfirmation === false) {
      if (!proposal.activationGrantId) {
        throw new KyrubActionExecutionError(
          403,
          'AUTHORIZATION_REQUIRED',
          'Confirme a ativação da loja novamente antes desta atualização.'
        );
      }
      await assertActiveStoreActivationGrant(actorUid, proposal.activationGrantId);
      return {
        permissions: ['store.profile.write'],
        authorizationMode: 'preauthorized',
      };
    }
    return {
      permissions: ['store.profile.write'],
      authorizationMode: 'human_confirmation',
    };
  }

  const permission = KYRUB_ACTION_REGISTRY[proposal.type].permission;
  return {
    permissions: permission ? [permission] : [],
    authorizationMode: 'human_confirmation',
  };
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

  const actor = await verifyActionActor(token);
  const body = requestRecord(rawRequest);
  const proposal = normalizeKyrubActionExecutionProposal(body.proposal);
  const confirmed = body.confirmed === true;
  const idempotencyKey = idempotencyKeyFor(proposal, actor.uid);
  const normalizedProposal = {
    ...proposal,
    idempotencyKey,
  } as KyrubActionProposal;
  const authorizationContext = await permissionsAndAuthorizationFor(
    normalizedProposal,
    actor.uid
  );
  const policyDecision = evaluateKyrubActionPolicy(normalizedProposal, {
    actorUid: actor.uid,
    permissions: authorizationContext.permissions,
    confirmed,
  });

  if (policyDecision.outcome !== 'allow') mapPolicyFailure(policyDecision);

  const envelope = buildKyrubExecutionEnvelope(
    normalizedProposal,
    actor.uid,
    idempotencyKey,
    policyDecision,
    new Date(),
    authorizationContext.authorizationMode
  );

  switch (normalizedProposal.type) {
    case 'create_note':
      return executeCreateNote(
        { uid: actor.uid, name: actor.name, email: actor.email },
        normalizedProposal,
        envelope
      );
    case 'start_store_activation':
      return executeStartStoreActivation(
        { uid: actor.uid },
        normalizedProposal,
        envelope
      );
    case 'update_store_profile':
      return executeUpdateStoreProfile(
        { uid: actor.uid, email: actor.email },
        normalizedProposal,
        envelope
      );
    case 'create_product':
      return executeCreateProduct(
        { uid: actor.uid, email: actor.email },
        normalizedProposal,
        envelope
      );
    default:
      throw new KyrubActionExecutionError(
        400,
        'UNSUPPORTED_ACTION',
        'Esta ação ainda não está habilitada para execução pela Kyrubia.'
      );
  }
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
