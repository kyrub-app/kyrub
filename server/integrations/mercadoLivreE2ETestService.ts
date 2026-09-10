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

export interface MercadoLivreE2EEligibilityDiagnostics {
  canonicalProductCount: number;
  eligibleProductCount: number;
  excluded: {
    storeMismatch: number;
    missingId: number;
    missingName: number;
    invalidPrice: number;
    invalidStock: number;
    missingPublicationStatus: number;
    service: number;
  };
}

export const listMercadoLivreE2EEligibleProducts = async (input: {
  storeId: string;
  requestedByUserId: string;
}): Promise<{
  canonicalStoreId: string;
  items: MercadoLivreE2EEligibleProduct[];
  diagnostics: MercadoLivreE2EEligibilityDiagnostics;
}> => {
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

  const excluded: MercadoLivreE2EEligibilityDiagnostics['excluded'] = {
    storeMismatch: 0,
    missingId: 0,
    missingName: 0,
    invalidPrice: 0,
    invalidStock: 0,
    missingPublicationStatus: 0,
    service: 0,
  };
  const items: MercadoLivreE2EEligibleProduct[] = [];

  for (const document of productsSnapshot.docs) {
    const record = document.data() as Record<string, unknown>;
    const id = clean(record.id, 160) || document.id;
    const name = clean(record.name, 120);
    const price = finiteNonNegative(record.price);
    const stock = integerNonNegative(record.stock);
    const publicationStatus = clean(record.publicationStatus, 80);

    if (clean(record.storeId, 160) !== canonicalStoreId) { excluded.storeMismatch += 1; continue; }
    if (!id) { excluded.missingId += 1; continue; }
    if (!name) { excluded.missingName += 1; continue; }
    if (price === null) { excluded.invalidPrice += 1; continue; }
    if (stock === null) { excluded.invalidStock += 1; continue; }
    if (!publicationStatus) { excluded.missingPublicationStatus += 1; continue; }
    if (record.isService === true) { excluded.service += 1; continue; }

    const binding = bindingByProduct.get(id);
    items.push({
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
    });
  }

  items.sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
  return {
    canonicalStoreId,
    items,
    diagnostics: {
      canonicalProductCount: productsSnapshot.size,
      eligibleProductCount: items.length,
      excluded,
    },
  };
};

interface ProposalRecord {
  id: string;
  storeId: string;
  provider: 'mercado_livre';
  connectionId: string;
  canonicalStoreId: string;
  canonicalProductId: string;
  providerPublicationModel: 'legacy_items' | 'user_products';
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
    !clean(record.connectionId, 200) || !clean(record.canonicalStoreId, 160) || !clean(record.canonicalProductId, 160) ||
    (record.providerPublicationModel !== 'legacy_items' && record.providerPublicationModel !== 'user_products')
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

const trueTagNames = (tags: Record<string, unknown>): string[] =>
  Object.entries(tags)
    .filter(([, value]) => value === true)
    .map(([name]) => clean(name, 120))
    .filter(Boolean)
    .sort();

const recordFrom = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const uniqueStrings = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.map(item => clean(item, 120)).filter(Boolean))] : [];

const categoryShippingModes = (value: unknown): string[] => {
  const record = recordFrom(value);
  const direct = uniqueStrings(record.modes);
  const logistics = Array.isArray(record.logistics) ? record.logistics : [];
  const fromLogistics = logistics.flatMap(candidate => {
    const item = recordFrom(candidate);
    const mode = clean(item.mode, 120);
    return mode ? [mode] : [];
  });
  return [...new Set([...direct, ...fromLogistics])];
};

export interface MercadoLivreE2ESaleTermOption {
  id: string;
  name: string;
  valueType: string;
  required: boolean;
  hidden: boolean;
  values: Array<{ id: string; name: string }>;
  allowedUnits: Array<{ id: string; name: string }>;
  defaultUnit: string;
  providerTags: string[];
}

export interface MercadoLivreE2ECategoryOptions {
  proposalId: string;
  publicationModel: 'legacy_items' | 'user_products';
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
    allowVariations: boolean;
    variationAttribute: boolean;
    catalogRequired: boolean;
    readOnly: boolean;
    hidden: boolean;
    providerTags: string[];
    values: Array<{ id: string; name: string }>;
  }>;
  saleTerms: MercadoLivreE2ESaleTermOption[];
  shipping: {
    sellerModes: string[];
    categoryModes: string[];
    allowedModes: string[];
    localPickUpAvailable: boolean;
  };
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

  const externalAccountId = encodeURIComponent(connection.externalAccountId);
  const [categoryRaw, attributesRaw, listingTypesRaw, saleTermsRaw, sellerShippingRaw, categoryShippingRaw] = await Promise.all([
    mercadoLivreGetJson<unknown>(storeId, `/categories/${encodeURIComponent(categoryId)}`),
    mercadoLivreGetJson<unknown>(storeId, `/categories/${encodeURIComponent(categoryId)}/attributes`),
    mercadoLivreGetJson<unknown>(storeId, `/users/${externalAccountId}/available_listing_types?category_id=${encodeURIComponent(categoryId)}`),
    mercadoLivreGetJson<unknown>(storeId, `/categories/${encodeURIComponent(categoryId)}/sale_terms`),
    mercadoLivreGetJson<unknown>(storeId, `/users/${externalAccountId}/shipping_preferences`),
    mercadoLivreGetJson<unknown>(storeId, `/categories/${encodeURIComponent(categoryId)}/shipping_preferences`),
  ]);
  if (!categoryRaw || typeof categoryRaw !== 'object' || Array.isArray(categoryRaw)) throw new Error('MERCADO_LIVRE_OUTBOUND_CATEGORY_INVALID');
  const category = categoryRaw as Record<string, unknown>;
  const settings = recordFrom(category.settings);
  if (clean(category.id, 160) !== categoryId || settings.listing_allowed !== true || clean(settings.status, 80) !== 'enabled') {
    throw new Error('MERCADO_LIVRE_OUTBOUND_CATEGORY_NOT_LISTABLE');
  }
  const conditions = uniqueStrings(settings.item_conditions);
  const currencies = uniqueStrings(settings.currencies);

  const listingContainer = recordFrom(listingTypesRaw);
  const listingTypes = (Array.isArray(listingContainer.available) ? listingContainer.available : []).flatMap(candidate => {
    const record = recordFrom(candidate);
    const id = clean(record.id, 120);
    if (!id) return [];
    return [{ id, name: clean(record.name, 160) || id }];
  });

  const attributes = (Array.isArray(attributesRaw) ? attributesRaw : []).flatMap(candidate => {
    const record = recordFrom(candidate);
    const id = clean(record.id, 160);
    if (!id) return [];
    const tags = recordFrom(record.tags);
    return [{
      id,
      name: clean(record.name, 255) || id,
      valueType: clean(record.value_type, 80),
      required: tags.required === true,
      newRequired: tags.new_required === true,
      conditionalRequired: tags.conditional_required === true,
      allowVariations: tags.allow_variations === true,
      variationAttribute: tags.variation_attribute === true,
      catalogRequired: tags.catalog_required === true,
      readOnly: tags.read_only === true,
      hidden: tags.hidden === true,
      providerTags: trueTagNames(tags),
      values: parseValues(record.values),
    }];
  });

  const saleTerms = (Array.isArray(saleTermsRaw) ? saleTermsRaw : []).flatMap(candidate => {
    const record = recordFrom(candidate);
    const id = clean(record.id, 160);
    if (!id) return [];
    const tags = recordFrom(record.tags);
    return [{
      id,
      name: clean(record.name, 255) || id,
      valueType: clean(record.value_type, 80),
      required: tags.required === true,
      hidden: tags.hidden === true,
      values: parseValues(record.values),
      allowedUnits: parseValues(record.allowed_units),
      defaultUnit: clean(record.default_unit, 80),
      providerTags: trueTagNames(tags),
    }];
  });

  const sellerShipping = recordFrom(sellerShippingRaw);
  const sellerModes = uniqueStrings(sellerShipping.modes);
  const categoryModes = categoryShippingModes(categoryShippingRaw);
  const allowedModes = categoryModes.length
    ? sellerModes.filter(mode => categoryModes.includes(mode))
    : [...sellerModes];

  return {
    proposalId,
    publicationModel: proposal.providerPublicationModel,
    category: { id: categoryId, name: clean(category.name, 160) || categoryId },
    conditions,
    currencies,
    listingTypes,
    attributes,
    saleTerms,
    shipping: {
      sellerModes,
      categoryModes,
      allowedModes,
      localPickUpAvailable: sellerShipping.local_pick_up === true,
    },
    authority: 'provider_api_requirement_options',
  };
};
