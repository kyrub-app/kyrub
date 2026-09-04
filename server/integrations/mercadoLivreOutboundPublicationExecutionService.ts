import { createHash, timingSafeEqual } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { mercadoLivrePostJson } from './mercadoLivreOauthService.js';
import {
  assertCurrentMercadoLivrePublicationCapability,
  assertMercadoLivrePublicationCapabilitySnapshot,
} from './mercadoLivrePublicationCapabilitySnapshotGuard.js';

interface AuthorizationRecord {
  schemaVersion: 2;
  id: string;
  proposalId: string;
  storeId: string;
  provider: 'mercado_livre';
  connectionId: string;
  canonicalStoreId: string;
  canonicalProductId: string;
  canonicalBaselineHash: string;
  providerCapabilityFingerprint: string;
  providerPublicationModel: 'legacy_items';
  providerStockAuthority: 'item_available_quantity';
  providerCapability: unknown;
  listingValidatedAt: string;
  payload: Record<string, unknown>;
  payloadHash: string;
  tokenHash: string;
  status: 'authorized';
  consumptionStatus: 'available' | 'executing' | 'consumed' | 'reconciliation_required' | 'rejected';
  useCount: number;
  expiresAtMillis: number;
  authority: 'store_owner_publication_authorization';
}

interface ProposalRecord {
  schemaVersion: 2;
  id: string;
  storeId: string;
  canonicalStoreId: string;
  connectionId: string;
  canonicalProductId: string;
  canonicalBaselineHash: string;
  providerCapabilityFingerprint: string;
  providerPublicationModel: 'legacy_items';
  providerStockAuthority: 'item_available_quantity';
  providerCapability: unknown;
  executionStatus: 'authorized' | 'executing' | 'published' | 'reconciliation_required' | 'provider_rejected';
  publicationAuthorizationId: string;
}

interface MercadoLivreCreatedItem {
  id?: unknown;
  status?: unknown;
  permalink?: unknown;
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
const payloadHash = (value: Record<string, unknown>): string => sha256(JSON.stringify(value));

const canonicalHash = (value: unknown): string | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const name = clean(record.name, 120);
  const price = finiteNonNegative(record.price);
  const stock = integerNonNegative(record.stock);
  const publicationStatus = clean(record.publicationStatus, 80);
  if (!name || price === null || stock === null || record.isService !== false || !publicationStatus) return null;
  return sha256(JSON.stringify({
    name,
    price,
    stock,
    category: clean(record.category, 160),
    image: clean(record.image, 2_000),
    isService: false,
    publicationStatus,
  }));
};

const safeHashEquals = (expectedHex: string, actualHex: string): boolean => {
  if (!/^[a-f0-9]{64}$/i.test(expectedHex) || !/^[a-f0-9]{64}$/i.test(actualHex)) return false;
  return timingSafeEqual(Buffer.from(expectedHex, 'hex'), Buffer.from(actualHex, 'hex'));
};

const assertCapabilityBinding = (record: Record<string, unknown>, errorCode: string): void => {
  const snapshot = assertMercadoLivrePublicationCapabilitySnapshot(record.providerCapability);
  if (
    clean(record.providerCapabilityFingerprint, 80) !== snapshot.fingerprint ||
    record.providerPublicationModel !== 'legacy_items' ||
    record.providerPublicationModel !== snapshot.publicationModel ||
    record.providerStockAuthority !== 'item_available_quantity' ||
    record.providerStockAuthority !== snapshot.stockAuthority
  ) throw new Error(errorCode);
};

const assertAuthorization = (storeId: string, authorizationId: string, value: unknown): AuthorizationRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_PUBLICATION_AUTHORIZATION_NOT_FOUND');
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 2 ||
    clean(record.id, 160) !== authorizationId || clean(record.storeId, 160) !== storeId ||
    record.provider !== 'mercado_livre' || record.status !== 'authorized' ||
    record.authority !== 'store_owner_publication_authorization' || !clean(record.proposalId, 160) ||
    !clean(record.connectionId, 200) || !clean(record.canonicalStoreId, 160) ||
    !clean(record.canonicalProductId, 160) || !clean(record.canonicalBaselineHash, 80) ||
    !clean(record.providerCapabilityFingerprint, 80) || !record.providerCapability ||
    !clean(record.listingValidatedAt, 80) || !record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload) ||
    !clean(record.payloadHash, 80) || !clean(record.tokenHash, 80) || !Number.isFinite(Number(record.expiresAtMillis))
  ) throw new Error('MERCADO_LIVRE_PUBLICATION_AUTHORIZATION_INVALID');
  assertCapabilityBinding(record, 'MERCADO_LIVRE_PUBLICATION_AUTHORIZATION_INVALID');
  return record as unknown as AuthorizationRecord;
};

const assertProposal = (authorization: AuthorizationRecord, value: unknown): ProposalRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_NOT_FOUND');
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 2 ||
    clean(record.id, 160) !== authorization.proposalId || clean(record.storeId, 160) !== authorization.storeId ||
    clean(record.canonicalStoreId, 160) !== authorization.canonicalStoreId ||
    clean(record.connectionId, 200) !== authorization.connectionId ||
    clean(record.canonicalProductId, 160) !== authorization.canonicalProductId ||
    clean(record.canonicalBaselineHash, 80) !== authorization.canonicalBaselineHash ||
    clean(record.providerCapabilityFingerprint, 80) !== authorization.providerCapabilityFingerprint ||
    record.providerPublicationModel !== authorization.providerPublicationModel ||
    record.providerStockAuthority !== authorization.providerStockAuthority ||
    !record.providerCapability ||
    clean(record.publicationAuthorizationId, 160) !== authorization.id
  ) throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_STALE');
  assertCapabilityBinding(record, 'MERCADO_LIVRE_OUTBOUND_PROPOSAL_STALE');
  return record as unknown as ProposalRecord;
};

const deterministicBindingId = (authorization: AuthorizationRecord, externalItemId: string): string =>
  `mlbind_${sha256([
    authorization.storeId,
    'mercado_livre',
    authorization.connectionId,
    externalItemId,
  ].join(':')).slice(0, 32)}`;

const isDefiniteProviderRejection = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  const match = /MERCADO_LIVRE_API_FAILED:HTTP_(\d{3})/.exec(message);
  if (!match) return false;
  const status = Number(match[1]);
  return status >= 400 && status < 500;
};

export interface MercadoLivrePublicationExecutionResult {
  proposalId: string;
  authorizationId: string;
  executionId: string;
  status: 'published';
  externalItemId: string;
  bindingId: string;
  providerStatus: string;
  permalink?: string;
}

export const executeAuthorizedMercadoLivrePublication = async (input: {
  storeId: string;
  authorizationId: string;
  authorizationToken: string;
  executedByUserId: string;
}): Promise<MercadoLivrePublicationExecutionResult> => {
  const storeId = input.storeId.trim();
  const authorizationId = input.authorizationId.trim();
  const authorizationToken = input.authorizationToken.trim();
  const executedByUserId = input.executedByUserId.trim();
  if (!storeId || !authorizationId || !authorizationToken || executedByUserId !== storeId) {
    throw new Error('MERCADO_LIVRE_PUBLICATION_EXECUTION_TARGET_INVALID');
  }

  const authorizationRef = adminDb.doc(`stores/${storeId}/catalogOutboundPublicationAuthorizations/${authorizationId}`);
  const authorizationDoc = await authorizationRef.get();
  if (!authorizationDoc.exists) throw new Error('MERCADO_LIVRE_PUBLICATION_AUTHORIZATION_NOT_FOUND');
  const authorization = assertAuthorization(storeId, authorizationId, authorizationDoc.data());
  if (!safeHashEquals(authorization.tokenHash, sha256(authorizationToken))) {
    throw new Error('MERCADO_LIVRE_PUBLICATION_AUTHORIZATION_TOKEN_INVALID');
  }
  if (authorization.expiresAtMillis <= Date.now()) throw new Error('MERCADO_LIVRE_PUBLICATION_AUTHORIZATION_EXPIRED');
  if (authorization.consumptionStatus !== 'available' || authorization.useCount !== 0) {
    throw new Error('MERCADO_LIVRE_PUBLICATION_AUTHORIZATION_ALREADY_CONSUMED');
  }
  if (!safeHashEquals(authorization.payloadHash, payloadHash(authorization.payload))) {
    throw new Error('MERCADO_LIVRE_PUBLICATION_AUTHORIZATION_PAYLOAD_STALE');
  }

  await assertCurrentMercadoLivrePublicationCapability({
    storeId,
    connectionId: authorization.connectionId,
    requestedByUserId: executedByUserId,
    expectedSnapshot: authorization.providerCapability,
  });

  const proposalRef = adminDb.doc(`stores/${storeId}/catalogOutboundPublicationProposals/${authorization.proposalId}`);
  const validationRef = adminDb.doc(`stores/${storeId}/catalogOutboundListingValidations/${authorization.proposalId}`);
  const canonicalRef = adminDb.doc(`stores/${authorization.canonicalStoreId}/products/${authorization.canonicalProductId}`);
  const executionId = `mlexec_${sha256(`${storeId}:${authorizationId}`).slice(0, 32)}`;
  const executionRef = adminDb.doc(`stores/${storeId}/catalogOutboundPublicationExecutions/${executionId}`);
  const reservedAt = new Date().toISOString();

  await adminDb.runTransaction(async transaction => {
    const [currentAuthorizationDoc, proposalDoc, validationDoc, canonicalDoc, executionDoc] = await Promise.all([
      transaction.get(authorizationRef),
      transaction.get(proposalRef),
      transaction.get(validationRef),
      transaction.get(canonicalRef),
      transaction.get(executionRef),
    ]);
    if (!currentAuthorizationDoc.exists) throw new Error('MERCADO_LIVRE_PUBLICATION_AUTHORIZATION_NOT_FOUND');
    const currentAuthorization = assertAuthorization(storeId, authorizationId, currentAuthorizationDoc.data());
    const proposal = assertProposal(currentAuthorization, proposalDoc.data());
    const validation = validationDoc.data() as Record<string, unknown> | undefined;
    const currentCanonicalHash = canonicalHash(canonicalDoc.data());
    if (
      currentAuthorization.consumptionStatus !== 'available' || currentAuthorization.useCount !== 0 ||
      currentAuthorization.expiresAtMillis <= Date.now() || executionDoc.exists ||
      currentAuthorization.providerCapabilityFingerprint !== authorization.providerCapabilityFingerprint ||
      proposal.executionStatus !== 'authorized' ||
      proposal.providerCapabilityFingerprint !== currentAuthorization.providerCapabilityFingerprint ||
      clean(validation?.validatedAt, 80) !== currentAuthorization.listingValidatedAt ||
      clean(validation?.providerCapabilityFingerprint, 80) !== currentAuthorization.providerCapabilityFingerprint ||
      validation?.providerPublicationModel !== currentAuthorization.providerPublicationModel ||
      validation?.providerStockAuthority !== currentAuthorization.providerStockAuthority ||
      !validation?.providerPayload || typeof validation.providerPayload !== 'object' || Array.isArray(validation.providerPayload) ||
      !safeHashEquals(currentAuthorization.payloadHash, payloadHash(validation.providerPayload as Record<string, unknown>)) ||
      !currentCanonicalHash || !safeHashEquals(currentAuthorization.canonicalBaselineHash, currentCanonicalHash)
    ) throw new Error('MERCADO_LIVRE_PUBLICATION_EXECUTION_STALE');

    transaction.update(authorizationRef, {
      consumptionStatus: 'executing',
      useCount: 1,
      consumedByExecutionId: executionId,
      executionReservedAt: reservedAt,
      serverExecutionReservedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(proposalRef, {
      executionStatus: 'executing',
      publicationExecutionId: executionId,
      publicationExecutionReservedAt: reservedAt,
      serverPublicationExecutionReservedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(executionRef, {
      schemaVersion: 2,
      id: executionId,
      proposalId: currentAuthorization.proposalId,
      authorizationId,
      storeId,
      provider: 'mercado_livre',
      connectionId: currentAuthorization.connectionId,
      canonicalStoreId: currentAuthorization.canonicalStoreId,
      canonicalProductId: currentAuthorization.canonicalProductId,
      canonicalBaselineHash: currentAuthorization.canonicalBaselineHash,
      providerCapabilityFingerprint: currentAuthorization.providerCapabilityFingerprint,
      providerPublicationModel: currentAuthorization.providerPublicationModel,
      providerStockAuthority: currentAuthorization.providerStockAuthority,
      providerCapability: currentAuthorization.providerCapability,
      payloadHash: currentAuthorization.payloadHash,
      status: 'executing',
      authority: 'consumed_store_owner_publication_authorization',
      executedByUserId,
      reservedAt,
      serverReservedAt: FieldValue.serverTimestamp(),
    });
  });

  let providerItem: MercadoLivreCreatedItem;
  try {
    providerItem = await mercadoLivrePostJson<MercadoLivreCreatedItem>(storeId, '/items', authorization.payload);
  } catch (error) {
    const rejected = isDefiniteProviderRejection(error);
    const failedAt = new Date().toISOString();
    await adminDb.runTransaction(async transaction => {
      transaction.update(executionRef, {
        status: rejected ? 'provider_rejected' : 'reconciliation_required',
        failureCode: rejected ? 'definite_provider_rejection' : 'ambiguous_provider_result',
        failedAt,
        serverFailedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(authorizationRef, {
        consumptionStatus: rejected ? 'rejected' : 'reconciliation_required',
        executionFailedAt: failedAt,
        serverExecutionFailedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(proposalRef, {
        executionStatus: rejected ? 'provider_rejected' : 'reconciliation_required',
        publicationExecutionFailedAt: failedAt,
        serverPublicationExecutionFailedAt: FieldValue.serverTimestamp(),
      });
    });
    throw error;
  }

  const externalItemId = clean(providerItem.id, 160);
  if (!externalItemId) {
    const ambiguousAt = new Date().toISOString();
    await adminDb.runTransaction(async transaction => {
      transaction.update(executionRef, { status: 'reconciliation_required', failureCode: 'provider_success_without_item_id', ambiguousAt, serverAmbiguousAt: FieldValue.serverTimestamp() });
      transaction.update(authorizationRef, { consumptionStatus: 'reconciliation_required', serverExecutionFailedAt: FieldValue.serverTimestamp() });
      transaction.update(proposalRef, { executionStatus: 'reconciliation_required', serverPublicationExecutionFailedAt: FieldValue.serverTimestamp() });
    });
    throw new Error('MERCADO_LIVRE_PUBLICATION_RESULT_AMBIGUOUS');
  }

  const bindingId = deterministicBindingId(authorization, externalItemId);
  const bindingRef = adminDb.doc(`stores/${storeId}/externalCatalogBindings/${bindingId}`);
  const completedAt = new Date().toISOString();
  await adminDb.runTransaction(async transaction => {
    const [executionDoc, bindingDoc] = await Promise.all([
      transaction.get(executionRef),
      transaction.get(bindingRef),
    ]);
    const execution = executionDoc.data() as Record<string, unknown> | undefined;
    if (
      clean(execution?.status, 80) !== 'executing' ||
      clean(execution?.providerCapabilityFingerprint, 80) !== authorization.providerCapabilityFingerprint
    ) throw new Error('MERCADO_LIVRE_PUBLICATION_EXECUTION_CONFLICT');
    if (bindingDoc.exists) {
      const existing = bindingDoc.data() as Record<string, unknown>;
      if (
        existing.provider !== 'mercado_livre' || clean(existing.storeId, 160) !== storeId ||
        clean(existing.connectionId, 200) !== authorization.connectionId ||
        clean(existing.externalItemId, 160) !== externalItemId ||
        clean(existing.canonicalStoreId, 160) !== authorization.canonicalStoreId ||
        clean(existing.canonicalProductId, 160) !== authorization.canonicalProductId
      ) throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_CONFLICT');
    } else {
      transaction.create(bindingRef, {
        schemaVersion: 2,
        id: bindingId,
        storeId,
        provider: 'mercado_livre',
        connectionId: authorization.connectionId,
        externalItemId,
        canonicalStoreId: authorization.canonicalStoreId,
        canonicalProductId: authorization.canonicalProductId,
        status: 'active',
        authority: 'store_owner_outbound_publication',
        boundByUserId: executedByUserId,
        sourceProposalId: authorization.proposalId,
        sourceAuthorizationId: authorizationId,
        sourceExecutionId: executionId,
        canonicalBaselineHash: authorization.canonicalBaselineHash,
        providerCapabilityFingerprint: authorization.providerCapabilityFingerprint,
        providerPublicationModel: authorization.providerPublicationModel,
        providerStockAuthority: authorization.providerStockAuthority,
        createdAt: completedAt,
        updatedAt: completedAt,
        serverCreatedAt: FieldValue.serverTimestamp(),
        serverUpdatedAt: FieldValue.serverTimestamp(),
      });
    }
    transaction.update(executionRef, {
      status: 'published',
      externalItemId,
      bindingId,
      providerStatus: clean(providerItem.status, 80),
      ...(clean(providerItem.permalink, 2_000) ? { permalink: clean(providerItem.permalink, 2_000) } : {}),
      completedAt,
      serverCompletedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(authorizationRef, {
      consumptionStatus: 'consumed',
      consumedAt: completedAt,
      externalItemId,
      bindingId,
      serverConsumedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(proposalRef, {
      executionStatus: 'published',
      externalItemId,
      externalCatalogBindingId: bindingId,
      publishedAt: completedAt,
      serverPublishedAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    proposalId: authorization.proposalId,
    authorizationId,
    executionId,
    status: 'published',
    externalItemId,
    bindingId,
    providerStatus: clean(providerItem.status, 80),
    ...(clean(providerItem.permalink, 2_000) ? { permalink: clean(providerItem.permalink, 2_000) } : {}),
  };
};
