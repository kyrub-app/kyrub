import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  freezeMercadoLivrePublicationCapability,
  inspectMercadoLivrePublicationCapability,
  type MercadoLivrePublicationCapabilitySnapshot,
  type MercadoLivrePublicationModel,
  type MercadoLivreStockAuthority,
} from './mercadoLivrePublicationCapabilityService.js';
import { getStoreConnectionRegistryRecord } from './storeConnectionRegistry.js';

interface CanonicalProductRecord {
  id: string;
  storeId: string;
  name: string;
  price: number;
  stock: number;
  category: string;
  image: string;
  isService: boolean;
  publicationStatus: string;
}

export interface MercadoLivreOutboundPublicationProposal {
  schemaVersion: 2;
  id: string;
  storeId: string;
  canonicalStoreId: string;
  provider: 'mercado_livre';
  connectionId: string;
  canonicalProductId: string;
  status: 'review_required';
  authority: 'canonical_kyrub_snapshot';
  action: 'create_external_listing';
  proposedByUserId: string;
  proposedAt: string;
  canonicalBaselineHash: string;
  providerCapabilityFingerprint: string;
  providerPublicationModel: MercadoLivrePublicationModel;
  providerStockAuthority: MercadoLivreStockAuthority;
  providerCapability: MercadoLivrePublicationCapabilitySnapshot;
  canonical: {
    name: string;
    price: number;
    stock: number;
    category: string;
    image: string;
    publicationStatus: string;
  };
  adaptation: {
    title: string;
    price: number;
    availableQuantity: number;
    pictureUrl?: string;
  };
  requirements: {
    ready: false;
    missing: Array<'mercado_livre_category_id' | 'listing_type_id' | 'condition' | 'required_attributes'>;
  };
  executionStatus: 'not_authorized';
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

const canonicalHash = (product: CanonicalProductRecord): string => createHash('sha256')
  .update(JSON.stringify({
    name: product.name,
    price: product.price,
    stock: product.stock,
    category: product.category,
    image: product.image,
    isService: product.isService,
    publicationStatus: product.publicationStatus,
  }))
  .digest('hex');

const proposalIdFor = (
  storeId: string,
  connectionId: string,
  canonicalStoreId: string,
  productId: string,
  baselineHash: string,
  providerCapabilityFingerprint: string
): string => `mlout_${createHash('sha256')
  .update([
    storeId,
    connectionId,
    canonicalStoreId,
    productId,
    baselineHash,
    providerCapabilityFingerprint,
  ].join(':'))
  .digest('hex')
  .slice(0, 32)}`;

const assertCanonicalProduct = (
  canonicalStoreId: string,
  productId: string,
  value: unknown
): CanonicalProductRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_PRODUCT_NOT_FOUND');
  }
  const record = value as Record<string, unknown>;
  const name = clean(record.name, 120);
  const price = finiteNonNegative(record.price);
  const stock = integerNonNegative(record.stock);
  if (
    clean(record.id, 160) !== productId ||
    clean(record.storeId, 160) !== canonicalStoreId ||
    !name ||
    price === null ||
    stock === null ||
    record.isService === true ||
    !clean(record.publicationStatus, 80)
  ) throw new Error('MERCADO_LIVRE_OUTBOUND_PRODUCT_INVALID');
  return {
    id: productId,
    storeId: canonicalStoreId,
    name,
    price,
    stock,
    category: clean(record.category, 160),
    image: clean(record.image, 2_000),
    isService: false,
    publicationStatus: clean(record.publicationStatus, 80),
  };
};

export const proposeMercadoLivreExternalPublication = async (input: {
  storeId: string;
  connectionId: string;
  canonicalProductId: string;
  proposedByUserId: string;
}): Promise<MercadoLivreOutboundPublicationProposal> => {
  const storeId = input.storeId.trim();
  const connectionId = input.connectionId.trim();
  const canonicalProductId = input.canonicalProductId.trim();
  const proposedByUserId = input.proposedByUserId.trim();
  if (!storeId || !connectionId || !canonicalProductId || proposedByUserId !== storeId) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_TARGET_INVALID');
  }

  const connection = await getStoreConnectionRegistryRecord({ storeId, connectionId });
  if (!connection || connection.provider !== 'mercado_livre' || connection.status !== 'connected') {
    throw new Error('MERCADO_LIVRE_CONNECTION_INVALID');
  }
  if (connection.syncAuthority !== 'manual_review') {
    throw new Error('MERCADO_LIVRE_OUTBOUND_AUTHORITY_INVALID');
  }

  const providerCapability = await inspectMercadoLivrePublicationCapability({
    storeId,
    connectionId,
    requestedByUserId: proposedByUserId,
  });
  if (providerCapability.readiness !== 'ready_current_adapter') {
    throw new Error(
      `MERCADO_LIVRE_OUTBOUND_PUBLICATION_ADAPTER_MIGRATION_REQUIRED:${providerCapability.blockers.join(',')}`
    );
  }
  if (
    providerCapability.publicationModel !== 'legacy_items' ||
    providerCapability.stockAuthority !== 'item_available_quantity'
  ) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_PUBLICATION_MODEL_UNSUPPORTED');
  }
  const providerCapabilitySnapshot = freezeMercadoLivrePublicationCapability(providerCapability);

  const privateStoreRef = adminDb.doc(`users/${storeId}/stores/${storeId}`);
  const privateStoreDoc = await privateStoreRef.get();
  if (!privateStoreDoc.exists) throw new Error('STORE_REQUIRED');
  const canonicalStoreId = clean((privateStoreDoc.data() as Record<string, unknown>).canonicalStoreId, 160);
  if (!canonicalStoreId) throw new Error('CANONICAL_STORE_REQUIRED');

  const productRef = adminDb.doc(`stores/${canonicalStoreId}/products/${canonicalProductId}`);
  const productDoc = await productRef.get();
  if (!productDoc.exists) throw new Error('MERCADO_LIVRE_OUTBOUND_PRODUCT_NOT_FOUND');
  const product = assertCanonicalProduct(canonicalStoreId, canonicalProductId, productDoc.data());
  const baselineHash = canonicalHash(product);
  const proposalId = proposalIdFor(
    storeId,
    connectionId,
    canonicalStoreId,
    canonicalProductId,
    baselineHash,
    providerCapabilitySnapshot.fingerprint
  );
  const proposalRef = adminDb.doc(`stores/${storeId}/catalogOutboundPublicationProposals/${proposalId}`);
  const existing = await proposalRef.get();
  if (existing.exists) {
    const prior = existing.data() as MercadoLivreOutboundPublicationProposal;
    if (
      prior.schemaVersion !== 2 ||
      prior.storeId !== storeId ||
      prior.canonicalStoreId !== canonicalStoreId ||
      prior.connectionId !== connectionId ||
      prior.canonicalProductId !== canonicalProductId ||
      prior.canonicalBaselineHash !== baselineHash ||
      prior.providerCapabilityFingerprint !== providerCapabilitySnapshot.fingerprint ||
      prior.providerPublicationModel !== providerCapability.publicationModel ||
      prior.providerStockAuthority !== providerCapability.stockAuthority
    ) throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_CONFLICT');
    return prior;
  }

  const now = new Date().toISOString();
  const proposal: MercadoLivreOutboundPublicationProposal = {
    schemaVersion: 2,
    id: proposalId,
    storeId,
    canonicalStoreId,
    provider: 'mercado_livre',
    connectionId,
    canonicalProductId,
    status: 'review_required',
    authority: 'canonical_kyrub_snapshot',
    action: 'create_external_listing',
    proposedByUserId,
    proposedAt: now,
    canonicalBaselineHash: baselineHash,
    providerCapabilityFingerprint: providerCapabilitySnapshot.fingerprint,
    providerPublicationModel: providerCapability.publicationModel,
    providerStockAuthority: providerCapability.stockAuthority,
    providerCapability: providerCapabilitySnapshot,
    canonical: {
      name: product.name,
      price: product.price,
      stock: product.stock,
      category: product.category,
      image: product.image,
      publicationStatus: product.publicationStatus,
    },
    adaptation: {
      title: product.name,
      price: product.price,
      availableQuantity: product.stock,
      ...(product.image ? { pictureUrl: product.image } : {}),
    },
    requirements: {
      ready: false,
      missing: ['mercado_livre_category_id', 'listing_type_id', 'condition', 'required_attributes'],
    },
    executionStatus: 'not_authorized',
  };
  await proposalRef.create({ ...proposal, serverCreatedAt: FieldValue.serverTimestamp() });
  return proposal;
};

export const listMercadoLivreOutboundPublicationProposals = async (input: {
  storeId: string;
  limit?: number;
}): Promise<{ items: MercadoLivreOutboundPublicationProposal[] }> => {
  const storeId = input.storeId.trim();
  if (!storeId) throw new Error('STORE_CONNECTION_STORE_REQUIRED');
  const requested = Number(input.limit ?? 50);
  const limit = Number.isSafeInteger(requested) ? Math.max(1, Math.min(100, requested)) : 50;
  const snapshot = await adminDb.collection(`stores/${storeId}/catalogOutboundPublicationProposals`).limit(limit).get();
  const items = snapshot.docs
    .map(doc => doc.data() as MercadoLivreOutboundPublicationProposal)
    .filter(item => item.provider === 'mercado_livre' && item.storeId === storeId && item.action === 'create_external_listing')
    .sort((a, b) => b.proposedAt.localeCompare(a.proposedAt));
  return { items };
};
