import { createHash, randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { mercadoLivreGetJson } from './mercadoLivreOauthService.js';
import { getStoreConnectionRegistryRecord } from './storeConnectionRegistry.js';

type UpdatableField = 'name' | 'price';

interface ProposalRecord {
  id: string;
  storeId: string;
  provider: 'mercado_livre';
  connectionId: string;
  bindingId: string;
  externalItemId: string;
  canonicalStoreId: string;
  canonicalProductId: string;
  authority: 'canonical_kyrub_and_provider_api_refetch';
  status: 'review_required';
  executionStatus: 'not_authorized' | 'authorized';
  canonicalBaselineHash: string;
  providerObservedHash: string;
  currentCanonical: { name: string; price: number; stock: number; category: string; image: string };
  proposedChanges: Partial<Record<UpdatableField, string | number>>;
  changedFields: UpdatableField[];
}

interface BindingRecord {
  id: string;
  storeId: string;
  provider: 'mercado_livre';
  connectionId: string;
  externalItemId: string;
  canonicalStoreId: string;
  canonicalProductId: string;
  status: 'active';
  canonicalBaselineHash: string;
}

const clean = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const finiteNonNegative = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const integerNonNegative = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const canonicalHash = (state: ProposalRecord['currentCanonical']): string =>
  sha256(JSON.stringify({ ...state, isService: false }));
const stablePayloadHash = (payload: Record<string, unknown>): string => sha256(JSON.stringify(payload));
const providerHash = (state: { name: string; price: number; availableQuantity: number | null; categoryId: string; status: string }): string =>
  sha256(JSON.stringify(state));

const assertProposal = (storeId: string, proposalId: string, value: unknown): ProposalRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_PROPOSAL_NOT_FOUND');
  const record = value as Record<string, unknown>;
  if (
    clean(record.id, 160) !== proposalId || clean(record.storeId, 160) !== storeId ||
    record.provider !== 'mercado_livre' || record.authority !== 'canonical_kyrub_and_provider_api_refetch' ||
    record.status !== 'review_required' || (record.executionStatus !== 'not_authorized' && record.executionStatus !== 'authorized') ||
    !clean(record.connectionId, 200) || !clean(record.bindingId, 160) || !clean(record.externalItemId, 160) ||
    !clean(record.canonicalStoreId, 160) || !clean(record.canonicalProductId, 160) ||
    !clean(record.canonicalBaselineHash, 80) || !clean(record.providerObservedHash, 80) ||
    !record.currentCanonical || typeof record.currentCanonical !== 'object' || Array.isArray(record.currentCanonical) ||
    !record.proposedChanges || typeof record.proposedChanges !== 'object' || Array.isArray(record.proposedChanges) ||
    !Array.isArray(record.changedFields) || record.changedFields.length === 0 ||
    record.changedFields.some(field => field !== 'name' && field !== 'price')
  ) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_AUTHORIZATION_NOT_READY');
  return record as unknown as ProposalRecord;
};

const assertBinding = (proposal: ProposalRecord, value: unknown): BindingRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_NOT_FOUND');
  const record = value as Record<string, unknown>;
  if (
    clean(record.id, 160) !== proposal.bindingId || clean(record.storeId, 160) !== proposal.storeId ||
    record.provider !== 'mercado_livre' || record.status !== 'active' ||
    clean(record.connectionId, 200) !== proposal.connectionId || clean(record.externalItemId, 160) !== proposal.externalItemId ||
    clean(record.canonicalStoreId, 160) !== proposal.canonicalStoreId || clean(record.canonicalProductId, 160) !== proposal.canonicalProductId ||
    clean(record.canonicalBaselineHash, 80) !== proposal.canonicalBaselineHash
  ) throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_CONFLICT');
  return record as unknown as BindingRecord;
};

const canonicalMatchesProposal = (proposal: ProposalRecord, value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const state = {
    name: clean(record.name, 120),
    price: finiteNonNegative(record.price),
    stock: integerNonNegative(record.stock),
    category: clean(record.category, 160),
    image: clean(record.image, 2_000),
  };
  if (!state.name || state.price === null || state.stock === null || !state.category || record.isService !== false) return false;
  return clean(record.id, 160) === proposal.canonicalProductId &&
    clean(record.storeId, 160) === proposal.canonicalStoreId &&
    canonicalHash(state as ProposalRecord['currentCanonical']) === proposal.canonicalBaselineHash;
};

const observedProviderHash = (proposal: ProposalRecord, externalAccountId: string, value: unknown): string => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_ITEM_RESPONSE_INVALID');
  const item = value as Record<string, unknown>;
  const id = clean(item.id, 160);
  const sellerId = clean(item.seller_id, 160);
  const name = clean(item.title, 120);
  const price = finiteNonNegative(item.price);
  if (id !== proposal.externalItemId || sellerId !== externalAccountId || !name || price === null) {
    throw new Error('MERCADO_LIVRE_BOUND_LISTING_IDENTITY_MISMATCH');
  }
  return providerHash({
    name,
    price,
    availableQuantity: finiteNonNegative(item.available_quantity),
    categoryId: clean(item.category_id, 160),
    status: clean(item.status, 80),
  });
};

const updatePayload = (proposal: ProposalRecord): Record<string, unknown> => {
  const payload: Record<string, unknown> = {};
  if (proposal.changedFields.includes('name')) {
    const name = clean(proposal.proposedChanges.name, 120);
    if (!name) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_AUTHORIZATION_NOT_READY');
    payload.title = name;
  }
  if (proposal.changedFields.includes('price')) {
    const price = finiteNonNegative(proposal.proposedChanges.price);
    if (price === null) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_AUTHORIZATION_NOT_READY');
    payload.price = price;
  }
  if (!Object.keys(payload).length) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_AUTHORIZATION_NOT_READY');
  return payload;
};

export interface MercadoLivreBoundListingUpdateAuthorizationResult {
  proposalId: string;
  authorizationId: string;
  authorizationToken: string;
  externalItemId: string;
  status: 'authorized';
  executionStatus: 'authorized';
  payloadHash: string;
  expiresAtMillis: number;
  authority: 'store_owner_bound_listing_update_authorization';
}

export const authorizeMercadoLivreBoundListingUpdate = async (input: {
  storeId: string;
  proposalId: string;
  authorizedByUserId: string;
}): Promise<MercadoLivreBoundListingUpdateAuthorizationResult> => {
  const storeId = input.storeId.trim();
  const proposalId = input.proposalId.trim();
  const authorizedByUserId = input.authorizedByUserId.trim();
  if (!storeId || !proposalId || authorizedByUserId !== storeId) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_AUTHORIZATION_TARGET_INVALID');

  const proposalRef = adminDb.doc(`stores/${storeId}/catalogOutboundUpdateProposals/${proposalId}`);
  const proposalDoc = await proposalRef.get();
  if (!proposalDoc.exists) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_PROPOSAL_NOT_FOUND');
  const proposal = assertProposal(storeId, proposalId, proposalDoc.data());
  if (proposal.executionStatus !== 'not_authorized') throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_ALREADY_AUTHORIZED');

  const bindingRef = adminDb.doc(`stores/${storeId}/externalCatalogBindings/${proposal.bindingId}`);
  const canonicalRef = adminDb.doc(`stores/${proposal.canonicalStoreId}/products/${proposal.canonicalProductId}`);
  const [bindingDoc, canonicalDoc] = await Promise.all([bindingRef.get(), canonicalRef.get()]);
  assertBinding(proposal, bindingDoc.data());
  if (!canonicalDoc.exists || !canonicalMatchesProposal(proposal, canonicalDoc.data())) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_PROPOSAL_STALE');

  const connection = await getStoreConnectionRegistryRecord({ storeId, connectionId: proposal.connectionId });
  if (!connection || connection.provider !== 'mercado_livre' || connection.status !== 'connected' || connection.syncAuthority !== 'manual_review') {
    throw new Error('MERCADO_LIVRE_CONNECTION_INVALID');
  }
  const providerRaw = await mercadoLivreGetJson<unknown>(storeId, `/items/${encodeURIComponent(proposal.externalItemId)}`);
  const currentProviderHash = observedProviderHash(proposal, connection.externalAccountId, providerRaw);
  if (currentProviderHash !== proposal.providerObservedHash) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_PROVIDER_STALE');

  const payload = updatePayload(proposal);
  const payloadHash = stablePayloadHash(payload);
  const authorizationToken = randomBytes(32).toString('base64url');
  const authorizationId = `mlupdauth_${sha256(`${storeId}:${proposalId}:${authorizationToken}`).slice(0, 32)}`;
  const tokenHash = sha256(authorizationToken);
  const authorizedAt = new Date().toISOString();
  const expiresAtMillis = Date.now() + 15 * 60 * 1000;
  const authorizationRef = adminDb.doc(`stores/${storeId}/catalogOutboundUpdateAuthorizations/${authorizationId}`);

  await adminDb.runTransaction(async transaction => {
    const [currentProposalDoc, currentBindingDoc, currentCanonicalDoc, existingAuthorizationDoc] = await Promise.all([
      transaction.get(proposalRef), transaction.get(bindingRef), transaction.get(canonicalRef), transaction.get(authorizationRef),
    ]);
    if (!currentProposalDoc.exists) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_PROPOSAL_NOT_FOUND');
    const currentProposal = assertProposal(storeId, proposalId, currentProposalDoc.data());
    assertBinding(currentProposal, currentBindingDoc.data());
    if (
      currentProposal.executionStatus !== 'not_authorized' ||
      currentProposal.providerObservedHash !== currentProviderHash ||
      currentProposal.canonicalBaselineHash !== proposal.canonicalBaselineHash ||
      stablePayloadHash(updatePayload(currentProposal)) !== payloadHash ||
      !currentCanonicalDoc.exists || !canonicalMatchesProposal(currentProposal, currentCanonicalDoc.data()) ||
      existingAuthorizationDoc.exists
    ) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_AUTHORIZATION_CONFLICT');

    transaction.create(authorizationRef, {
      schemaVersion: 1,
      id: authorizationId,
      proposalId,
      storeId,
      provider: 'mercado_livre',
      connectionId: proposal.connectionId,
      bindingId: proposal.bindingId,
      externalItemId: proposal.externalItemId,
      canonicalStoreId: proposal.canonicalStoreId,
      canonicalProductId: proposal.canonicalProductId,
      canonicalBaselineHash: proposal.canonicalBaselineHash,
      providerObservedHash: proposal.providerObservedHash,
      payload,
      payloadHash,
      tokenHash,
      status: 'authorized',
      consumptionStatus: 'available',
      useCount: 0,
      expiresAtMillis,
      authority: 'store_owner_bound_listing_update_authorization',
      authorizedByUserId,
      authorizedAt,
      serverAuthorizedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(proposalRef, {
      executionStatus: 'authorized',
      updateAuthorizationId: authorizationId,
      updateAuthorizationAuthority: 'store_owner_bound_listing_update_authorization',
      updateAuthorizedByUserId: authorizedByUserId,
      updateAuthorizedAt: authorizedAt,
      serverUpdateAuthorizedAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    proposalId,
    authorizationId,
    authorizationToken,
    externalItemId: proposal.externalItemId,
    status: 'authorized',
    executionStatus: 'authorized',
    payloadHash,
    expiresAtMillis,
    authority: 'store_owner_bound_listing_update_authorization',
  };
};
