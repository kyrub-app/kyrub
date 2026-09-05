import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { buildMercadoLivreInitialPublicationPayload } from './mercadoLivreInitialPublicationPayloadAdapter.js';
import { mercadoLivreValidateJson } from './mercadoLivreOauthService.js';
import { mercadoLivrePublicationCorrelationMarker } from './mercadoLivrePublicationCorrelation.js';
import { assertCurrentMercadoLivrePublicationCapability } from './mercadoLivrePublicationCapabilitySnapshotGuard.js';

interface ProposalRecord {
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
  providerSiteId: string;
  providerCategoryId: string;
  providerListingTypeId: string;
  providerCondition: string;
  providerCurrencyId: string;
  executionStatus: 'not_authorized';
}

type ConfigurationAttribute = {
  id: string;
  valueId?: string;
  valueName: string;
};

interface ConfigurationRecord {
  schemaVersion: 2;
  proposalId: string;
  siteId: string;
  category: { id: string; name: string };
  listingType: { id: string; name: string };
  condition: string;
  currencyId: string;
  attributes: ConfigurationAttribute[];
  requiredAttributeIds: string[];
  conditionalAttributeIds: string[];
  missingRequiredAttributeIds: string[];
  ready: true;
  authority: 'provider_api_refetch_and_store_owner_selection';
  configurationSource: 'kyrubia_revalidated_session';
  configuredAt: string;
  connectionId: string;
  canonicalStoreId: string;
  canonicalProductId: string;
  canonicalBaselineHash: string;
  providerCapabilityFingerprint: string;
  providerPublicationModel: 'legacy_items' | 'user_products';
  providerStockAuthority: 'item_available_quantity';
}

interface ConditionalValidationRecord {
  schemaVersion: 2;
  proposalId: string;
  requiredConditionalAttributes: Array<{ id: string; name: string }>;
  missingConditionalAttributeIds: string[];
  missingRequiredAttributeIds: string[];
  ready: true;
  authority: 'provider_api_conditional_validation';
  validationSource: 'preconfiguration_provider_api_conditional_inspection';
  validatedAt: string;
  requirementConfiguredAt: string;
  connectionId: string;
  canonicalStoreId: string;
  canonicalProductId: string;
  canonicalBaselineHash: string;
  providerCapabilityFingerprint: string;
  providerPublicationModel: 'legacy_items' | 'user_products';
  providerStockAuthority: 'item_available_quantity';
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

const normalizedStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of value) {
    const normalized = clean(candidate, 160);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result.sort();
};

const normalizeAttributes = (value: unknown): ConfigurationAttribute[] => {
  if (!Array.isArray(value) || value.length > 40) {
    throw new Error('MERCADO_LIVRE_KYRUBIA_LISTING_VALIDATION_CONFIGURATION_INVALID');
  }
  const seen = new Set<string>();
  const attributes: ConfigurationAttribute[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('MERCADO_LIVRE_KYRUBIA_LISTING_VALIDATION_CONFIGURATION_INVALID');
    }
    const raw = candidate as Record<string, unknown>;
    const id = clean(raw.id, 160);
    const valueId = clean(raw.valueId, 160);
    const valueName = clean(raw.valueName, 600);
    if (!id || !valueName || seen.has(id)) {
      throw new Error('MERCADO_LIVRE_KYRUBIA_LISTING_VALIDATION_CONFIGURATION_INVALID');
    }
    seen.add(id);
    attributes.push({ id, ...(valueId ? { valueId } : {}), valueName });
  }
  return attributes.sort((left, right) => left.id.localeCompare(right.id));
};

const normalizeRequiredConditionalAttributes = (
  value: unknown
): Array<{ id: string; name: string }> => {
  if (!Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_KYRUBIA_LISTING_VALIDATION_CONDITIONAL_INVALID');
  }
  const seen = new Set<string>();
  const result: Array<{ id: string; name: string }> = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('MERCADO_LIVRE_KYRUBIA_LISTING_VALIDATION_CONDITIONAL_INVALID');
    }
    const raw = candidate as Record<string, unknown>;
    const id = clean(raw.id, 160);
    const name = clean(raw.name, 255) || id;
    if (!id || seen.has(id)) {
      throw new Error('MERCADO_LIVRE_KYRUBIA_LISTING_VALIDATION_CONDITIONAL_INVALID');
    }
    seen.add(id);
    result.push({ id, name });
  }
  return result.sort((left, right) => left.id.localeCompare(right.id));
};

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const assertProposal = (
  storeId: string,
  proposalId: string,
  value: unknown
): ProposalRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_NOT_FOUND');
  }
  const record = value as Record<string, unknown>;
  const canonical = record.canonical && typeof record.canonical === 'object' && !Array.isArray(record.canonical)
    ? record.canonical as Record<string, unknown>
    : null;
  if (
    record.schemaVersion !== 2 ||
    clean(record.id, 180) !== proposalId ||
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
    integerNonNegative(canonical.stock) === null ||
    !clean(record.providerSiteId, 16) ||
    !clean(record.providerCategoryId, 160) ||
    !clean(record.providerListingTypeId, 120) ||
    !clean(record.providerCondition, 120) ||
    !clean(record.providerCurrencyId, 16)
  ) {
    throw new Error('MERCADO_LIVRE_KYRUBIA_LISTING_VALIDATION_PROPOSAL_INVALID');
  }
  return record as unknown as ProposalRecord;
};

const assertConfiguration = (
  proposal: ProposalRecord,
  value: unknown
): ConfigurationRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_KYRUBIA_LISTING_VALIDATION_CONFIGURATION_REQUIRED');
  }
  const record = value as Record<string, unknown>;
  const category = record.category && typeof record.category === 'object' && !Array.isArray(record.category)
    ? record.category as Record<string, unknown>
    : null;
  const listingType = record.listingType && typeof record.listingType === 'object' && !Array.isArray(record.listingType)
    ? record.listingType as Record<string, unknown>
    : null;
  const attributes = normalizeAttributes(record.attributes);
  const requiredAttributeIds = normalizedStringArray(record.requiredAttributeIds);
  const conditionalAttributeIds = normalizedStringArray(record.conditionalAttributeIds);
  const missingRequiredAttributeIds = normalizedStringArray(record.missingRequiredAttributeIds);
  if (
    record.schemaVersion !== 2 ||
    clean(record.proposalId, 180) !== proposal.id ||
    clean(record.siteId, 16) !== proposal.providerSiteId ||
    !category || clean(category.id, 160) !== proposal.providerCategoryId || !clean(category.name, 180) ||
    !listingType || clean(listingType.id, 120) !== proposal.providerListingTypeId || !clean(listingType.name, 180) ||
    clean(record.condition, 120) !== proposal.providerCondition ||
    clean(record.currencyId, 16) !== proposal.providerCurrencyId ||
    record.ready !== true ||
    record.authority !== 'provider_api_refetch_and_store_owner_selection' ||
    record.configurationSource !== 'kyrubia_revalidated_session' ||
    !clean(record.configuredAt, 80) ||
    clean(record.connectionId, 200) !== proposal.connectionId ||
    clean(record.canonicalStoreId, 160) !== proposal.canonicalStoreId ||
    clean(record.canonicalProductId, 160) !== proposal.canonicalProductId ||
    clean(record.canonicalBaselineHash, 80) !== proposal.canonicalBaselineHash ||
    clean(record.providerCapabilityFingerprint, 80) !== proposal.providerCapabilityFingerprint ||
    record.providerPublicationModel !== proposal.providerPublicationModel ||
    record.providerStockAuthority !== proposal.providerStockAuthority ||
    missingRequiredAttributeIds.length !== 0 ||
    attributes.length !== new Set([...requiredAttributeIds, ...conditionalAttributeIds]).size
  ) {
    throw new Error('MERCADO_LIVRE_KYRUBIA_LISTING_VALIDATION_CONFIGURATION_INVALID');
  }
  const expectedIds = [...new Set([...requiredAttributeIds, ...conditionalAttributeIds])].sort();
  const suppliedIds = attributes.map(attribute => attribute.id).sort();
  if (!sameJson(expectedIds, suppliedIds)) {
    throw new Error('MERCADO_LIVRE_KYRUBIA_LISTING_VALIDATION_CONFIGURATION_INVALID');
  }
  return {
    ...(record as unknown as ConfigurationRecord),
    attributes,
    requiredAttributeIds,
    conditionalAttributeIds,
    missingRequiredAttributeIds,
  };
};

const assertConditionalValidation = (
  proposal: ProposalRecord,
  configuration: ConfigurationRecord,
  value: unknown
): ConditionalValidationRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_KYRUBIA_LISTING_VALIDATION_CONDITIONAL_REQUIRED');
  }
  const record = value as Record<string, unknown>;
  const requiredConditionalAttributes = normalizeRequiredConditionalAttributes(record.requiredConditionalAttributes);
  const requiredConditionalIds = requiredConditionalAttributes.map(attribute => attribute.id).sort();
  if (
    record.schemaVersion !== 2 ||
    clean(record.proposalId, 180) !== proposal.id ||
    record.ready !== true ||
    record.authority !== 'provider_api_conditional_validation' ||
    record.validationSource !== 'preconfiguration_provider_api_conditional_inspection' ||
    !clean(record.validatedAt, 80) ||
    clean(record.requirementConfiguredAt, 80) !== configuration.configuredAt ||
    clean(record.connectionId, 200) !== proposal.connectionId ||
    clean(record.canonicalStoreId, 160) !== proposal.canonicalStoreId ||
    clean(record.canonicalProductId, 160) !== proposal.canonicalProductId ||
    clean(record.canonicalBaselineHash, 80) !== proposal.canonicalBaselineHash ||
    clean(record.providerCapabilityFingerprint, 80) !== proposal.providerCapabilityFingerprint ||
    record.providerPublicationModel !== proposal.providerPublicationModel ||
    record.providerStockAuthority !== proposal.providerStockAuthority ||
    normalizedStringArray(record.missingConditionalAttributeIds).length !== 0 ||
    normalizedStringArray(record.missingRequiredAttributeIds).length !== 0 ||
    !sameJson(requiredConditionalIds, [...configuration.conditionalAttributeIds].sort())
  ) {
    throw new Error('MERCADO_LIVRE_KYRUBIA_LISTING_VALIDATION_CONDITIONAL_INVALID');
  }
  return {
    ...(record as unknown as ConditionalValidationRecord),
    requiredConditionalAttributes,
    missingConditionalAttributeIds: [],
    missingRequiredAttributeIds: [],
  };
};

const canonicalMatchesProposal = (
  proposal: ProposalRecord,
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

const providerCauses = (
  value: unknown
): Array<{ code: string; message: string; reference: string }> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const raw = Array.isArray(record.cause) ? record.cause : [];
  return raw
    .filter(item => item && typeof item === 'object' && !Array.isArray(item))
    .map(item => {
      const cause = item as Record<string, unknown>;
      return {
        code: clean(cause.code, 120),
        message: clean(cause.message, 600),
        reference: clean(cause.reference, 240),
      };
    })
    .filter(item => item.code || item.message || item.reference)
    .slice(0, 30);
};

export interface MercadoLivreKyrubiaListingValidationResult {
  proposalId: string;
  status: 'ready_for_owner_authorization' | 'needs_correction';
  providerStatus: number;
  causes: Array<{ code: string; message: string; reference: string }>;
  authority: 'provider_items_validate';
  validationSource: 'kyrubia_revalidated_draft';
  validatedAt: string;
  executionStatus: 'not_authorized';
}

export const validateKyrubiaMercadoLivreDraftListing = async (input: {
  storeId: string;
  proposalId: string;
  validatedByUserId: string;
}): Promise<MercadoLivreKyrubiaListingValidationResult> => {
  const storeId = clean(input.storeId, 160);
  const proposalId = clean(input.proposalId, 180);
  const validatedByUserId = clean(input.validatedByUserId, 160);
  if (!storeId || !proposalId || validatedByUserId !== storeId) {
    throw new Error('MERCADO_LIVRE_KYRUBIA_LISTING_VALIDATION_TARGET_INVALID');
  }

  const proposalRef = adminDb.doc(`stores/${storeId}/catalogOutboundPublicationProposals/${proposalId}`);
  const configRef = adminDb.doc(`stores/${storeId}/catalogOutboundRequirementConfigurations/${proposalId}`);
  const conditionalRef = adminDb.doc(`stores/${storeId}/catalogOutboundConditionalValidations/${proposalId}`);
  const [proposalDoc, configDoc, conditionalDoc] = await Promise.all([
    proposalRef.get(),
    configRef.get(),
    conditionalRef.get(),
  ]);
  if (!proposalDoc.exists) throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_NOT_FOUND');
  const proposal = assertProposal(storeId, proposalId, proposalDoc.data());
  const configuration = assertConfiguration(proposal, configDoc.data());
  const conditionalValidation = assertConditionalValidation(
    proposal,
    configuration,
    conditionalDoc.data()
  );

  await assertCurrentMercadoLivrePublicationCapability({
    storeId,
    connectionId: proposal.connectionId,
    requestedByUserId: validatedByUserId,
    expectedSnapshot: proposal.providerCapability,
  });

  const canonicalRef = adminDb.doc(
    `stores/${proposal.canonicalStoreId}/products/${proposal.canonicalProductId}`
  );
  const canonicalDoc = await canonicalRef.get();
  if (!canonicalDoc.exists || !canonicalMatchesProposal(proposal, canonicalDoc.data())) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_STALE');
  }

  const publicationCorrelationMarker = mercadoLivrePublicationCorrelationMarker(storeId, proposalId);
  const providerPayload = buildMercadoLivreInitialPublicationPayload({
    publicationModel: proposal.providerPublicationModel,
    stockAuthority: proposal.providerStockAuthority,
    name: proposal.canonical.name,
    categoryId: proposal.providerCategoryId,
    price: proposal.canonical.price,
    currencyId: proposal.providerCurrencyId,
    availableQuantity: proposal.canonical.stock,
    listingTypeId: proposal.providerListingTypeId,
    condition: proposal.providerCondition,
    pictureUrl: proposal.canonical.image,
    attributes: configuration.attributes,
    sellerCustomField: publicationCorrelationMarker,
  });

  const providerValidation = await mercadoLivreValidateJson(
    storeId,
    '/items/validate',
    providerPayload
  );
  const causes = providerCauses(providerValidation.payload);
  const status = providerValidation.status === 204
    ? 'ready_for_owner_authorization'
    : 'needs_correction';
  const validatedAt = new Date().toISOString();
  const result: MercadoLivreKyrubiaListingValidationResult = {
    proposalId,
    status,
    providerStatus: providerValidation.status,
    causes,
    authority: 'provider_items_validate',
    validationSource: 'kyrubia_revalidated_draft',
    validatedAt,
    executionStatus: 'not_authorized',
  };

  const validationRef = adminDb.doc(
    `stores/${storeId}/catalogOutboundListingValidations/${proposalId}`
  );
  await adminDb.runTransaction(async transaction => {
    const [currentProposalDoc, currentConfigDoc, currentConditionalDoc, currentCanonicalDoc] = await Promise.all([
      transaction.get(proposalRef),
      transaction.get(configRef),
      transaction.get(conditionalRef),
      transaction.get(canonicalRef),
    ]);
    if (!currentProposalDoc.exists) throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_NOT_FOUND');
    const currentProposal = assertProposal(storeId, proposalId, currentProposalDoc.data());
    const currentConfiguration = assertConfiguration(currentProposal, currentConfigDoc.data());
    const currentConditional = assertConditionalValidation(
      currentProposal,
      currentConfiguration,
      currentConditionalDoc.data()
    );
    if (
      currentProposal.providerCapabilityFingerprint !== proposal.providerCapabilityFingerprint ||
      currentConfiguration.configuredAt !== configuration.configuredAt ||
      currentConditional.validatedAt !== conditionalValidation.validatedAt ||
      !currentCanonicalDoc.exists ||
      !canonicalMatchesProposal(currentProposal, currentCanonicalDoc.data())
    ) {
      throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_STALE');
    }

    transaction.set(validationRef, {
      schemaVersion: 2,
      ...result,
      connectionId: proposal.connectionId,
      canonicalStoreId: proposal.canonicalStoreId,
      canonicalProductId: proposal.canonicalProductId,
      canonicalBaselineHash: proposal.canonicalBaselineHash,
      providerCapabilityFingerprint: proposal.providerCapabilityFingerprint,
      providerPublicationModel: proposal.providerPublicationModel,
      providerStockAuthority: proposal.providerStockAuthority,
      requirementConfiguredAt: configuration.configuredAt,
      conditionalRequirementValidatedAt: conditionalValidation.validatedAt,
      validatedByUserId,
      publicationCorrelationMarker,
      providerPayload,
      serverValidatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(proposalRef, {
      publicationReadiness: status,
      publicationReadinessAuthority: 'provider_items_validate',
      publicationValidationSource: 'kyrubia_revalidated_draft',
      publicationValidatedAt: validatedAt,
      publicationValidationCauses: causes,
      publicationCorrelationMarker,
      executionStatus: 'not_authorized',
      serverPublicationValidatedAt: FieldValue.serverTimestamp(),
    });
  });

  return result;
};
