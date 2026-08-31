import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { mercadoLivreGetJson } from './mercadoLivreOauthService.js';
import { getStoreConnectionRegistryRecord } from './storeConnectionRegistry.js';

interface OutboundProposalRecord {
  schemaVersion: 1;
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

interface MercadoLivreUserResponse { id?: unknown; site_id?: unknown }
interface CategoryPrediction {
  domain_id?: unknown;
  domain_name?: unknown;
  category_id?: unknown;
  category_name?: unknown;
  attributes?: unknown;
}
interface CategoryDetail {
  id?: unknown;
  name?: unknown;
  settings?: {
    listing_allowed?: unknown;
    status?: unknown;
    item_conditions?: unknown;
    currencies?: unknown;
  };
}
interface CategoryAttribute {
  id?: unknown;
  name?: unknown;
  value_type?: unknown;
  value_max_length?: unknown;
  tags?: Record<string, unknown>;
  values?: unknown;
}
interface AvailableListingTypesResponse { category_id?: unknown; available?: unknown }

export interface MercadoLivreOutboundRequirementInspection {
  proposalId: string;
  siteId: string;
  categorySuggestions: Array<{
    domainId: string;
    domainName: string;
    categoryId: string;
    categoryName: string;
  }>;
  authority: 'provider_api_refetch';
  inspectedAt: string;
}

export interface MercadoLivreOutboundRequirementConfiguration {
  proposalId: string;
  siteId: string;
  category: { id: string; name: string };
  listingType: { id: string; name: string };
  condition: string;
  currencyId: string;
  attributes: Array<{ id: string; valueId?: string; valueName?: string }>;
  requiredAttributeIds: string[];
  conditionalAttributeIds: string[];
  missingRequiredAttributeIds: string[];
  ready: boolean;
  authority: 'provider_api_refetch_and_store_owner_selection';
  configuredAt: string;
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
const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(item => clean(item, 120)).filter(Boolean) : [];

const assertProposal = (storeId: string, proposalId: string, value: unknown): OutboundProposalRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_NOT_FOUND');
  const record = value as Record<string, unknown>;
  const canonical = record.canonical && typeof record.canonical === 'object' && !Array.isArray(record.canonical)
    ? record.canonical as Record<string, unknown> : null;
  if (
    clean(record.id, 160) !== proposalId || clean(record.storeId, 160) !== storeId ||
    record.provider !== 'mercado_livre' || record.status !== 'review_required' ||
    record.authority !== 'canonical_kyrub_snapshot' || record.action !== 'create_external_listing' ||
    record.executionStatus !== 'not_authorized' || !clean(record.canonicalStoreId, 160) ||
    !clean(record.connectionId, 200) || !clean(record.canonicalProductId, 160) ||
    !clean(record.canonicalBaselineHash, 80) || !canonical || !clean(canonical.name, 120)
  ) throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_INVALID');
  return record as unknown as OutboundProposalRecord;
};

const loadProposal = async (storeId: string, proposalId: string): Promise<OutboundProposalRecord> => {
  const snapshot = await adminDb.doc(`stores/${storeId}/catalogOutboundPublicationProposals/${proposalId}`).get();
  if (!snapshot.exists) throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_NOT_FOUND');
  return assertProposal(storeId, proposalId, snapshot.data());
};

const canonicalMatchesProposal = (proposal: OutboundProposalRecord, value: unknown): boolean => {
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

const assertCanonicalStillCurrent = async (proposal: OutboundProposalRecord): Promise<void> => {
  const snapshot = await adminDb.doc(
    `stores/${proposal.canonicalStoreId}/products/${proposal.canonicalProductId}`
  ).get();
  if (!snapshot.exists || !canonicalMatchesProposal(proposal, snapshot.data())) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_STALE');
  }
};

const assertConnectedManualReview = async (proposal: OutboundProposalRecord) => {
  const connection = await getStoreConnectionRegistryRecord({ storeId: proposal.storeId, connectionId: proposal.connectionId });
  if (!connection || connection.provider !== 'mercado_livre' || connection.status !== 'connected') throw new Error('MERCADO_LIVRE_CONNECTION_INVALID');
  if (connection.syncAuthority !== 'manual_review') throw new Error('MERCADO_LIVRE_OUTBOUND_AUTHORITY_INVALID');
  return connection;
};

const loadSiteId = async (storeId: string, externalAccountId: string): Promise<string> => {
  const user = await mercadoLivreGetJson<MercadoLivreUserResponse>(storeId, `/users/${encodeURIComponent(externalAccountId)}`);
  const siteId = clean(user.site_id, 8);
  if (!siteId) throw new Error('MERCADO_LIVRE_OUTBOUND_SITE_UNAVAILABLE');
  return siteId;
};

const predictionsFor = async (storeId: string, siteId: string, title: string) => {
  const result = await mercadoLivreGetJson<CategoryPrediction[]>(
    storeId,
    `/sites/${encodeURIComponent(siteId)}/domain_discovery/search?limit=3&q=${encodeURIComponent(title)}`
  );
  if (!Array.isArray(result)) throw new Error('MERCADO_LIVRE_OUTBOUND_CATEGORY_PREDICTION_INVALID');
  return result.map(item => ({
    domainId: clean(item.domain_id, 160), domainName: clean(item.domain_name, 160),
    categoryId: clean(item.category_id, 160), categoryName: clean(item.category_name, 160),
  })).filter(item => item.categoryId && item.categoryName);
};

export const inspectMercadoLivreOutboundRequirements = async (input: {
  storeId: string; proposalId: string; inspectedByUserId: string;
}): Promise<MercadoLivreOutboundRequirementInspection> => {
  const storeId = input.storeId.trim();
  const proposalId = input.proposalId.trim();
  const inspectedByUserId = input.inspectedByUserId.trim();
  if (!storeId || !proposalId || inspectedByUserId !== storeId) throw new Error('MERCADO_LIVRE_OUTBOUND_REQUIREMENTS_TARGET_INVALID');
  const proposal = await loadProposal(storeId, proposalId);
  await assertCanonicalStillCurrent(proposal);
  const connection = await assertConnectedManualReview(proposal);
  const siteId = await loadSiteId(storeId, connection.externalAccountId);
  const categorySuggestions = await predictionsFor(storeId, siteId, proposal.canonical.name);
  const inspectedAt = new Date().toISOString();
  const inspection: MercadoLivreOutboundRequirementInspection = {
    proposalId, siteId, categorySuggestions, authority: 'provider_api_refetch', inspectedAt,
  };
  await adminDb.doc(`stores/${storeId}/catalogOutboundRequirementInspections/${proposalId}`).set({
    ...inspection,
    connectionId: proposal.connectionId,
    canonicalStoreId: proposal.canonicalStoreId,
    canonicalProductId: proposal.canonicalProductId,
    canonicalBaselineHash: proposal.canonicalBaselineHash,
    inspectedByUserId,
    serverInspectedAt: FieldValue.serverTimestamp(),
  });
  return inspection;
};

const normalizedAttributes = (value: unknown): Array<{ id: string; valueId?: string; valueName?: string }> => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: Array<{ id: string; valueId?: string; valueName?: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const id = clean(record.id, 160);
    const valueId = clean(record.valueId ?? record.value_id, 160);
    const valueName = clean(record.valueName ?? record.value_name, 255);
    if (!id || (!valueId && !valueName) || seen.has(id)) continue;
    seen.add(id);
    result.push({ id, ...(valueId ? { valueId } : {}), ...(valueName ? { valueName } : {}) });
  }
  return result;
};

export const configureMercadoLivreOutboundRequirements = async (input: {
  storeId: string;
  proposalId: string;
  categoryId: unknown;
  listingTypeId: unknown;
  condition: unknown;
  attributes: unknown;
  configuredByUserId: string;
}): Promise<MercadoLivreOutboundRequirementConfiguration> => {
  const storeId = input.storeId.trim();
  const proposalId = input.proposalId.trim();
  const configuredByUserId = input.configuredByUserId.trim();
  const categoryId = clean(input.categoryId, 160);
  const listingTypeId = clean(input.listingTypeId, 120);
  const condition = clean(input.condition, 120);
  if (!storeId || !proposalId || !categoryId || !listingTypeId || !condition || configuredByUserId !== storeId) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_REQUIREMENTS_INPUT_INVALID');
  }

  const proposal = await loadProposal(storeId, proposalId);
  await assertCanonicalStillCurrent(proposal);
  const connection = await assertConnectedManualReview(proposal);
  const siteId = await loadSiteId(storeId, connection.externalAccountId);
  const suggestions = await predictionsFor(storeId, siteId, proposal.canonical.name);
  if (!suggestions.some(item => item.categoryId === categoryId)) throw new Error('MERCADO_LIVRE_OUTBOUND_CATEGORY_NOT_PREDICTED');

  const [category, categoryAttributes, listingTypes] = await Promise.all([
    mercadoLivreGetJson<CategoryDetail>(storeId, `/categories/${encodeURIComponent(categoryId)}`),
    mercadoLivreGetJson<CategoryAttribute[]>(storeId, `/categories/${encodeURIComponent(categoryId)}/attributes`),
    mercadoLivreGetJson<AvailableListingTypesResponse>(storeId, `/users/${encodeURIComponent(connection.externalAccountId)}/available_listing_types?category_id=${encodeURIComponent(categoryId)}`),
  ]);
  if (clean(category.id, 160) !== categoryId || category.settings?.listing_allowed !== true || clean(category.settings?.status, 80) !== 'enabled') throw new Error('MERCADO_LIVRE_OUTBOUND_CATEGORY_NOT_LISTABLE');
  const allowedConditions = stringArray(category.settings?.item_conditions);
  if (!allowedConditions.includes(condition)) throw new Error('MERCADO_LIVRE_OUTBOUND_CONDITION_INVALID');
  const currencies = stringArray(category.settings?.currencies);
  if (currencies.length !== 1) throw new Error('MERCADO_LIVRE_OUTBOUND_CURRENCY_SELECTION_REQUIRED');
  const currencyId = currencies[0];

  const available = Array.isArray(listingTypes.available) ? listingTypes.available : [];
  const selectedListing = available.find(item => item && typeof item === 'object' && !Array.isArray(item) && clean((item as Record<string, unknown>).id, 120) === listingTypeId) as Record<string, unknown> | undefined;
  if (!selectedListing) throw new Error('MERCADO_LIVRE_OUTBOUND_LISTING_TYPE_UNAVAILABLE');
  if (!Array.isArray(categoryAttributes)) throw new Error('MERCADO_LIVRE_OUTBOUND_ATTRIBUTES_INVALID');

  const requiredAttributeIds = categoryAttributes
    .filter(attribute => attribute?.tags?.required === true || (condition === 'new' && attribute?.tags?.new_required === true))
    .map(attribute => clean(attribute.id, 160)).filter(Boolean);
  const conditionalAttributeIds = categoryAttributes
    .filter(attribute => attribute?.tags?.conditional_required === true)
    .map(attribute => clean(attribute.id, 160)).filter(Boolean);
  const attributes = normalizedAttributes(input.attributes);
  const supplied = new Set(attributes.map(attribute => attribute.id));
  const missingRequiredAttributeIds = requiredAttributeIds.filter(id => !supplied.has(id));
  const ready = missingRequiredAttributeIds.length === 0 && conditionalAttributeIds.length === 0;
  const configuredAt = new Date().toISOString();
  const configuration: MercadoLivreOutboundRequirementConfiguration = {
    proposalId,
    siteId,
    category: { id: categoryId, name: clean(category.name, 160) },
    listingType: { id: listingTypeId, name: clean(selectedListing.name, 160) || listingTypeId },
    condition,
    currencyId,
    attributes,
    requiredAttributeIds,
    conditionalAttributeIds,
    missingRequiredAttributeIds,
    ready,
    authority: 'provider_api_refetch_and_store_owner_selection',
    configuredAt,
  };

  const proposalRef = adminDb.doc(`stores/${storeId}/catalogOutboundPublicationProposals/${proposalId}`);
  const canonicalRef = adminDb.doc(`stores/${proposal.canonicalStoreId}/products/${proposal.canonicalProductId}`);
  const configRef = adminDb.doc(`stores/${storeId}/catalogOutboundRequirementConfigurations/${proposalId}`);
  await adminDb.runTransaction(async transaction => {
    const [currentProposalDoc, currentCanonicalDoc] = await Promise.all([
      transaction.get(proposalRef), transaction.get(canonicalRef),
    ]);
    if (!currentProposalDoc.exists) throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_NOT_FOUND');
    const currentProposal = assertProposal(storeId, proposalId, currentProposalDoc.data());
    if (
      currentProposal.canonicalBaselineHash !== proposal.canonicalBaselineHash ||
      !currentCanonicalDoc.exists ||
      !canonicalMatchesProposal(currentProposal, currentCanonicalDoc.data())
    ) throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_STALE');

    transaction.set(configRef, {
      ...configuration,
      connectionId: proposal.connectionId,
      canonicalStoreId: proposal.canonicalStoreId,
      canonicalProductId: proposal.canonicalProductId,
      canonicalBaselineHash: proposal.canonicalBaselineHash,
      configuredByUserId,
      serverConfiguredAt: FieldValue.serverTimestamp(),
    });
    transaction.update(proposalRef, {
      providerSiteId: siteId,
      providerCategoryId: categoryId,
      providerListingTypeId: listingTypeId,
      providerCondition: condition,
      providerCurrencyId: currencyId,
      providerAttributes: attributes,
      requirements: {
        ready,
        missing: [
          ...(missingRequiredAttributeIds.length ? ['required_attributes'] : []),
          ...(conditionalAttributeIds.length ? ['conditional_required_attributes'] : []),
        ],
      },
      requirementAuthority: 'provider_api_refetch_and_store_owner_selection',
      requirementConfiguredAt: configuredAt,
      executionStatus: 'not_authorized',
      serverRequirementConfiguredAt: FieldValue.serverTimestamp(),
    });
  });
  return configuration;
};
