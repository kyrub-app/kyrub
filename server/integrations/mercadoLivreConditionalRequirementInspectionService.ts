import { adminDb } from '../firebaseAdmin.js';
import { buildMercadoLivreInitialPublicationPayload } from './mercadoLivreInitialPublicationPayloadAdapter.js';
import { mercadoLivrePostJson } from './mercadoLivreOauthService.js';
import { assertCurrentMercadoLivrePublicationCapability } from './mercadoLivrePublicationCapabilitySnapshotGuard.js';
import {
  inspectMercadoLivreRequirementCategoryOptions,
  type MercadoLivreRequirementCategoryOptions,
} from './mercadoLivreRequirementOptionsService.js';

interface OutboundProposalRecord {
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
  canonicalBaselineHash: string;
  providerCapabilityFingerprint: string;
  providerPublicationModel: 'legacy_items' | 'user_products';
  providerStockAuthority: 'item_available_quantity';
  providerCapability: unknown;
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

interface ConditionalRequirementResponse {
  required_attributes?: Array<{ id?: unknown; name?: unknown }>;
}

export interface MercadoLivreConditionalInspectionAttribute {
  id: string;
  valueId?: string;
  valueName?: string;
}

export interface MercadoLivreConditionalRequirementInspectionResult {
  proposalId: string;
  categoryId: string;
  condition: string;
  listingTypeId: string;
  suppliedAttributeIds: string[];
  requiredConditionalAttributes: Array<{ id: string; name: string }>;
  missingConditionalAttributeIds: string[];
  conditionalRequirementsSatisfied: boolean;
  authority: 'provider_api_conditional_inspection';
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
    record.schemaVersion !== 2 ||
    clean(record.id, 160) !== proposalId ||
    clean(record.storeId, 160) !== storeId ||
    record.provider !== 'mercado_livre' ||
    record.status !== 'review_required' ||
    record.authority !== 'canonical_kyrub_snapshot' ||
    record.action !== 'create_external_listing' ||
    record.executionStatus !== 'not_authorized' ||
    !clean(record.canonicalStoreId, 160) ||
    !clean(record.connectionId, 200) ||
    !clean(record.canonicalProductId, 160) ||
    !clean(record.canonicalBaselineHash, 80) ||
    !clean(record.providerCapabilityFingerprint, 80) ||
    (record.providerPublicationModel !== 'legacy_items' && record.providerPublicationModel !== 'user_products') ||
    record.providerStockAuthority !== 'item_available_quantity' ||
    !record.providerCapability ||
    !canonical ||
    !clean(canonical.name, 120) ||
    finiteNonNegative(canonical.price) === null ||
    integerNonNegative(canonical.stock) === null
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

const canonicalizeAttributes = (
  options: MercadoLivreRequirementCategoryOptions,
  value: readonly MercadoLivreConditionalInspectionAttribute[]
): MercadoLivreConditionalInspectionAttribute[] => {
  const providerById = new Map(options.attributes.map(attribute => [attribute.id, attribute] as const));
  const seen = new Set<string>();
  const result: MercadoLivreConditionalInspectionAttribute[] = [];
  for (const candidate of value.slice(0, 100)) {
    const id = clean(candidate.id, 160);
    const valueId = clean(candidate.valueId, 160);
    const valueName = clean(candidate.valueName, 600);
    if (!id || seen.has(id)) {
      throw new Error('MERCADO_LIVRE_CONDITIONAL_INSPECTION_ATTRIBUTE_INVALID');
    }
    seen.add(id);
    const providerAttribute = providerById.get(id);
    if (!providerAttribute) {
      throw new Error('MERCADO_LIVRE_CONDITIONAL_INSPECTION_ATTRIBUTE_STALE');
    }
    if (providerAttribute.values.length > 0) {
      const providerValue = valueId
        ? providerAttribute.values.find(option => option.id === valueId)
        : providerAttribute.values.find(option => option.name === valueName);
      if (!providerValue || (valueName && providerValue.name !== valueName)) {
        throw new Error('MERCADO_LIVRE_CONDITIONAL_INSPECTION_VALUE_STALE');
      }
      result.push({
        id,
        ...(providerValue.id ? { valueId: providerValue.id } : {}),
        valueName: providerValue.name,
      });
      continue;
    }
    if (!valueName) {
      throw new Error('MERCADO_LIVRE_CONDITIONAL_INSPECTION_VALUE_REQUIRED');
    }
    result.push({ id, valueName });
  }
  if (value.length > 100) {
    throw new Error('MERCADO_LIVRE_CONDITIONAL_INSPECTION_ATTRIBUTE_LIMIT_EXCEEDED');
  }
  return result;
};

const assertBaseRequirementsSatisfied = (
  options: MercadoLivreRequirementCategoryOptions,
  condition: string,
  attributes: readonly MercadoLivreConditionalInspectionAttribute[]
): void => {
  const supplied = new Set(attributes.map(attribute => attribute.id));
  const missing = options.attributes
    .filter(attribute => attribute.required || (condition === 'new' && attribute.newRequired))
    .map(attribute => attribute.id)
    .filter(id => !supplied.has(id));
  if (missing.length > 0) {
    throw new Error(`MERCADO_LIVRE_CONDITIONAL_INSPECTION_BASE_REQUIRED_MISSING:${missing.join(',')}`);
  }
};

const normalizeRequiredConditionalAttributes = (
  value: unknown,
  options: MercadoLivreRequirementCategoryOptions
): Array<{ id: string; name: string }> => {
  if (!Array.isArray(value)) return [];
  const providerById = new Map(options.attributes.map(attribute => [attribute.id, attribute] as const));
  const seen = new Set<string>();
  const result: Array<{ id: string; name: string }> = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const raw = candidate as Record<string, unknown>;
    const id = clean(raw.id, 160);
    if (!id || seen.has(id)) continue;
    const providerAttribute = providerById.get(id);
    if (!providerAttribute) {
      throw new Error('MERCADO_LIVRE_CONDITIONAL_INSPECTION_PROVIDER_ATTRIBUTE_UNKNOWN');
    }
    seen.add(id);
    result.push({ id, name: clean(raw.name, 255) || providerAttribute.name || id });
  }
  return result;
};

export const inspectMercadoLivreConditionalRequirements = async (input: {
  storeId: string;
  proposalId: string;
  categoryId: string;
  categoryName: string;
  condition: string;
  listingTypeId: string;
  listingTypeName: string;
  attributes: readonly MercadoLivreConditionalInspectionAttribute[];
  requestedByUserId: string;
}): Promise<MercadoLivreConditionalRequirementInspectionResult> => {
  const storeId = clean(input.storeId, 160);
  const proposalId = clean(input.proposalId, 180);
  const categoryId = clean(input.categoryId, 160);
  const categoryName = clean(input.categoryName, 180);
  const condition = clean(input.condition, 120);
  const listingTypeId = clean(input.listingTypeId, 120);
  const listingTypeName = clean(input.listingTypeName, 180);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  if (
    !storeId || !proposalId || !categoryId || !categoryName || !condition ||
    !listingTypeId || !listingTypeName || requestedByUserId !== storeId
  ) {
    throw new Error('MERCADO_LIVRE_CONDITIONAL_INSPECTION_TARGET_INVALID');
  }

  const proposalDoc = await adminDb.doc(
    `stores/${storeId}/catalogOutboundPublicationProposals/${proposalId}`
  ).get();
  if (!proposalDoc.exists) throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_NOT_FOUND');
  const proposal = assertProposal(storeId, proposalId, proposalDoc.data());

  await assertCurrentMercadoLivrePublicationCapability({
    storeId,
    connectionId: proposal.connectionId,
    requestedByUserId,
    expectedSnapshot: proposal.providerCapability,
  });

  const options = await inspectMercadoLivreRequirementCategoryOptions({
    storeId,
    proposalId,
    categoryId,
    categoryName,
    requestedByUserId,
  });
  if (!options.conditions.includes(condition)) {
    throw new Error('MERCADO_LIVRE_CONDITIONAL_INSPECTION_CONDITION_STALE');
  }
  const listingType = options.listingTypes.find(option => option.id === listingTypeId);
  if (!listingType || listingType.name !== listingTypeName) {
    throw new Error('MERCADO_LIVRE_CONDITIONAL_INSPECTION_LISTING_TYPE_STALE');
  }
  if (options.currencies.length !== 1) {
    throw new Error('MERCADO_LIVRE_CONDITIONAL_INSPECTION_CURRENCY_SELECTION_REQUIRED');
  }

  const attributes = canonicalizeAttributes(options, input.attributes);
  assertBaseRequirementsSatisfied(options, condition, attributes);

  const canonicalDoc = await adminDb.doc(
    `stores/${proposal.canonicalStoreId}/products/${proposal.canonicalProductId}`
  ).get();
  if (!canonicalDoc.exists || !canonicalMatchesProposal(proposal, canonicalDoc.data())) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_STALE');
  }

  const payload = buildMercadoLivreInitialPublicationPayload({
    publicationModel: proposal.providerPublicationModel,
    stockAuthority: proposal.providerStockAuthority,
    name: proposal.canonical.name,
    categoryId,
    price: proposal.canonical.price,
    currencyId: options.currencies[0],
    availableQuantity: proposal.canonical.stock,
    listingTypeId,
    condition,
    pictureUrl: proposal.canonical.image,
    attributes,
  });

  const providerResult = await mercadoLivrePostJson<ConditionalRequirementResponse>(
    storeId,
    `/categories/${encodeURIComponent(categoryId)}/attributes/conditional`,
    payload
  );
  const requiredConditionalAttributes = normalizeRequiredConditionalAttributes(
    providerResult.required_attributes,
    options
  );
  const supplied = new Set(attributes.map(attribute => attribute.id));
  const missingConditionalAttributeIds = requiredConditionalAttributes
    .map(attribute => attribute.id)
    .filter(id => !supplied.has(id));

  return {
    proposalId,
    categoryId,
    condition,
    listingTypeId,
    suppliedAttributeIds: attributes.map(attribute => attribute.id),
    requiredConditionalAttributes,
    missingConditionalAttributeIds,
    conditionalRequirementsSatisfied: missingConditionalAttributeIds.length === 0,
    authority: 'provider_api_conditional_inspection',
    inspectedAt: new Date().toISOString(),
  };
};
