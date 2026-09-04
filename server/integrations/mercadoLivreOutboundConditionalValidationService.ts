import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { mercadoLivrePostJson } from './mercadoLivreOauthService.js';
import { buildMercadoLivreInitialPublicationPayload } from './mercadoLivreInitialPublicationPayloadAdapter.js';
import { assertCurrentMercadoLivrePublicationCapability } from './mercadoLivrePublicationCapabilitySnapshotGuard.js';

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
  providerCategoryId: string;
  providerListingTypeId: string;
  providerCondition: string;
  providerCurrencyId: string;
  executionStatus: 'not_authorized';
}

interface RequirementConfigurationRecord {
  proposalId: string;
  attributes: Array<{ id: string; valueId?: string; valueName?: string }>;
  requiredAttributeIds: string[];
  conditionalAttributeIds: string[];
  missingRequiredAttributeIds: string[];
  authority: 'provider_api_refetch_and_store_owner_selection';
  configuredAt: string;
  canonicalBaselineHash: string;
}

interface ConditionalRequirementResponse {
  required_attributes?: Array<{ id?: unknown; name?: unknown }>;
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

const assertProposal = (storeId: string, proposalId: string, value: unknown): OutboundProposalRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_NOT_FOUND');
  const record = value as Record<string, unknown>;
  const canonical = record.canonical && typeof record.canonical === 'object' && !Array.isArray(record.canonical)
    ? record.canonical as Record<string, unknown>
    : null;
  if (
    record.schemaVersion !== 2 ||
    clean(record.id, 160) !== proposalId || clean(record.storeId, 160) !== storeId ||
    record.provider !== 'mercado_livre' || record.status !== 'review_required' ||
    record.authority !== 'canonical_kyrub_snapshot' || record.action !== 'create_external_listing' ||
    record.executionStatus !== 'not_authorized' || !clean(record.canonicalStoreId, 160) ||
    !clean(record.connectionId, 200) || !clean(record.canonicalProductId, 160) ||
    !clean(record.canonicalBaselineHash, 80) || !canonical || !clean(canonical.name, 120) ||
    !clean(record.providerCapabilityFingerprint, 80) ||
    (record.providerPublicationModel !== 'legacy_items' && record.providerPublicationModel !== 'user_products') ||
    record.providerStockAuthority !== 'item_available_quantity' || !record.providerCapability ||
    !clean(record.providerCategoryId, 160) || !clean(record.providerListingTypeId, 120) ||
    !clean(record.providerCondition, 120) || !clean(record.providerCurrencyId, 16)
  ) throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_INVALID');
  return record as unknown as OutboundProposalRecord;
};

const assertConfiguration = (proposal: OutboundProposalRecord, value: unknown): RequirementConfigurationRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_OUTBOUND_REQUIREMENTS_NOT_CONFIGURED');
  const record = value as Record<string, unknown>;
  if (
    clean(record.proposalId, 160) !== proposal.id ||
    clean(record.canonicalBaselineHash, 80) !== proposal.canonicalBaselineHash ||
    record.authority !== 'provider_api_refetch_and_store_owner_selection' ||
    !Array.isArray(record.attributes) || !Array.isArray(record.requiredAttributeIds) ||
    !Array.isArray(record.conditionalAttributeIds) || !Array.isArray(record.missingRequiredAttributeIds)
  ) throw new Error('MERCADO_LIVRE_OUTBOUND_REQUIREMENTS_INVALID');
  return record as unknown as RequirementConfigurationRecord;
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

const normalizeRequiredAttributes = (value: unknown): Array<{ id: string; name: string }> => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: Array<{ id: string; name: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const id = clean(record.id, 160);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push({ id, name: clean(record.name, 255) || id });
  }
  return result;
};

export interface MercadoLivreConditionalRequirementValidationResult {
  proposalId: string;
  requiredConditionalAttributes: Array<{ id: string; name: string }>;
  missingConditionalAttributeIds: string[];
  missingRequiredAttributeIds: string[];
  ready: boolean;
  authority: 'provider_api_conditional_validation';
  validatedAt: string;
}

export const validateMercadoLivreOutboundConditionalRequirements = async (input: {
  storeId: string;
  proposalId: string;
  validatedByUserId: string;
}): Promise<MercadoLivreConditionalRequirementValidationResult> => {
  const storeId = input.storeId.trim();
  const proposalId = input.proposalId.trim();
  const validatedByUserId = input.validatedByUserId.trim();
  if (!storeId || !proposalId || validatedByUserId !== storeId) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_CONDITIONAL_TARGET_INVALID');
  }

  const proposalRef = adminDb.doc(`stores/${storeId}/catalogOutboundPublicationProposals/${proposalId}`);
  const configRef = adminDb.doc(`stores/${storeId}/catalogOutboundRequirementConfigurations/${proposalId}`);
  const [proposalDoc, configDoc] = await Promise.all([proposalRef.get(), configRef.get()]);
  if (!proposalDoc.exists) throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_NOT_FOUND');
  const proposal = assertProposal(storeId, proposalId, proposalDoc.data());
  const configuration = assertConfiguration(proposal, configDoc.data());

  await assertCurrentMercadoLivrePublicationCapability({
    storeId,
    connectionId: proposal.connectionId,
    requestedByUserId: validatedByUserId,
    expectedSnapshot: proposal.providerCapability,
  });

  const canonicalRef = adminDb.doc(`stores/${proposal.canonicalStoreId}/products/${proposal.canonicalProductId}`);
  const canonicalDoc = await canonicalRef.get();
  if (!canonicalDoc.exists || !canonicalMatchesProposal(proposal, canonicalDoc.data())) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_STALE');
  }

  const payload = buildMercadoLivreInitialPublicationPayload({
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
  });

  const conditional = await mercadoLivrePostJson<ConditionalRequirementResponse>(
    storeId,
    `/categories/${encodeURIComponent(proposal.providerCategoryId)}/attributes/conditional`,
    payload
  );
  const requiredConditionalAttributes = normalizeRequiredAttributes(conditional.required_attributes);
  const supplied = new Set(configuration.attributes.map(attribute => attribute.id));
  const missingConditionalAttributeIds = requiredConditionalAttributes
    .map(attribute => attribute.id)
    .filter(id => !supplied.has(id));
  const missingRequiredAttributeIds = configuration.missingRequiredAttributeIds;
  const ready = missingRequiredAttributeIds.length === 0 && missingConditionalAttributeIds.length === 0;
  const validatedAt = new Date().toISOString();
  const result: MercadoLivreConditionalRequirementValidationResult = {
    proposalId,
    requiredConditionalAttributes,
    missingConditionalAttributeIds,
    missingRequiredAttributeIds,
    ready,
    authority: 'provider_api_conditional_validation',
    validatedAt,
  };

  const validationRef = adminDb.doc(`stores/${storeId}/catalogOutboundConditionalValidations/${proposalId}`);
  await adminDb.runTransaction(async transaction => {
    const [currentProposalDoc, currentConfigDoc, currentCanonicalDoc] = await Promise.all([
      transaction.get(proposalRef), transaction.get(configRef), transaction.get(canonicalRef),
    ]);
    if (!currentProposalDoc.exists) throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_NOT_FOUND');
    const currentProposal = assertProposal(storeId, proposalId, currentProposalDoc.data());
    const currentConfiguration = assertConfiguration(currentProposal, currentConfigDoc.data());
    if (
      currentProposal.providerCapabilityFingerprint !== proposal.providerCapabilityFingerprint ||
      currentConfiguration.configuredAt !== configuration.configuredAt ||
      !currentCanonicalDoc.exists ||
      !canonicalMatchesProposal(currentProposal, currentCanonicalDoc.data())
    ) throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_STALE');

    transaction.set(validationRef, {
      ...result,
      connectionId: proposal.connectionId,
      canonicalStoreId: proposal.canonicalStoreId,
      canonicalProductId: proposal.canonicalProductId,
      canonicalBaselineHash: proposal.canonicalBaselineHash,
      providerCapabilityFingerprint: proposal.providerCapabilityFingerprint,
      providerPublicationModel: proposal.providerPublicationModel,
      providerStockAuthority: proposal.providerStockAuthority,
      requirementConfiguredAt: configuration.configuredAt,
      validatedByUserId,
      serverValidatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(proposalRef, {
      requirements: {
        ready,
        missing: [
          ...(missingRequiredAttributeIds.length ? ['required_attributes'] : []),
          ...(missingConditionalAttributeIds.length ? ['conditional_required_attributes'] : []),
        ],
      },
      conditionalRequirementAuthority: 'provider_api_conditional_validation',
      conditionalRequirementValidatedAt: validatedAt,
      requiredConditionalAttributes,
      missingConditionalAttributeIds,
      executionStatus: 'not_authorized',
      serverConditionalRequirementValidatedAt: FieldValue.serverTimestamp(),
    });
  });

  return result;
};
