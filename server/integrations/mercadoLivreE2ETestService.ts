import { adminDb } from '../firebaseAdmin.js';
import { mercadoLivreGetJson } from './mercadoLivreOauthService.js';
import { getStoreConnectionRegistryRecord } from './storeConnectionRegistry.js';

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

export interface MercadoLivreE2EEligibleProduct {
  id: string;
  canonicalStoreId: string;
  name: string;
  price: number;
  stock: number;
  category: string;
  image: string;
  publicationStatus: string;
  activeBindingId: string;
  externalItemId: string;
}

export const listMercadoLivreE2EEligibleProducts = async (input: {
  storeId: string;
  requestedByUserId: string;
}): Promise<{ canonicalStoreId: string; items: MercadoLivreE2EEligibleProduct[] }> => {
  const storeId = clean(input.storeId, 160);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  if (!storeId || requestedByUserId !== storeId) throw new Error('MERCADO_LIVRE_E2E_FORBIDDEN');

  const privateStoreDoc = await adminDb.doc(`users/${storeId}/stores/${storeId}`).get();
  if (!privateStoreDoc.exists) throw new Error('STORE_REQUIRED');
  const canonicalStoreId = clean((privateStoreDoc.data() as Record<string, unknown>).canonicalStoreId, 160);
  if (!canonicalStoreId) throw new Error('CANONICAL_STORE_REQUIRED');

  const [productsSnapshot, bindingsSnapshot] = await Promise.all([
    adminDb.collection(`stores/${canonicalStoreId}/products`).limit(200).get(),
    adminDb.collection(`stores/${storeId}/externalCatalogBindings`).limit(200).get(),
  ]);
  const bindingByProduct = new Map<string, { id: string; externalItemId: string }>();
  for (const document of bindingsSnapshot.docs) {
    const record = document.data() as Record<string, unknown>;
    if (record.provider !== 'mercado_livre' || record.status !== 'active') continue;
    if (clean(record.canonicalStoreId, 160) !== canonicalStoreId) continue;
    const productId = clean(record.canonicalProductId, 160);
    if (!productId) continue;
    bindingByProduct.set(productId, {
      id: clean(record.id, 160) || document.id,
      externalItemId: clean(record.externalItemId, 160),
    });
  }

  const items = productsSnapshot.docs.flatMap(document => {
    const record = document.data() as Record<string, unknown>;
    const id = clean(record.id, 160) || document.id;
    const name = clean(record.name, 120);
    const price = finiteNonNegative(record.price);
    const stock = integerNonNegative(record.stock);
    const publicationStatus = clean(record.publicationStatus, 80);
    if (
      clean(record.storeId, 160) !== canonicalStoreId ||
      !id || !name || price === null || stock === null || !publicationStatus || record.isService === true
    ) return [];
    const binding = bindingByProduct.get(id);
    return [{
      id,
      canonicalStoreId,
      name,
      price,
      stock,
      category: clean(record.category, 160),
      image: clean(record.image, 2_000),
      publicationStatus,
      activeBindingId: binding?.id ?? '',
      externalItemId: binding?.externalItemId ?? '',
    }];
  }).sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));

  return { canonicalStoreId, items };
};

interface ProposalRecord {
  id: string;
  storeId: string;
  provider: 'mercado_livre';
  connectionId: string;
  canonicalStoreId: string;
  canonicalProductId: string;
  status: 'review_required';
  action: 'create_external_listing';
  executionStatus: 'not_authorized';
}

const assertProposal = (storeId: string, proposalId: string, value: unknown): ProposalRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_NOT_FOUND');
  const record = value as Record<string, unknown>;
  if (
    clean(record.id, 160) !== proposalId || clean(record.storeId, 160) !== storeId ||
    record.provider !== 'mercado_livre' || record.status !== 'review_required' ||
    record.action !== 'create_external_listing' || record.executionStatus !== 'not_authorized' ||
    !clean(record.connectionId, 200) || !clean(record.canonicalStoreId, 160) || !clean(record.canonicalProductId, 160)
  ) throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_INVALID');
  return record as unknown as ProposalRecord;
};

const parseValues = (value: unknown): Array<{ id: string; name: string }> => {
  if (!Array.isArray(value)) return [];
  return value.flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const record = candidate as Record<string, unknown>;
    const id = clean(record.id, 160);
    const name = clean(record.name, 255);
    return id || name ? [{ id, name: name || id }] : [];
  }).slice(0, 200);
};

export interface MercadoLivreE2ECategoryOptions {
  proposalId: string;
  category: { id: string; name: string };
  conditions: string[];
  currencies: string[];
  listingTypes: Array<{ id: string; name: string }>;
  attributes: Array<{
    id: string;
    name: string;
    valueType: string;
    required: boolean;
    newRequired: boolean;
    conditionalRequired: boolean;
    values: Array<{ id: string; name: string }>;
  }>;
  authority: 'provider_api_requirement_options';
}

export const inspectMercadoLivreE2ECategoryOptions = async (input: {
  storeId: string;
  proposalId: string;
  categoryId: string;
  requestedByUserId: string;
}): Promise<MercadoLivreE2ECategoryOptions> => {
  const storeId = clean(input.storeId, 160);
  const proposalId = clean(input.proposalId, 160);
  const categoryId = clean(input.categoryId, 160);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  if (!storeId || !proposalId || !categoryId || requestedByUserId !== storeId) throw new Error('MERCADO_LIVRE_E2E_FORBIDDEN');

  const [proposalDoc, inspectionDoc] = await Promise.all([
    adminDb.doc(`stores/${storeId}/catalogOutboundPublicationProposals/${proposalId}`).get(),
    adminDb.doc(`stores/${storeId}/catalogOutboundRequirementInspections/${proposalId}`).get(),
  ]);
  const proposal = assertProposal(storeId, proposalId, proposalDoc.data());
  if (!inspectionDoc.exists) throw new Error('MERCADO_LIVRE_OUTBOUND_REQUIREMENT_INSPECTION_REQUIRED');
  const inspection = inspectionDoc.data() as Record<string, unknown>;
  const suggestions = Array.isArray(inspection.categorySuggestions) ? inspection.categorySuggestions : [];
  const predicted = suggestions.some(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    return clean((candidate as Record<string, unknown>).categoryId, 160) === categoryId;
  });
  if (!predicted) throw new Error('MERCADO_LIVRE_OUTBOUND_CATEGORY_NOT_PREDICTED');

  const connection = await getStoreConnectionRegistryRecord({ storeId, connectionId: proposal.connectionId });
  if (!connection || connection.provider !== 'mercado_livre' || connection.status !== 'connected' || connection.syncAuthority !== 'manual_review') {
    throw new Error('MERCADO_LIVRE_CONNECTION_INVALID');
  }

  const [categoryRaw, attributesRaw, listingTypesRaw] = await Promise.all([
    mercadoLivreGetJson<unknown>(storeId, `/categories/${encodeURIComponent(categoryId)}`),
    mercadoLivreGetJson<unknown>(storeId, `/categories/${encodeURIComponent(categoryId)}/attributes`),
    mercadoLivreGetJson<unknown>(storeId, `/users/${encodeURIComponent(connection.externalAccountId)}/available_listing_types?category_id=${encodeURIComponent(categoryId)}`),
  ]);
  if (!categoryRaw || typeof categoryRaw !== 'object' || Array.isArray(categoryRaw)) throw new Error('MERCADO_LIVRE_OUTBOUND_CATEGORY_INVALID');
  const category = categoryRaw as Record<string, unknown>;
  const settings = category.settings && typeof category.settings === 'object' && !Array.isArray(category.settings)
    ? category.settings as Record<string, unknown> : {};
  if (clean(category.id, 160) !== categoryId || settings.listing_allowed !== true || clean(settings.status, 80) !== 'enabled') {
    throw new Error('MERCADO_LIVRE_OUTBOUND_CATEGORY_NOT_LISTABLE');
  }
  const conditions = Array.isArray(settings.item_conditions)
    ? settings.item_conditions.map(value => clean(value, 120)).filter(Boolean) : [];
  const currencies = Array.isArray(settings.currencies)
    ? settings.currencies.map(value => clean(value, 40)).filter(Boolean) : [];

  const listingContainer = listingTypesRaw && typeof listingTypesRaw === 'object' && !Array.isArray(listingTypesRaw)
    ? listingTypesRaw as Record<string, unknown> : {};
  const listingTypes = (Array.isArray(listingContainer.available) ? listingContainer.available : []).flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const record = candidate as Record<string, unknown>;
    const id = clean(record.id, 120);
    if (!id) return [];
    return [{ id, name: clean(record.name, 160) || id }];
  });

  const attributes = (Array.isArray(attributesRaw) ? attributesRaw : []).flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const record = candidate as Record<string, unknown>;
    const id = clean(record.id, 160);
    if (!id) return [];
    const tags = record.tags && typeof record.tags === 'object' && !Array.isArray(record.tags)
      ? record.tags as Record<string, unknown> : {};
    return [{
      id,
      name: clean(record.name, 255) || id,
      valueType: clean(record.value_type, 80),
      required: tags.required === true,
      newRequired: tags.new_required === true,
      conditionalRequired: tags.conditional_required === true,
      values: parseValues(record.values),
    }];
  });

  return {
    proposalId,
    category: { id: categoryId, name: clean(category.name, 160) || categoryId },
    conditions,
    currencies,
    listingTypes,
    attributes,
    authority: 'provider_api_requirement_options',
  };
};
