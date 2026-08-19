import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import type {
  KyrubActionExecutionResult,
  KyrubExecutionEnvelope,
  KyrubInputProvenance,
  KyrubPolicyDecision,
  KyrubAiUpdateProductProposal,
  KyrubProductPatch,
} from '../../shared/kyrubActions.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';
import {
  KyrubActionExecutionError,
} from './actionExecutionService.js';
import { evaluateKyrubActionPolicy } from './kyrubiaPolicyEngine.js';

const MAX_PRODUCT_ID_CHARACTERS = 180;
const MAX_PRODUCT_NAME_CHARACTERS = 160;
const MAX_PRODUCT_CATEGORY_CHARACTERS = 120;
const MAX_PRODUCT_DESCRIPTION_CHARACTERS = 2_000;
const MAX_PRODUCT_IMAGE_CHARACTERS = 2_000;
const EXECUTION_ENVELOPE_TTL_MS = 5 * 60 * 1_000;
const PRODUCT_PATCH_KEYS = new Set(['name', 'description', 'price', 'category', 'image']);

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

const normalizeName = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

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

const normalizeProductId = (value: unknown): string => {
  const productId = cleanText(value, MAX_PRODUCT_ID_CHARACTERS);
  if (!productId || productId.includes('/')) {
    throw new KyrubActionExecutionError(
      400,
      'INVALID_PRODUCT',
      'O produto não possui um identificador válido.'
    );
  }
  return productId;
};

const normalizeProductPatch = (value: unknown): KyrubProductPatch => {
  const candidate = requestRecord(value);
  const keys = Object.keys(candidate);
  if (keys.length === 0 || keys.some(key => !PRODUCT_PATCH_KEYS.has(key))) {
    throw new KyrubActionExecutionError(
      400,
      'INVALID_PRODUCT_PATCH',
      'Informe ao menos um campo editável do produto.'
    );
  }

  const patch: KyrubProductPatch = {};
  if ('name' in candidate) {
    const name = cleanText(candidate.name, MAX_PRODUCT_NAME_CHARACTERS);
    if (!name) {
      throw new KyrubActionExecutionError(400, 'INVALID_PRODUCT_PATCH', 'O nome do produto não pode ficar vazio.');
    }
    patch.name = name;
  }
  if ('description' in candidate) {
    if (typeof candidate.description !== 'string') {
      throw new KyrubActionExecutionError(400, 'INVALID_PRODUCT_PATCH', 'A descrição do produto é inválida.');
    }
    patch.description = cleanText(candidate.description, MAX_PRODUCT_DESCRIPTION_CHARACTERS);
  }
  if ('category' in candidate) {
    const category = cleanText(candidate.category, MAX_PRODUCT_CATEGORY_CHARACTERS);
    if (!category) {
      throw new KyrubActionExecutionError(400, 'INVALID_PRODUCT_PATCH', 'A categoria do produto não pode ficar vazia.');
    }
    patch.category = category;
  }
  if ('image' in candidate) {
    if (typeof candidate.image !== 'string') {
      throw new KyrubActionExecutionError(400, 'INVALID_PRODUCT_PATCH', 'A imagem do produto é inválida.');
    }
    patch.image = cleanText(candidate.image, MAX_PRODUCT_IMAGE_CHARACTERS);
  }
  if ('price' in candidate) {
    if (
      typeof candidate.price !== 'number' ||
      !Number.isFinite(candidate.price) ||
      candidate.price < 0
    ) {
      throw new KyrubActionExecutionError(400, 'INVALID_PRODUCT_PATCH', 'O preço do produto precisa ser zero ou maior.');
    }
    patch.price = candidate.price;
  }
  return patch;
};

const normalizeProposal = (value: unknown): KyrubAiUpdateProductProposal => {
  const candidate = requestRecord(value);
  if (candidate.type !== 'update_product') {
    throw new KyrubActionExecutionError(
      400,
      'UNSUPPORTED_ACTION',
      'Esta ação não é uma atualização de produto suportada.'
    );
  }

  const expectedCurrentName = cleanText(
    candidate.expectedCurrentName,
    MAX_PRODUCT_NAME_CHARACTERS
  );
  if (!expectedCurrentName) {
    throw new KyrubActionExecutionError(
      400,
      'INVALID_PRODUCT',
      'A alteração precisa informar o nome atual esperado do produto.'
    );
  }

  return {
    id: safeActionId(candidate.id),
    type: 'update_product',
    productId: normalizeProductId(candidate.productId),
    expectedCurrentName,
    patch: normalizeProductPatch(candidate.patch),
    requiresConfirmation: true,
    origin: 'kyrubia',
    risk: 'medium',
    inputProvenance: normalizeProvenance(candidate.inputProvenance),
    impact: { entityCount: 1, reversibility: 'limited' },
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
  proposal: KyrubAiUpdateProductProposal,
  actorUid: string
): string => proposal.idempotencyKey?.trim() ||
  `kyrubia:${proposal.type}:${actorUid}:${proposal.id}`;

const canonicalProposalPayload = (
  proposal: KyrubAiUpdateProductProposal,
  idempotencyKey: string
): Record<string, unknown> => ({
  id: proposal.id,
  type: proposal.type,
  productId: proposal.productId,
  expectedCurrentName: proposal.expectedCurrentName,
  patch: proposal.patch,
  requiresConfirmation: true,
  origin: proposal.origin ?? 'kyrubia',
  risk: 'medium',
  inputProvenance: proposal.inputProvenance ?? 'ai_generated_content',
  impact: proposal.impact ?? { entityCount: 1, reversibility: 'limited' },
  idempotencyKey,
});

const proposalHash = (
  proposal: KyrubAiUpdateProductProposal,
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
  proposal: KyrubAiUpdateProductProposal,
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
  data.actionType === envelope.actionType;

const receiptPayload = (
  envelope: KyrubExecutionEnvelope,
  productId: string
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
  targetType: 'product',
  targetId: productId,
  result: 'success',
  createdAt: FieldValue.serverTimestamp(),
});

const normalizeExecutableStorePlan = (value: unknown): 'free' | 'pro' | 'business' =>
  value === 'pro' || value === 'business' ? value : 'free';

const deterministicCanonicalStoreId = (uid: string): string =>
  `store-${createHash('sha256').update(`owner:${uid}`).digest('hex').slice(0, 28)}`;

const findCanonicalStoreForOwner = async (
  uid: string
): Promise<{ id: string; data: Record<string, unknown> } | null> => {
  const snapshot = await adminDb.collection('stores').where('ownerId', '==', uid).get();
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

const ensureCanonicalStore = async (
  uid: string
): Promise<{ id: string; name: string }> => {
  const existing = await findCanonicalStoreForOwner(uid);
  if (existing) {
    return {
      id: existing.id,
      name: cleanText(existing.data.name, 120),
    };
  }

  const privateStore = await adminDb.doc(`users/${uid}/stores/${uid}`).get();
  const privateData = privateStore.data() as Record<string, unknown> | undefined;
  const name = cleanText(privateData?.name, 120);
  if (!privateStore.exists || !name) {
    throw new KyrubActionExecutionError(
      409,
      'STORE_ACTIVATION_REQUIRED',
      'Ative sua loja antes de alterar produtos.'
    );
  }

  const id = deterministicCanonicalStoreId(uid);
  await adminDb.doc(`stores/${id}`).set({
    id,
    ownerId: uid,
    name,
    publicationStatus: 'paused',
    plan: normalizeExecutableStorePlan(privateData?.plan),
    legacyTenantId: uid,
    migrationStatus: 'registry_only',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: false });
  return { id, name };
};

const recordValue = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const applyProductPatch = (
  current: Record<string, unknown>,
  patch: KyrubProductPatch
): Record<string, unknown> => ({
  ...current,
  ...('name' in patch ? { name: patch.name } : {}),
  ...('description' in patch ? { description: patch.description } : {}),
  ...('price' in patch ? { price: patch.price } : {}),
  ...('category' in patch ? { category: patch.category } : {}),
  ...('image' in patch ? { image: patch.image } : {}),
});

const executeProductUpdate = async (
  actor: { uid: string },
  proposal: KyrubAiUpdateProductProposal,
  envelope: KyrubExecutionEnvelope
): Promise<KyrubActionExecutionResult> => {
  const canonicalStore = await ensureCanonicalStore(actor.uid);
  const tenantReference = adminDb.doc(`tenants/${actor.uid}`);
  const canonicalReference = adminDb.doc(
    `stores/${canonicalStore.id}/products/${proposal.productId}`
  );
  const receiptReference = receiptReferenceFor(envelope);

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
        'Esta alteração de produto já foi utilizada com outro conteúdo.'
      );
    }

    if (!tenantSnapshot.exists) {
      throw new KyrubActionExecutionError(
        404,
        'PRODUCT_NOT_FOUND',
        'O catálogo da sua loja não foi encontrado.'
      );
    }

    const tenantData = tenantSnapshot.data() as Record<string, unknown>;
    const rawProducts = Array.isArray(tenantData.publicProducts)
      ? tenantData.publicProducts
      : [];
    const index = rawProducts.findIndex(item =>
      recordValue(item)?.id === proposal.productId
    );
    if (index < 0) {
      throw new KyrubActionExecutionError(
        404,
        'PRODUCT_NOT_FOUND',
        'Esse produto publicado não foi encontrado na sua loja. Atualize a conversa e tente novamente.'
      );
    }

    const currentProduct = recordValue(rawProducts[index]);
    if (!currentProduct) {
      throw new KyrubActionExecutionError(
        409,
        'PRODUCT_INVALID',
        'O registro atual do produto não é válido para atualização.'
      );
    }
    if (
      currentProduct.storeId !== actor.uid ||
      currentProduct.supplierId !== actor.uid
    ) {
      throw new KyrubActionExecutionError(
        403,
        'PRODUCT_OWNERSHIP_REQUIRED',
        'Este produto não pertence à loja autenticada.'
      );
    }

    const currentName = cleanText(
      currentProduct.name,
      MAX_PRODUCT_NAME_CHARACTERS
    );
    if (
      !currentName ||
      normalizeName(currentName) !== normalizeName(proposal.expectedCurrentName)
    ) {
      throw new KyrubActionExecutionError(
        409,
        'PRODUCT_CHANGED',
        'O produto mudou desde a leitura usada pela Kyrubia. Revise o estado atual antes de confirmar novamente.'
      );
    }

    const updatedLegacy: Record<string, unknown> = {
      ...applyProductPatch(currentProduct, proposal.patch),
      updatedAt: envelope.authorizedAt,
      actionOrigin: envelope.origin,
      actionType: proposal.type,
      actionId: proposal.id,
      actionIdempotencyKey: envelope.idempotencyKey,
      actionProposalHash: envelope.proposalHash,
      actionExecutionId: envelope.executionId,
    };
    const nextProducts = rawProducts.map((item, itemIndex) =>
      itemIndex === index ? updatedLegacy : item
    );

    transaction.set(tenantReference, {
      publicProducts: nextProducts,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const canonicalSeed: Record<string, unknown> = canonicalSnapshot.exists
      ? {}
      : {
          ...updatedLegacy,
          id: proposal.productId,
          storeId: canonicalStore.id,
          supplierId: canonicalStore.id,
          publicationStatus: 'published',
          createdByUserId: actor.uid,
          createdByRole: 'owner',
          legacyStoreId: actor.uid,
          legacyProductId: proposal.productId,
          legacySupplierId: actor.uid,
          archivedAt: '',
          migration: {
            mode: 'dual_write',
            migratedByUserId: actor.uid,
            migratedByRole: 'owner',
          },
          createdAt: FieldValue.serverTimestamp(),
        };

    transaction.set(canonicalReference, {
      ...canonicalSeed,
      ...proposal.patch,
      updatedByUserId: actor.uid,
      updatedByRole: 'owner',
      legacyUpdatedAt: envelope.authorizedAt,
      actionOrigin: envelope.origin,
      actionExecutionId: envelope.executionId,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(
      receiptReference,
      receiptPayload(envelope, proposal.productId)
    );
    return 'success' as const;
  });

  return {
    actionId: proposal.id,
    type: proposal.type,
    status,
    entityId: proposal.productId,
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
      'Revise e confirme esta alteração antes da execução.'
    );
  }
  throw new KyrubActionExecutionError(
    403,
    'POLICY_DENIED',
    'A política de segurança do Kyrub bloqueou esta execução.'
  );
};

export const isKyrubProductUpdateExecutionRequest = (
  rawRequest: unknown
): boolean => {
  if (!rawRequest || typeof rawRequest !== 'object' || Array.isArray(rawRequest)) {
    return false;
  }
  const proposal = (rawRequest as Record<string, unknown>).proposal;
  return Boolean(
    proposal &&
    typeof proposal === 'object' &&
    !Array.isArray(proposal) &&
    (proposal as Record<string, unknown>).type === 'update_product'
  );
};

export const executeAuthorizedKyrubProductUpdate = async (
  authorization: string,
  rawRequest: unknown
): Promise<KyrubActionExecutionResult> => {
  const token = bearerToken(authorization);
  if (!token) {
    throw new KyrubActionExecutionError(
      401,
      'AUTH_REQUIRED',
      'Faça login novamente antes de confirmar a alteração.'
    );
  }

  const actor = await verifyActionActor(token);
  const body = requestRecord(rawRequest);
  const proposal = normalizeProposal(body.proposal);
  const confirmed = body.confirmed === true;
  const idempotencyKey = idempotencyKeyFor(proposal, actor.uid);
  const normalizedProposal: KyrubAiUpdateProductProposal = {
    ...proposal,
    idempotencyKey,
  };
  const policyDecision = evaluateKyrubActionPolicy(normalizedProposal, {
    actorUid: actor.uid,
    permissions: ['products.write'],
    confirmed,
  });
  if (policyDecision.outcome !== 'allow') mapPolicyFailure(policyDecision);

  const envelope = buildEnvelope(
    normalizedProposal,
    actor.uid,
    idempotencyKey,
    policyDecision
  );
  return executeProductUpdate(
    { uid: actor.uid },
    normalizedProposal,
    envelope
  );
};