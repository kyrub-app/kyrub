import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
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
  providerPublicationModel: 'legacy_items';
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

interface ConfigurationRecord {
  proposalId: string;
  attributes: Array<{ id: string; valueId?: string; valueName?: string }>;
  authority: 'provider_api_refetch_and_store_owner_selection';
  configuredAt: string;
  canonicalBaselineHash: string;
}

interface ConditionalValidationRecord {
  proposalId: string;
  ready: boolean;
  authority: 'provider_api_conditional_validation';
  validatedAt: string;
  requirementConfiguredAt: string;
  canonicalBaselineHash: string;
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

const assertProposal = (storeId: string, proposalId: string, value: unknown): ProposalRecord => {
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
    !clean(record.providerCapabilityFingerprint, 80) || record.providerPublicationModel !== 'legacy_items' ||
    record.providerStockAuthority !== 'item_available_quantity' || !record.providerCapability ||
    !clean(record.providerCategoryId, 160) || !clean(record.providerListingTypeId, 120) ||
    !clean(record.providerCondition, 120) || !clean(record.providerCurrencyId, 16)
  ) throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_INVALID');
  return record as unknown as ProposalRecord;
};

const assertConfiguration = (proposal: ProposalRecord, value: unknown): ConfigurationRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_OUTBOUND_REQUIREMENTS_NOT_CONFIGURED');
  const record = value as Record<string, unknown>;
  if (
    clean(record.proposalId, 160) !== proposal.id ||
    clean(record.canonicalBaselineHash, 80) !== proposal.canonicalBaselineHash ||
    record.authority !== 'provider_api_refetch_and_store_owner_selection' ||
    !Array.isArray(record.attributes) || !clean(record.configuredAt, 80)
  ) throw new Error('MERCADO_LIVRE_OUTBOUND_REQUIREMENTS_INVALID');
  return record as unknown as ConfigurationRecord;
};

const assertConditionalValidation = (
  proposal: ProposalRecord,
  configuration: ConfigurationRecord,
  value: unknown
): ConditionalValidationRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_OUTBOUND_CONDITIONAL_VALIDATION_REQUIRED');
  const record = value as Record<string, unknown>;
  if (
    clean(record.proposalId, 160) !== proposal.id ||
    clean(record.canonicalBaselineHash, 80) !== proposal.canonicalBaselineHash ||
    clean(record.requirementConfiguredAt, 80) !== configuration.configuredAt ||
    record.authority !== 'provider_api_conditional_validation' ||
    record.ready !== true || !clean(record.validatedAt, 80)
  ) throw new Error('MERCADO_LIVRE_OUTBOUND_CONDITIONAL_VALIDATION_REQUIRED');
  return record as unknown as ConditionalValidationRecord;
};

const canonicalMatchesProposal = (proposal: ProposalRecord, value: unknown): boolean => {
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

const providerCauses = (value: unknown): Array<{ code: string; message: string; reference: string }> => {
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
    .filter(item => item.code || item.message || item.reference);
};

export interface MercadoLivreOutboundListingValidationResult {
  proposalId: string;
  status: 'ready_for_owner_authorization' | 'needs_correction';
  providerStatus: number;
  causes: Array<{ code: string; message: string; reference: string }>;
  authority: 'provider_items_validate';
  validatedAt: string;
  executionStatus: 'not_authorized';
}

export const validateMercadoLivreOutboundListing = async (input: {
  storeId: string;
  proposalId: string;
  validatedByUserId: string;
}): Promise<MercadoLivreOutboundListingValidationResult> => {
  const storeId = input.storeId.trim();
  const proposalId = input.proposalId.trim();
  const validatedByUserId = input.validatedByUserId.trim();
  if (!storeId || !proposalId || validatedByUserId !== storeId) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_LISTING_VALIDATION_TARGET_INVALID');
  }

  const proposalRef = adminDb.doc(`stores/${storeId}/catalogOutboundPublicationProposals/${proposalId}`);
  const configRef = adminDb.doc(`stores/${storeId}/catalogOutboundRequirementConfigurations/${proposalId}`);
  const conditionalRef = adminDb.doc(`stores/${storeId}/catalogOutboundConditionalValidations/${proposalId}`);
  const [proposalDoc, configDoc, conditionalDoc] = await Promise.all([
    proposalRef.get(), configRef.get(), conditionalRef.get(),
  ]);
  if (!proposalDoc.exists) throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_NOT_FOUND');
  const proposal = assertProposal(storeId, proposalId, proposalDoc.data());
  const configuration = assertConfiguration(proposal, configDoc.data());
  const conditionalValidation = assertConditionalValidation(proposal, configuration, conditionalDoc.data());

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

  const publicationCorrelationMarker = mercadoLivrePublicationCorrelationMarker(storeId, proposalId);
  const itemPayload = {
    title: proposal.canonical.name,
    category_id: proposal.providerCategoryId,
    price: proposal.canonical.price,
    currency_id: proposal.providerCurrencyId,
    available_quantity: proposal.canonical.stock,
    buying_mode: 'buy_it_now',
    listing_type_id: proposal.providerListingTypeId,
    condition: proposal.providerCondition,
    seller_custom_field: publicationCorrelationMarker,
    ...(proposal.canonical.image ? { pictures: [{ source: proposal.canonical.image }] } : {}),
    attributes: configuration.attributes.map(attribute => ({
      id: attribute.id,
      ...(attribute.valueId ? { value_id: attribute.valueId } : {}),
      ...(attribute.valueName ? { value_name: attribute.valueName } : {}),
    })),
  };

  const providerValidation = await mercadoLivreValidateJson(storeId, '/items/validate', itemPayload);
  const causes = providerCauses(providerValidation.payload);
  const status = providerValidation.status === 204 ? 'ready_for_owner_authorization' : 'needs_correction';
  const validatedAt = new Date().toISOString();
  const result: MercadoLivreOutboundListingValidationResult = {
    proposalId,
    status,
    providerStatus: providerValidation.status,
    causes,
    authority: 'provider_items_validate',
    validatedAt,
    executionStatus: 'not_authorized',
  };

  const validationRef = adminDb.doc(`stores/${storeId}/catalogOutboundListingValidations/${proposalId}`);
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
    const currentConditional = assertConditionalValidation(currentProposal, currentConfiguration, currentConditionalDoc.data());
    if (
      currentProposal.providerCapabilityFingerprint !== proposal.providerCapabilityFingerprint ||
      currentConfiguration.configuredAt !== configuration.configuredAt ||
      currentConditional.validatedAt !== conditionalValidation.validatedAt ||
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
      conditionalRequirementValidatedAt: conditionalValidation.validatedAt,
      validatedByUserId,
      publicationCorrelationMarker,
      providerPayload: itemPayload,
      serverValidatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(proposalRef, {
      publicationReadiness: status,
      publicationReadinessAuthority: 'provider_items_validate',
      publicationValidatedAt: validatedAt,
      publicationValidationCauses: causes,
      publicationCorrelationMarker,
      executionStatus: 'not_authorized',
      serverPublicationValidatedAt: FieldValue.serverTimestamp(),
    });
  });

  return result;
};
