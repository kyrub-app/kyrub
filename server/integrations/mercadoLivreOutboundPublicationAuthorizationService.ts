import { createHash, randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { assertMercadoLivrePublicationCapabilityUnchanged } from './mercadoLivrePublicationCapabilityGuard.js';

interface ProposalRecord {
  id: string;
  storeId: string;
  canonicalStoreId: string;
  provider: 'mercado_livre';
  connectionId: string;
  canonicalProductId: string;
  status: 'review_required';
  authority: 'canonical_kyrub_snapshot';
  action: 'create_external_listing';
  canonicalBaselineHash: string;
  providerCapabilityFingerprint: string;
  providerPublicationModel: 'legacy_items';
  providerStockAuthority: 'item_available_quantity';
  canonical: {
    name: string;
    price: number;
    stock: number;
    category: string;
    image: string;
    publicationStatus: string;
  };
  publicationReadiness: 'ready_for_owner_authorization';
  publicationReadinessAuthority: 'provider_items_validate';
  publicationValidatedAt: string;
  executionStatus: 'not_authorized' | 'authorized';
}

interface ListingValidationRecord {
  proposalId: string;
  status: 'ready_for_owner_authorization';
  providerStatus: 204;
  authority: 'provider_items_validate';
  validatedAt: string;
  executionStatus: 'not_authorized';
  canonicalBaselineHash: string;
  providerCapabilityFingerprint: string;
  providerPublicationModel: 'legacy_items';
  providerStockAuthority: 'item_available_quantity';
  providerPayload: Record<string, unknown>;
}

const clean = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const finiteNonNegative = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const integerNonNegative = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const stablePayloadHash = (payload: Record<string, unknown>): string => sha256(JSON.stringify(payload));

const assertProposal = (storeId: string, proposalId: string, value: unknown): ProposalRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_NOT_FOUND');
  const record = value as Record<string, unknown>;
  const canonical = record.canonical && typeof record.canonical === 'object' && !Array.isArray(record.canonical)
    ? record.canonical as Record<string, unknown>
    : null;
  if (
    clean(record.id, 160) !== proposalId || clean(record.storeId, 160) !== storeId ||
    record.provider !== 'mercado_livre' || record.status !== 'review_required' ||
    record.authority !== 'canonical_kyrub_snapshot' || record.action !== 'create_external_listing' ||
    !clean(record.canonicalStoreId, 160) || !clean(record.connectionId, 200) ||
    !clean(record.canonicalProductId, 160) || !clean(record.canonicalBaselineHash, 80) ||
    !clean(record.providerCapabilityFingerprint, 80) ||
    record.providerPublicationModel !== 'legacy_items' || record.providerStockAuthority !== 'item_available_quantity' ||
    !canonical || !clean(canonical.name, 120) ||
    record.publicationReadiness !== 'ready_for_owner_authorization' ||
    record.publicationReadinessAuthority !== 'provider_items_validate' ||
    !clean(record.publicationValidatedAt, 80) ||
    (record.executionStatus !== 'not_authorized' && record.executionStatus !== 'authorized')
  ) throw new Error('MERCADO_LIVRE_OUTBOUND_AUTHORIZATION_NOT_READY');
  return record as unknown as ProposalRecord;
};

const assertValidation = (proposal: ProposalRecord, value: unknown): ListingValidationRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_OUTBOUND_LISTING_VALIDATION_REQUIRED');
  const record = value as Record<string, unknown>;
  if (
    clean(record.proposalId, 160) !== proposal.id ||
    record.status !== 'ready_for_owner_authorization' || record.providerStatus !== 204 ||
    record.authority !== 'provider_items_validate' || record.executionStatus !== 'not_authorized' ||
    clean(record.validatedAt, 80) !== proposal.publicationValidatedAt ||
    clean(record.canonicalBaselineHash, 80) !== proposal.canonicalBaselineHash ||
    clean(record.providerCapabilityFingerprint, 80) !== proposal.providerCapabilityFingerprint ||
    record.providerPublicationModel !== proposal.providerPublicationModel ||
    record.providerStockAuthority !== proposal.providerStockAuthority ||
    !record.providerPayload || typeof record.providerPayload !== 'object' || Array.isArray(record.providerPayload)
  ) throw new Error('MERCADO_LIVRE_OUTBOUND_LISTING_VALIDATION_REQUIRED');
  return record as unknown as ListingValidationRecord;
};

const canonicalMatchesProposal = (proposal: ProposalRecord, value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return clean(record.id, 160) === proposal.canonicalProductId &&
    clean(record.storeId, 160) === proposal.canonicalStoreId &&
    clean(record.name, 120) === proposal.canonical.name &&
    finiteNonNegative(record.price) === proposal.canonical.price &&
    integerNonNegative(record.stock) === proposal.canonical.stock &&
    clean(record.category, 160) === proposal.canonical.category &&
    clean(record.image, 2_000) === proposal.canonical.image &&
    clean(record.publicationStatus, 80) === proposal.canonical.publicationStatus &&
    record.isService === false;
};

export interface MercadoLivrePublicationAuthorizationResult {
  proposalId: string;
  authorizationId: string;
  authorizationToken: string;
  status: 'authorized';
  executionStatus: 'authorized';
  payloadHash: string;
  expiresAtMillis: number;
  authority: 'store_owner_publication_authorization';
}

export const authorizeMercadoLivreOutboundPublication = async (input: {
  storeId: string;
  proposalId: string;
  authorizedByUserId: string;
}): Promise<MercadoLivrePublicationAuthorizationResult> => {
  const storeId = input.storeId.trim();
  const proposalId = input.proposalId.trim();
  const authorizedByUserId = input.authorizedByUserId.trim();
  if (!storeId || !proposalId || authorizedByUserId !== storeId) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_AUTHORIZATION_TARGET_INVALID');
  }

  const proposalRef = adminDb.doc(`stores/${storeId}/catalogOutboundPublicationProposals/${proposalId}`);
  const validationRef = adminDb.doc(`stores/${storeId}/catalogOutboundListingValidations/${proposalId}`);
  const [proposalDoc, validationDoc] = await Promise.all([proposalRef.get(), validationRef.get()]);
  if (!proposalDoc.exists) throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_NOT_FOUND');
  const proposal = assertProposal(storeId, proposalId, proposalDoc.data());
  const validation = assertValidation(proposal, validationDoc.data());
  if (proposal.executionStatus !== 'not_authorized') throw new Error('MERCADO_LIVRE_OUTBOUND_ALREADY_AUTHORIZED');

  await assertMercadoLivrePublicationCapabilityUnchanged({
    storeId,
    connectionId: proposal.connectionId,
    expectedFingerprint: proposal.providerCapabilityFingerprint,
    requestedByUserId: authorizedByUserId,
  });

  const canonicalRef = adminDb.doc(`stores/${proposal.canonicalStoreId}/products/${proposal.canonicalProductId}`);
  const canonicalDoc = await canonicalRef.get();
  if (!canonicalDoc.exists || !canonicalMatchesProposal(proposal, canonicalDoc.data())) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_STALE');
  }

  const authorizationToken = randomBytes(32).toString('base64url');
  const authorizationId = `mlpub_${sha256(`${storeId}:${proposalId}:${authorizationToken}`).slice(0, 32)}`;
  const tokenHash = sha256(authorizationToken);
  const payloadHash = stablePayloadHash(validation.providerPayload);
  const authorizedAt = new Date().toISOString();
  const expiresAtMillis = Date.now() + 15 * 60 * 1000;
  const authorizationRef = adminDb.doc(`stores/${storeId}/catalogOutboundPublicationAuthorizations/${authorizationId}`);

  await adminDb.runTransaction(async transaction => {
    const [currentProposalDoc, currentValidationDoc, currentCanonicalDoc, existingAuthorizationDoc] = await Promise.all([
      transaction.get(proposalRef), transaction.get(validationRef), transaction.get(canonicalRef), transaction.get(authorizationRef),
    ]);
    if (!currentProposalDoc.exists) throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_NOT_FOUND');
    const currentProposal = assertProposal(storeId, proposalId, currentProposalDoc.data());
    const currentValidation = assertValidation(currentProposal, currentValidationDoc.data());
    if (
      currentProposal.executionStatus !== 'not_authorized' ||
      currentProposal.providerCapabilityFingerprint !== proposal.providerCapabilityFingerprint ||
      currentValidation.providerCapabilityFingerprint !== proposal.providerCapabilityFingerprint ||
      currentValidation.validatedAt !== validation.validatedAt ||
      stablePayloadHash(currentValidation.providerPayload) !== payloadHash ||
      !currentCanonicalDoc.exists || !canonicalMatchesProposal(currentProposal, currentCanonicalDoc.data()) ||
      existingAuthorizationDoc.exists
    ) throw new Error('MERCADO_LIVRE_OUTBOUND_AUTHORIZATION_CONFLICT');

    transaction.create(authorizationRef, {
      schemaVersion: 2,
      id: authorizationId,
      proposalId,
      storeId,
      provider: 'mercado_livre',
      connectionId: proposal.connectionId,
      canonicalStoreId: proposal.canonicalStoreId,
      canonicalProductId: proposal.canonicalProductId,
      canonicalBaselineHash: proposal.canonicalBaselineHash,
      providerCapabilityFingerprint: proposal.providerCapabilityFingerprint,
      providerPublicationModel: proposal.providerPublicationModel,
      providerStockAuthority: proposal.providerStockAuthority,
      listingValidatedAt: validation.validatedAt,
      payload: validation.providerPayload,
      payloadHash,
      tokenHash,
      status: 'authorized',
      consumptionStatus: 'available',
      useCount: 0,
      expiresAtMillis,
      authority: 'store_owner_publication_authorization',
      authorizedByUserId,
      authorizedAt,
      serverAuthorizedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(proposalRef, {
      executionStatus: 'authorized',
      publicationAuthorizationId: authorizationId,
      publicationAuthorizationAuthority: 'store_owner_publication_authorization',
      publicationAuthorizedByUserId: authorizedByUserId,
      publicationAuthorizedAt: authorizedAt,
      serverPublicationAuthorizedAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    proposalId,
    authorizationId,
    authorizationToken,
    status: 'authorized',
    executionStatus: 'authorized',
    payloadHash,
    expiresAtMillis,
    authority: 'store_owner_publication_authorization',
  };
};
