import { adminDb } from '../firebaseAdmin.js';
import { mercadoLivreGetJson } from './mercadoLivreOauthService.js';
import { getStoreConnectionRegistryRecord } from './storeConnectionRegistry.js';

interface OutboundProposalRecord {
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
  canonical: {
    name: string;
    price: number;
    stock: number;
    category: string;
    image: string;
    publicationStatus: string;
  };
  executionStatus: 'not_authorized';
}

interface MercadoLivreUserResponse {
  site_id?: unknown;
}

interface CategoryPrediction {
  category_id?: unknown;
  category_name?: unknown;
}

export interface MercadoLivreRequirementCategoryOptions {
  proposalId: string;
  siteId: string;
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
  inspectionAuthority: 'provider_api_refetch';
  inspectedAt: string;
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

const assertProposal = (
  storeId: string,
  proposalId: string,
  value: unknown
): OutboundProposalRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_NOT_FOUND');
  }
  const record = value as Record<string, unknown>;
  const canonical = record.canonical && typeof record.canonical === 'object' && !Array.isArray(record.canonical)
    ? record.canonical as Record<string, unknown>
    : null;
  if (
    clean(record.id, 160) !== proposalId ||
    clean(record.storeId, 160) !== storeId ||
    record.provider !== 'mercado_livre' ||
    record.status !== 'review_required' ||
    record.authority !== 'canonical_kyrub_snapshot' ||
    record.action !== 'create_external_listing' ||
    record.executionStatus !== 'not_authorized' ||
    !clean(record.connectionId, 200) ||
    !clean(record.canonicalStoreId, 160) ||
    !clean(record.canonicalProductId, 160) ||
    !clean(record.canonicalBaselineHash, 80) ||
    !canonical ||
    !clean(canonical.name, 120)
  ) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_INVALID');
  }
  return record as unknown as OutboundProposalRecord;
};

const canonicalMatchesProposal = (
  proposal: OutboundProposalRecord,
  value: unknown
): boolean => {
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

const inspectionSuggestion = (
  inspection: Record<string, unknown>,
  categoryId: string
): { categoryId: string; categoryName: string } | null => {
  const suggestions = Array.isArray(inspection.categorySuggestions)
    ? inspection.categorySuggestions
    : [];
  for (const candidate of suggestions) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const record = candidate as Record<string, unknown>;
    if (clean(record.categoryId, 160) !== categoryId) continue;
    const categoryName = clean(record.categoryName, 180);
    return categoryName ? { categoryId, categoryName } : null;
  }
  return null;
};

const assertPersistedInspection = (input: {
  storeId: string;
  proposal: OutboundProposalRecord;
  proposalId: string;
  categoryId: string;
  categoryName: string;
  value: unknown;
}): { siteId: string; categoryName: string } => {
  if (!input.value || typeof input.value !== 'object' || Array.isArray(input.value)) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_REQUIREMENT_INSPECTION_REQUIRED');
  }
  const inspection = input.value as Record<string, unknown>;
  const suggestion = inspectionSuggestion(inspection, input.categoryId);
  if (
    clean(inspection.proposalId, 160) !== input.proposalId ||
    inspection.authority !== 'provider_api_refetch' ||
    clean(inspection.connectionId, 200) !== input.proposal.connectionId ||
    clean(inspection.canonicalStoreId, 160) !== input.proposal.canonicalStoreId ||
    clean(inspection.canonicalProductId, 160) !== input.proposal.canonicalProductId ||
    clean(inspection.canonicalBaselineHash, 80) !== input.proposal.canonicalBaselineHash ||
    clean(inspection.inspectedByUserId, 160) !== input.storeId ||
    !clean(inspection.siteId, 16) ||
    !suggestion
  ) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_REQUIREMENT_INSPECTION_STALE');
  }
  if (suggestion.categoryName !== input.categoryName) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_CATEGORY_INTENT_MISMATCH');
  }
  return {
    siteId: clean(inspection.siteId, 16),
    categoryName: suggestion.categoryName,
  };
};

const currentPredictions = async (
  storeId: string,
  siteId: string,
  title: string
): Promise<Array<{ categoryId: string; categoryName: string }>> => {
  const result = await mercadoLivreGetJson<CategoryPrediction[]>(
    storeId,
    `/sites/${encodeURIComponent(siteId)}/domain_discovery/search?limit=3&q=${encodeURIComponent(title)}`
  );
  if (!Array.isArray(result)) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_CATEGORY_PREDICTION_INVALID');
  }
  return result.flatMap(candidate => {
    const categoryId = clean(candidate.category_id, 160);
    const categoryName = clean(candidate.category_name, 180);
    return categoryId && categoryName ? [{ categoryId, categoryName }] : [];
  });
};

export const inspectMercadoLivreRequirementCategoryOptions = async (input: {
  storeId: string;
  proposalId: string;
  categoryId: string;
  categoryName: string;
  requestedByUserId: string;
}): Promise<MercadoLivreRequirementCategoryOptions> => {
  const storeId = clean(input.storeId, 160);
  const proposalId = clean(input.proposalId, 160);
  const categoryId = clean(input.categoryId, 160);
  const categoryName = clean(input.categoryName, 180);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  if (
    !storeId || !proposalId || !categoryId || !categoryName ||
    requestedByUserId !== storeId
  ) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_REQUIREMENT_OPTIONS_FORBIDDEN');
  }

  const [proposalDoc, inspectionDoc] = await Promise.all([
    adminDb.doc(`stores/${storeId}/catalogOutboundPublicationProposals/${proposalId}`).get(),
    adminDb.doc(`stores/${storeId}/catalogOutboundRequirementInspections/${proposalId}`).get(),
  ]);
  const proposal = assertProposal(storeId, proposalId, proposalDoc.data());
  if (!inspectionDoc.exists) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_REQUIREMENT_INSPECTION_REQUIRED');
  }
  const persistedInspection = assertPersistedInspection({
    storeId,
    proposal,
    proposalId,
    categoryId,
    categoryName,
    value: inspectionDoc.data(),
  });

  const canonicalDoc = await adminDb.doc(
    `stores/${proposal.canonicalStoreId}/products/${proposal.canonicalProductId}`
  ).get();
  if (!canonicalDoc.exists || !canonicalMatchesProposal(proposal, canonicalDoc.data())) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_STALE');
  }

  const connection = await getStoreConnectionRegistryRecord({
    storeId,
    connectionId: proposal.connectionId,
  });
  if (
    !connection ||
    connection.provider !== 'mercado_livre' ||
    connection.status !== 'connected' ||
    connection.syncAuthority !== 'manual_review'
  ) {
    throw new Error('MERCADO_LIVRE_CONNECTION_INVALID');
  }

  const user = await mercadoLivreGetJson<MercadoLivreUserResponse>(
    storeId,
    `/users/${encodeURIComponent(connection.externalAccountId)}`
  );
  const currentSiteId = clean(user.site_id, 16);
  if (!currentSiteId || currentSiteId !== persistedInspection.siteId) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_SITE_CHANGED');
  }

  const predictions = await currentPredictions(storeId, currentSiteId, proposal.canonical.name);
  const currentPrediction = predictions.find(candidate => candidate.categoryId === categoryId);
  if (!currentPrediction || currentPrediction.categoryName !== categoryName) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_CATEGORY_NOT_PREDICTED');
  }

  const [categoryRaw, attributesRaw, listingTypesRaw] = await Promise.all([
    mercadoLivreGetJson<unknown>(storeId, `/categories/${encodeURIComponent(categoryId)}`),
    mercadoLivreGetJson<unknown>(storeId, `/categories/${encodeURIComponent(categoryId)}/attributes`),
    mercadoLivreGetJson<unknown>(
      storeId,
      `/users/${encodeURIComponent(connection.externalAccountId)}/available_listing_types?category_id=${encodeURIComponent(categoryId)}`
    ),
  ]);
  if (!categoryRaw || typeof categoryRaw !== 'object' || Array.isArray(categoryRaw)) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_CATEGORY_INVALID');
  }
  const category = categoryRaw as Record<string, unknown>;
  const settings = category.settings && typeof category.settings === 'object' && !Array.isArray(category.settings)
    ? category.settings as Record<string, unknown>
    : {};
  if (
    clean(category.id, 160) !== categoryId ||
    settings.listing_allowed !== true ||
    clean(settings.status, 80) !== 'enabled'
  ) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_CATEGORY_NOT_LISTABLE');
  }
  const providerCategoryName = clean(category.name, 180) || categoryId;
  if (providerCategoryName !== categoryName) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_CATEGORY_INTENT_MISMATCH');
  }

  const conditions = Array.isArray(settings.item_conditions)
    ? settings.item_conditions.map(value => clean(value, 120)).filter(Boolean)
    : [];
  const currencies = Array.isArray(settings.currencies)
    ? settings.currencies.map(value => clean(value, 40)).filter(Boolean)
    : [];

  const listingContainer = listingTypesRaw && typeof listingTypesRaw === 'object' && !Array.isArray(listingTypesRaw)
    ? listingTypesRaw as Record<string, unknown>
    : {};
  const listingTypes = (Array.isArray(listingContainer.available)
    ? listingContainer.available
    : []).flatMap(candidate => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
      const record = candidate as Record<string, unknown>;
      const id = clean(record.id, 120);
      if (!id) return [];
      return [{ id, name: clean(record.name, 180) || id }];
    });

  const attributes = (Array.isArray(attributesRaw) ? attributesRaw : []).flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const record = candidate as Record<string, unknown>;
    const id = clean(record.id, 160);
    if (!id) return [];
    const tags = record.tags && typeof record.tags === 'object' && !Array.isArray(record.tags)
      ? record.tags as Record<string, unknown>
      : {};
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
    siteId: currentSiteId,
    category: { id: categoryId, name: providerCategoryName },
    conditions,
    currencies,
    listingTypes,
    attributes,
    authority: 'provider_api_requirement_options',
    inspectionAuthority: 'provider_api_refetch',
    inspectedAt: new Date().toISOString(),
  };
};
