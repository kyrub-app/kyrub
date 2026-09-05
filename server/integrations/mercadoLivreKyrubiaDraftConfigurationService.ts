import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { assertCurrentMercadoLivrePublicationCapability } from './mercadoLivrePublicationCapabilitySnapshotGuard.js';
import {
  inspectMercadoLivreConditionalRequirements,
  type MercadoLivreConditionalInspectionAttribute,
  type MercadoLivreConditionalRequirementInspectionResult,
} from './mercadoLivreConditionalRequirementInspectionService.js';
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

export interface MercadoLivreKyrubiaDraftConfigurationAttribute {
  id: string;
  name?: string;
  valueId?: string;
  valueName: string;
}

export interface MercadoLivreKyrubiaDraftConfigurationResult {
  proposalId: string;
  category: { id: string; name: string };
  listingType: { id: string; name: string };
  condition: string;
  currencyId: string;
  attributes: Array<{ id: string; valueId?: string; valueName: string }>;
  requiredAttributeIds: string[];
  conditionalAttributeIds: string[];
  providerConditionalAttributeFlagIds: string[];
  ready: true;
  executionStatus: 'not_authorized';
  configuredAt: string;
  conditionalValidatedAt: string;
  idempotent: boolean;
  authority: 'provider_api_refetch_and_store_owner_selection';
  conditionalAuthority: 'provider_api_conditional_validation';
}

type CanonicalAttribute = {
  id: string;
  name: string;
  valueId?: string;
  valueName: string;
};

const MAX_ATTRIBUTES = 40;

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

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

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
  value: readonly MercadoLivreKyrubiaDraftConfigurationAttribute[]
): CanonicalAttribute[] => {
  if (value.length > MAX_ATTRIBUTES) {
    throw new Error('MERCADO_LIVRE_KYRUBIA_DRAFT_ATTRIBUTE_LIMIT_EXCEEDED');
  }
  const providerById = new Map(options.attributes.map(attribute => [attribute.id, attribute] as const));
  const seen = new Set<string>();
  const result: CanonicalAttribute[] = [];
  for (const candidate of value) {
    const id = clean(candidate.id, 160);
    const valueId = clean(candidate.valueId, 160);
    const valueName = clean(candidate.valueName, 600);
    if (!id || !valueName || seen.has(id)) {
      throw new Error('MERCADO_LIVRE_KYRUBIA_DRAFT_ATTRIBUTE_INVALID');
    }
    seen.add(id);
    const providerAttribute = providerById.get(id);
    if (!providerAttribute) {
      throw new Error('MERCADO_LIVRE_KYRUBIA_DRAFT_ATTRIBUTE_STALE');
    }
    const suppliedName = clean(candidate.name, 255);
    if (suppliedName && suppliedName !== providerAttribute.name) {
      throw new Error('MERCADO_LIVRE_KYRUBIA_DRAFT_ATTRIBUTE_NAME_STALE');
    }
    if (providerAttribute.values.length > 0) {
      const providerValue = valueId
        ? providerAttribute.values.find(option => option.id === valueId)
        : providerAttribute.values.find(option => normalize(option.name) === normalize(valueName));
      if (!providerValue || (valueName && providerValue.name !== valueName)) {
        throw new Error('MERCADO_LIVRE_KYRUBIA_DRAFT_ATTRIBUTE_VALUE_STALE');
      }
      result.push({
        id,
        name: providerAttribute.name,
        ...(providerValue.id ? { valueId: providerValue.id } : {}),
        valueName: providerValue.name,
      });
      continue;
    }
    result.push({ id, name: providerAttribute.name, valueName });
  }
  return result;
};

const toInspectionAttributes = (
  attributes: readonly CanonicalAttribute[]
): MercadoLivreConditionalInspectionAttribute[] =>
  attributes.map(attribute => ({
    id: attribute.id,
    ...(attribute.valueId ? { valueId: attribute.valueId } : {}),
    valueName: attribute.valueName,
  }));

const inspectConditional = (input: {
  storeId: string;
  proposalId: string;
  categoryId: string;
  categoryName: string;
  condition: string;
  listingTypeId: string;
  listingTypeName: string;
  attributes: readonly CanonicalAttribute[];
  requestedByUserId: string;
}): Promise<MercadoLivreConditionalRequirementInspectionResult> =>
  inspectMercadoLivreConditionalRequirements({
    storeId: input.storeId,
    proposalId: input.proposalId,
    categoryId: input.categoryId,
    categoryName: input.categoryName,
    condition: input.condition,
    listingTypeId: input.listingTypeId,
    listingTypeName: input.listingTypeName,
    attributes: toInspectionAttributes(input.attributes),
    requestedByUserId: input.requestedByUserId,
  });

const recoverProviderRequiredAttributes = async (input: {
  storeId: string;
  proposalId: string;
  categoryId: string;
  categoryName: string;
  condition: string;
  listingTypeId: string;
  listingTypeName: string;
  options: MercadoLivreRequirementCategoryOptions;
  attributes: CanonicalAttribute[];
  requestedByUserId: string;
}): Promise<{
  collected: CanonicalAttribute[];
  conditionalAttributeIds: string[];
  requiredConditionalAttributes: Array<{ id: string; name: string }>;
  inspection: MercadoLivreConditionalRequirementInspectionResult;
}> => {
  const baseRequired = input.options.attributes.filter(attribute =>
    attribute.required || (input.condition === 'new' && attribute.newRequired)
  );
  const baseIds = new Set(baseRequired.map(attribute => attribute.id));
  const suppliedById = new Map(input.attributes.map(attribute => [attribute.id, attribute] as const));
  const missingBase = baseRequired
    .map(attribute => attribute.id)
    .filter(id => !suppliedById.has(id));
  if (missingBase.length > 0) {
    throw new Error(`MERCADO_LIVRE_KYRUBIA_DRAFT_BASE_REQUIRED_MISSING:${missingBase.join(',')}`);
  }

  const collected = input.attributes.filter(attribute => baseIds.has(attribute.id));
  const remaining = new Map(
    input.attributes
      .filter(attribute => !baseIds.has(attribute.id))
      .map(attribute => [attribute.id, attribute] as const)
  );
  const conditionalIds = new Set<string>();
  const conditionalNames = new Map<string, string>();

  let inspection = await inspectConditional({
    ...input,
    attributes: collected,
  });

  const rememberProviderRequirements = (): void => {
    for (const attribute of inspection.requiredConditionalAttributes) {
      if (baseIds.has(attribute.id)) continue;
      conditionalIds.add(attribute.id);
      conditionalNames.set(attribute.id, attribute.name);
    }
  };
  rememberProviderRequirements();

  for (let round = 0; round <= MAX_ATTRIBUTES && remaining.size > 0; round += 1) {
    const currentlyMissing = new Set(inspection.missingConditionalAttributeIds);
    const recoverable = [...remaining.values()].filter(attribute => currentlyMissing.has(attribute.id));
    if (recoverable.length === 0) break;
    for (const attribute of recoverable) {
      collected.push(attribute);
      remaining.delete(attribute.id);
      conditionalIds.add(attribute.id);
      conditionalNames.set(attribute.id, attribute.name);
    }
    inspection = await inspectConditional({
      ...input,
      attributes: collected,
    });
    rememberProviderRequirements();
  }

  if (remaining.size > 0) {
    throw new Error(
      `MERCADO_LIVRE_KYRUBIA_DRAFT_UNAUTHORIZED_ATTRIBUTE:${[...remaining.keys()].join(',')}`
    );
  }
  if (!inspection.conditionalRequirementsSatisfied || inspection.missingConditionalAttributeIds.length > 0) {
    throw new Error(
      `MERCADO_LIVRE_KYRUBIA_DRAFT_CONDITIONAL_REQUIRED_MISSING:${inspection.missingConditionalAttributeIds.join(',')}`
    );
  }

  return {
    collected,
    conditionalAttributeIds: [...conditionalIds],
    requiredConditionalAttributes: [...conditionalIds].map(id => ({
      id,
      name: conditionalNames.get(id) || input.options.attributes.find(attribute => attribute.id === id)?.name || id,
    })),
    inspection,
  };
};

const stableAttributes = (
  attributes: readonly CanonicalAttribute[]
): Array<{ id: string; valueId?: string; valueName: string }> =>
  attributes
    .map(attribute => ({
      id: attribute.id,
      ...(attribute.valueId ? { valueId: attribute.valueId } : {}),
      valueName: attribute.valueName,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

const stableStrings = (values: readonly string[]): string[] =>
  [...new Set(values.map(value => clean(value, 160)).filter(Boolean))].sort();

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const configurationMatches = (input: {
  value: unknown;
  proposal: OutboundProposalRecord;
  categoryId: string;
  categoryName: string;
  listingTypeId: string;
  listingTypeName: string;
  condition: string;
  currencyId: string;
  attributes: Array<{ id: string; valueId?: string; valueName: string }>;
  requiredAttributeIds: string[];
  conditionalAttributeIds: string[];
}): { configuredAt: string } | null => {
  if (!input.value || typeof input.value !== 'object' || Array.isArray(input.value)) return null;
  const record = input.value as Record<string, unknown>;
  const category = record.category && typeof record.category === 'object' && !Array.isArray(record.category)
    ? record.category as Record<string, unknown>
    : {};
  const listingType = record.listingType && typeof record.listingType === 'object' && !Array.isArray(record.listingType)
    ? record.listingType as Record<string, unknown>
    : {};
  const configuredAt = clean(record.configuredAt, 80);
  const rawAttributes = Array.isArray(record.attributes)
    ? record.attributes.flatMap(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const raw = item as Record<string, unknown>;
        const id = clean(raw.id, 160);
        const valueId = clean(raw.valueId, 160);
        const valueName = clean(raw.valueName, 600);
        return id && valueName
          ? [{ id, ...(valueId ? { valueId } : {}), valueName }]
          : [];
      }).sort((left, right) => left.id.localeCompare(right.id))
    : [];
  if (
    !configuredAt ||
    clean(record.proposalId, 180) !== input.proposal.id ||
    clean(record.canonicalBaselineHash, 80) !== input.proposal.canonicalBaselineHash ||
    clean(record.providerCapabilityFingerprint, 80) !== input.proposal.providerCapabilityFingerprint ||
    record.authority !== 'provider_api_refetch_and_store_owner_selection' ||
    record.configurationSource !== 'kyrubia_revalidated_session' ||
    record.ready !== true ||
    clean(category.id, 160) !== input.categoryId ||
    clean(category.name, 180) !== input.categoryName ||
    clean(listingType.id, 120) !== input.listingTypeId ||
    clean(listingType.name, 180) !== input.listingTypeName ||
    clean(record.condition, 120) !== input.condition ||
    clean(record.currencyId, 16) !== input.currencyId ||
    !sameJson(rawAttributes, input.attributes) ||
    !sameJson(stableStrings(Array.isArray(record.requiredAttributeIds) ? record.requiredAttributeIds as string[] : []), stableStrings(input.requiredAttributeIds)) ||
    !sameJson(stableStrings(Array.isArray(record.conditionalAttributeIds) ? record.conditionalAttributeIds as string[] : []), stableStrings(input.conditionalAttributeIds)) ||
    (Array.isArray(record.missingRequiredAttributeIds) ? record.missingRequiredAttributeIds.length : -1) !== 0
  ) return null;
  return { configuredAt };
};

const conditionalValidationMatches = (input: {
  value: unknown;
  proposal: OutboundProposalRecord;
  requirementConfiguredAt: string;
  requiredConditionalAttributes: Array<{ id: string; name: string }>;
}): { validatedAt: string } | null => {
  if (!input.value || typeof input.value !== 'object' || Array.isArray(input.value)) return null;
  const record = input.value as Record<string, unknown>;
  const validatedAt = clean(record.validatedAt, 80);
  const required = Array.isArray(record.requiredConditionalAttributes)
    ? record.requiredConditionalAttributes.flatMap(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const raw = item as Record<string, unknown>;
        const id = clean(raw.id, 160);
        const name = clean(raw.name, 255);
        return id ? [{ id, name: name || id }] : [];
      }).sort((left, right) => left.id.localeCompare(right.id))
    : [];
  const expectedRequired = [...input.requiredConditionalAttributes].sort((left, right) => left.id.localeCompare(right.id));
  if (
    !validatedAt ||
    clean(record.proposalId, 180) !== input.proposal.id ||
    clean(record.canonicalBaselineHash, 80) !== input.proposal.canonicalBaselineHash ||
    clean(record.providerCapabilityFingerprint, 80) !== input.proposal.providerCapabilityFingerprint ||
    clean(record.requirementConfiguredAt, 80) !== input.requirementConfiguredAt ||
    record.authority !== 'provider_api_conditional_validation' ||
    record.validationSource !== 'preconfiguration_provider_api_conditional_inspection' ||
    record.ready !== true ||
    !sameJson(required, expectedRequired) ||
    (Array.isArray(record.missingConditionalAttributeIds) ? record.missingConditionalAttributeIds.length : -1) !== 0 ||
    (Array.isArray(record.missingRequiredAttributeIds) ? record.missingRequiredAttributeIds.length : -1) !== 0
  ) return null;
  return { validatedAt };
};

export const configureKyrubiaMercadoLivreDraftRequirements = async (input: {
  storeId: string;
  proposalId: string;
  categoryId: string;
  categoryName: string;
  condition: string;
  listingTypeId: string;
  listingTypeName: string;
  attributes: readonly MercadoLivreKyrubiaDraftConfigurationAttribute[];
  configuredByUserId: string;
}): Promise<MercadoLivreKyrubiaDraftConfigurationResult> => {
  const storeId = clean(input.storeId, 160);
  const proposalId = clean(input.proposalId, 180);
  const categoryId = clean(input.categoryId, 160);
  const categoryName = clean(input.categoryName, 180);
  const condition = clean(input.condition, 120);
  const listingTypeId = clean(input.listingTypeId, 120);
  const listingTypeName = clean(input.listingTypeName, 180);
  const configuredByUserId = clean(input.configuredByUserId, 160);
  if (
    !storeId || !proposalId || !categoryId || !categoryName || !condition ||
    !listingTypeId || !listingTypeName || configuredByUserId !== storeId
  ) {
    throw new Error('MERCADO_LIVRE_KYRUBIA_DRAFT_CONFIGURATION_TARGET_INVALID');
  }

  const proposalRef = adminDb.doc(`stores/${storeId}/catalogOutboundPublicationProposals/${proposalId}`);
  const proposalDoc = await proposalRef.get();
  if (!proposalDoc.exists) throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_NOT_FOUND');
  const proposal = assertProposal(storeId, proposalId, proposalDoc.data());

  await assertCurrentMercadoLivrePublicationCapability({
    storeId,
    connectionId: proposal.connectionId,
    requestedByUserId: configuredByUserId,
    expectedSnapshot: proposal.providerCapability,
  });

  const options = await inspectMercadoLivreRequirementCategoryOptions({
    storeId,
    proposalId,
    categoryId,
    categoryName,
    requestedByUserId: configuredByUserId,
  });
  if (!options.conditions.includes(condition)) {
    throw new Error('MERCADO_LIVRE_KYRUBIA_DRAFT_CONDITION_STALE');
  }
  const listingType = options.listingTypes.find(option => option.id === listingTypeId);
  if (!listingType || listingType.name !== listingTypeName) {
    throw new Error('MERCADO_LIVRE_KYRUBIA_DRAFT_LISTING_TYPE_STALE');
  }
  if (options.currencies.length !== 1) {
    throw new Error('MERCADO_LIVRE_KYRUBIA_DRAFT_CURRENCY_SELECTION_REQUIRED');
  }
  const currencyId = options.currencies[0];
  const attributes = canonicalizeAttributes(options, input.attributes);
  const providerState = await recoverProviderRequiredAttributes({
    storeId,
    proposalId,
    categoryId,
    categoryName,
    condition,
    listingTypeId,
    listingTypeName,
    options,
    attributes,
    requestedByUserId: configuredByUserId,
  });
  const persistentAttributes = stableAttributes(providerState.collected);
  const requiredAttributeIds = options.attributes
    .filter(attribute => attribute.required || (condition === 'new' && attribute.newRequired))
    .map(attribute => attribute.id);
  const conditionalAttributeIds = providerState.conditionalAttributeIds;
  const providerConditionalAttributeFlagIds = options.attributes
    .filter(attribute => attribute.conditionalRequired)
    .map(attribute => attribute.id);
  const configuredAtCandidate = new Date().toISOString();
  const conditionalValidatedAtCandidate = new Date().toISOString();

  const canonicalRef = adminDb.doc(`stores/${proposal.canonicalStoreId}/products/${proposal.canonicalProductId}`);
  const configRef = adminDb.doc(`stores/${storeId}/catalogOutboundRequirementConfigurations/${proposalId}`);
  const conditionalRef = adminDb.doc(`stores/${storeId}/catalogOutboundConditionalValidations/${proposalId}`);

  let configuredAt = configuredAtCandidate;
  let conditionalValidatedAt = conditionalValidatedAtCandidate;
  let idempotent = false;

  await adminDb.runTransaction(async transaction => {
    const [currentProposalDoc, currentCanonicalDoc, existingConfigDoc, existingConditionalDoc] = await Promise.all([
      transaction.get(proposalRef),
      transaction.get(canonicalRef),
      transaction.get(configRef),
      transaction.get(conditionalRef),
    ]);
    if (!currentProposalDoc.exists) throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_NOT_FOUND');
    const currentProposal = assertProposal(storeId, proposalId, currentProposalDoc.data());
    if (
      currentProposal.canonicalBaselineHash !== proposal.canonicalBaselineHash ||
      currentProposal.providerCapabilityFingerprint !== proposal.providerCapabilityFingerprint ||
      !currentCanonicalDoc.exists ||
      !canonicalMatchesProposal(currentProposal, currentCanonicalDoc.data())
    ) {
      throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_STALE');
    }

    if (existingConfigDoc.exists || existingConditionalDoc.exists) {
      if (!existingConfigDoc.exists || !existingConditionalDoc.exists) {
        throw new Error('MERCADO_LIVRE_KYRUBIA_DRAFT_CONFIGURATION_CONFLICT');
      }
      const matchingConfiguration = configurationMatches({
        value: existingConfigDoc.data(),
        proposal: currentProposal,
        categoryId,
        categoryName,
        listingTypeId,
        listingTypeName,
        condition,
        currencyId,
        attributes: persistentAttributes,
        requiredAttributeIds,
        conditionalAttributeIds,
      });
      if (!matchingConfiguration) {
        throw new Error('MERCADO_LIVRE_KYRUBIA_DRAFT_CONFIGURATION_CONFLICT');
      }
      const matchingConditional = conditionalValidationMatches({
        value: existingConditionalDoc.data(),
        proposal: currentProposal,
        requirementConfiguredAt: matchingConfiguration.configuredAt,
        requiredConditionalAttributes: providerState.requiredConditionalAttributes,
      });
      if (!matchingConditional) {
        throw new Error('MERCADO_LIVRE_KYRUBIA_DRAFT_CONFIGURATION_CONFLICT');
      }
      configuredAt = matchingConfiguration.configuredAt;
      conditionalValidatedAt = matchingConditional.validatedAt;
      idempotent = true;
      return;
    }

    const currentProposalRaw = currentProposalDoc.data() as Record<string, unknown>;
    if (
      clean(currentProposalRaw.requirementConfiguredAt, 80) ||
      Array.isArray(currentProposalRaw.providerAttributes) ||
      currentProposalRaw.executionStatus !== 'not_authorized'
    ) {
      throw new Error('MERCADO_LIVRE_KYRUBIA_DRAFT_CONFIGURATION_CONFLICT');
    }

    transaction.create(configRef, {
      schemaVersion: 2,
      proposalId,
      siteId: options.siteId,
      category: { id: categoryId, name: categoryName },
      listingType: { id: listingTypeId, name: listingTypeName },
      condition,
      currencyId,
      attributes: persistentAttributes,
      requiredAttributeIds,
      conditionalAttributeIds,
      providerConditionalAttributeFlagIds,
      missingRequiredAttributeIds: [],
      ready: true,
      authority: 'provider_api_refetch_and_store_owner_selection',
      configurationSource: 'kyrubia_revalidated_session',
      conditionalInspectionAuthority: providerState.inspection.authority,
      conditionalInspectedAt: providerState.inspection.inspectedAt,
      configuredAt,
      connectionId: proposal.connectionId,
      canonicalStoreId: proposal.canonicalStoreId,
      canonicalProductId: proposal.canonicalProductId,
      canonicalBaselineHash: proposal.canonicalBaselineHash,
      providerCapabilityFingerprint: proposal.providerCapabilityFingerprint,
      providerPublicationModel: proposal.providerPublicationModel,
      providerStockAuthority: proposal.providerStockAuthority,
      configuredByUserId,
      serverConfiguredAt: FieldValue.serverTimestamp(),
    });

    transaction.create(conditionalRef, {
      schemaVersion: 2,
      proposalId,
      requiredConditionalAttributes: providerState.requiredConditionalAttributes,
      missingConditionalAttributeIds: [],
      missingRequiredAttributeIds: [],
      ready: true,
      authority: 'provider_api_conditional_validation',
      validationSource: 'preconfiguration_provider_api_conditional_inspection',
      inspectionAuthority: providerState.inspection.authority,
      providerInspectedAt: providerState.inspection.inspectedAt,
      validatedAt: conditionalValidatedAt,
      requirementConfiguredAt: configuredAt,
      connectionId: proposal.connectionId,
      canonicalStoreId: proposal.canonicalStoreId,
      canonicalProductId: proposal.canonicalProductId,
      canonicalBaselineHash: proposal.canonicalBaselineHash,
      providerCapabilityFingerprint: proposal.providerCapabilityFingerprint,
      providerPublicationModel: proposal.providerPublicationModel,
      providerStockAuthority: proposal.providerStockAuthority,
      validatedByUserId: configuredByUserId,
      serverValidatedAt: FieldValue.serverTimestamp(),
    });

    transaction.update(proposalRef, {
      providerSiteId: options.siteId,
      providerCategoryId: categoryId,
      providerListingTypeId: listingTypeId,
      providerCondition: condition,
      providerCurrencyId: currencyId,
      providerAttributes: persistentAttributes,
      requirements: { ready: true, missing: [] },
      requirementAuthority: 'provider_api_refetch_and_store_owner_selection',
      requirementConfigurationSource: 'kyrubia_revalidated_session',
      requirementConfiguredAt: configuredAt,
      conditionalRequirementAuthority: 'provider_api_conditional_validation',
      conditionalRequirementValidationSource: 'preconfiguration_provider_api_conditional_inspection',
      conditionalRequirementValidatedAt: conditionalValidatedAt,
      requiredConditionalAttributes: providerState.requiredConditionalAttributes,
      missingConditionalAttributeIds: [],
      publicationReadiness: FieldValue.delete(),
      publicationReadinessAuthority: FieldValue.delete(),
      publicationValidatedAt: FieldValue.delete(),
      publicationValidationCauses: FieldValue.delete(),
      executionStatus: 'not_authorized',
      serverRequirementConfiguredAt: FieldValue.serverTimestamp(),
      serverConditionalRequirementValidatedAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    proposalId,
    category: { id: categoryId, name: categoryName },
    listingType: { id: listingTypeId, name: listingTypeName },
    condition,
    currencyId,
    attributes: persistentAttributes,
    requiredAttributeIds,
    conditionalAttributeIds,
    providerConditionalAttributeFlagIds,
    ready: true,
    executionStatus: 'not_authorized',
    configuredAt,
    conditionalValidatedAt,
    idempotent,
    authority: 'provider_api_refetch_and_store_owner_selection',
    conditionalAuthority: 'provider_api_conditional_validation',
  };
};