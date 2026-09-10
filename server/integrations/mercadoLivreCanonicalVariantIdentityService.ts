import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { mercadoLivreGetJson } from './mercadoLivreOauthService.js';

const clean = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const recordFrom = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const finiteNonNegative = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const integerNonNegative = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const canonicalImages = (value: unknown, primary: string): string[] => {
  const candidates = [primary, ...(Array.isArray(value) ? value : [])];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    const url = clean(candidate, 2_000);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
    if (result.length >= 12) break;
  }
  return result;
};

const normalizeFamilyName = (value: string): string =>
  value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

interface ProposalRecord {
  schemaVersion: 2;
  id: string;
  storeId: string;
  canonicalStoreId: string;
  provider: 'mercado_livre';
  canonicalProductId: string;
  canonicalBaselineHash: string;
  providerPublicationModel: 'user_products';
  providerCategoryId: string;
  executionStatus: 'not_authorized';
}

interface RequirementConfigurationRecord {
  proposalId: string;
  siteId: string;
  publicationModel: 'user_products';
  familyName: string;
  attributes: Array<{ id: string; valueId?: string; valueName?: string }>;
  configuredAt: string;
  canonicalBaselineHash: string;
  authority: 'provider_api_refetch_and_store_owner_selection';
}

interface ListingValidationRecord {
  proposalId: string;
  status: 'ready_for_owner_authorization';
  authority: 'provider_items_validate';
  validatedAt: string;
  requirementConfiguredAt: string;
  canonicalBaselineHash: string;
  providerPublicationModel: 'user_products';
}

interface ProviderAttributeDefinition {
  id?: unknown;
  name?: unknown;
  value_type?: unknown;
  tags?: Record<string, unknown>;
  values?: unknown;
}

export interface MercadoLivreCanonicalVariantDimension {
  providerAttributeId: string;
  label: string;
  valueText: string;
  valueId?: string;
  valueType: string;
}

export interface MercadoLivreCanonicalVariantIdentityResult {
  proposalId: string;
  canonicalStoreId: string;
  canonicalProductId: string;
  familyKey: string;
  familyName: string;
  dimensions: MercadoLivreCanonicalVariantDimension[];
  dimensionFingerprint: string;
  alreadyApplied: boolean;
  authority: 'store_owner_confirmed_user_product_variant';
  confirmedAt: string;
}

const assertProposal = (
  storeId: string,
  proposalId: string,
  value: unknown
): ProposalRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_NOT_FOUND');
  }
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 2 ||
    clean(record.id, 160) !== proposalId ||
    clean(record.storeId, 160) !== storeId ||
    record.provider !== 'mercado_livre' ||
    record.providerPublicationModel !== 'user_products' ||
    record.executionStatus !== 'not_authorized' ||
    !clean(record.canonicalStoreId, 160) ||
    !clean(record.canonicalProductId, 160) ||
    !clean(record.canonicalBaselineHash, 80) ||
    !clean(record.providerCategoryId, 160)
  ) {
    throw new Error('MERCADO_LIVRE_USER_PRODUCT_VARIANT_PROPOSAL_INVALID');
  }
  return record as unknown as ProposalRecord;
};

const assertConfiguration = (
  proposal: ProposalRecord,
  value: unknown
): RequirementConfigurationRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_REQUIREMENTS_NOT_CONFIGURED');
  }
  const record = value as Record<string, unknown>;
  if (
    clean(record.proposalId, 160) !== proposal.id ||
    clean(record.canonicalBaselineHash, 80) !== proposal.canonicalBaselineHash ||
    record.publicationModel !== 'user_products' ||
    !clean(record.siteId, 40) ||
    !clean(record.familyName, 120) ||
    !Array.isArray(record.attributes) ||
    !clean(record.configuredAt, 80) ||
    record.authority !== 'provider_api_refetch_and_store_owner_selection'
  ) {
    throw new Error('MERCADO_LIVRE_USER_PRODUCT_VARIANT_CONFIGURATION_INVALID');
  }
  return record as unknown as RequirementConfigurationRecord;
};

const assertValidation = (
  proposal: ProposalRecord,
  configuration: RequirementConfigurationRecord,
  value: unknown
): ListingValidationRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_LISTING_VALIDATION_REQUIRED');
  }
  const record = value as Record<string, unknown>;
  if (
    clean(record.proposalId, 160) !== proposal.id ||
    clean(record.canonicalBaselineHash, 80) !== proposal.canonicalBaselineHash ||
    clean(record.requirementConfiguredAt, 80) !== configuration.configuredAt ||
    record.providerPublicationModel !== 'user_products' ||
    record.status !== 'ready_for_owner_authorization' ||
    record.authority !== 'provider_items_validate' ||
    !clean(record.validatedAt, 80)
  ) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_LISTING_VALIDATION_REQUIRED');
  }
  return record as unknown as ListingValidationRecord;
};

const canonicalBaselineHashFrom = (
  expectedStoreId: string,
  expectedProductId: string,
  value: unknown
): string | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const name = clean(record.name, 120);
  const price = finiteNonNegative(record.price);
  const stock = integerNonNegative(record.stock);
  const category = clean(record.category, 160);
  const image = clean(record.image, 2_000);
  const publicationStatus = clean(record.publicationStatus, 80);
  if (
    clean(record.id, 160) !== expectedProductId ||
    clean(record.storeId, 160) !== expectedStoreId ||
    !name ||
    price === null ||
    stock === null ||
    record.isService !== false ||
    !publicationStatus
  ) {
    return null;
  }
  return sha256(JSON.stringify({
    name,
    price,
    stock,
    category,
    image,
    images: canonicalImages(record.images, image),
    isService: false,
    publicationStatus,
  }));
};

const providerValueName = (
  definition: ProviderAttributeDefinition,
  valueId: string
): string => {
  const values = Array.isArray(definition.values) ? definition.values : [];
  for (const candidate of values) {
    const record = recordFrom(candidate);
    if (clean(record.id, 160) === valueId) return clean(record.name, 600);
  }
  return '';
};

const buildDimensions = (input: {
  configuration: RequirementConfigurationRecord;
  definitions: ProviderAttributeDefinition[];
}): MercadoLivreCanonicalVariantDimension[] => {
  const definitionById = new Map<string, ProviderAttributeDefinition>();
  for (const definition of input.definitions) {
    const id = clean(definition.id, 160);
    if (id) definitionById.set(id, definition);
  }

  const result: MercadoLivreCanonicalVariantDimension[] = [];
  const seen = new Set<string>();
  for (const selected of input.configuration.attributes) {
    const id = clean(selected.id, 160);
    if (!id || seen.has(id)) continue;
    const definition = definitionById.get(id);
    if (!definition) continue;
    const tags = recordFrom(definition.tags);
    const isVariantDimension =
      tags.variation_attribute === true ||
      tags.allow_variations === true ||
      tags.child_pk === true;
    if (!isVariantDimension || tags.hidden === true || tags.read_only === true) continue;

    const valueId = clean(selected.valueId, 160);
    const valueText = clean(selected.valueName, 600) ||
      (valueId ? providerValueName(definition, valueId) : '');
    if (!valueText) continue;

    result.push({
      providerAttributeId: id,
      label: clean(definition.name, 255) || id,
      valueText,
      ...(valueId ? { valueId } : {}),
      valueType: clean(definition.value_type, 80),
    });
    seen.add(id);
  }

  return result
    .sort((left, right) => left.providerAttributeId.localeCompare(right.providerAttributeId, 'en'))
    .slice(0, 30);
};

const dimensionsFingerprint = (
  familyKey: string,
  dimensions: MercadoLivreCanonicalVariantDimension[]
): string => sha256(JSON.stringify({
  familyKey,
  dimensions: dimensions.map(dimension => ({
    id: dimension.providerAttributeId,
    valueId: dimension.valueId ?? '',
    valueText: dimension.valueText,
  })),
}));

export const confirmMercadoLivreCanonicalVariantIdentity = async (input: {
  storeId: string;
  proposalId: string;
  confirmedByUserId: string;
}): Promise<MercadoLivreCanonicalVariantIdentityResult> => {
  const storeId = clean(input.storeId, 160);
  const proposalId = clean(input.proposalId, 160);
  const confirmedByUserId = clean(input.confirmedByUserId, 160);
  if (!storeId || !proposalId || confirmedByUserId !== storeId) {
    throw new Error('MERCADO_LIVRE_USER_PRODUCT_VARIANT_TARGET_INVALID');
  }

  const proposalRef = adminDb.doc(
    `stores/${storeId}/catalogOutboundPublicationProposals/${proposalId}`
  );
  const configurationRef = adminDb.doc(
    `stores/${storeId}/catalogOutboundRequirementConfigurations/${proposalId}`
  );
  const validationRef = adminDb.doc(
    `stores/${storeId}/catalogOutboundListingValidations/${proposalId}`
  );
  const [proposalDoc, configurationDoc, validationDoc] = await Promise.all([
    proposalRef.get(),
    configurationRef.get(),
    validationRef.get(),
  ]);
  const proposal = assertProposal(storeId, proposalId, proposalDoc.data());
  const configuration = assertConfiguration(proposal, configurationDoc.data());
  const validation = assertValidation(proposal, configuration, validationDoc.data());

  const definitionsRaw = await mercadoLivreGetJson<unknown>(
    storeId,
    `/categories/${encodeURIComponent(proposal.providerCategoryId)}/attributes`
  );
  if (!Array.isArray(definitionsRaw)) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_ATTRIBUTES_INVALID');
  }
  const dimensions = buildDimensions({
    configuration,
    definitions: definitionsRaw as ProviderAttributeDefinition[],
  });
  if (!dimensions.length) {
    throw new Error('MERCADO_LIVRE_USER_PRODUCT_VARIANT_IDENTITY_EMPTY');
  }

  const familyKey = `mlfam_${sha256([
    configuration.siteId,
    proposal.providerCategoryId,
    normalizeFamilyName(configuration.familyName),
  ].join(':')).slice(0, 32)}`;
  const dimensionFingerprint = dimensionsFingerprint(familyKey, dimensions);
  const confirmedAt = new Date().toISOString();
  const canonicalRef = adminDb.doc(
    `stores/${proposal.canonicalStoreId}/products/${proposal.canonicalProductId}`
  );
  const confirmationRef = adminDb.doc(
    `stores/${storeId}/catalogVariantIdentityConfirmations/${proposalId}`
  );
  let alreadyApplied = false;

  await adminDb.runTransaction(async transaction => {
    const [
      currentProposalDoc,
      currentConfigurationDoc,
      currentValidationDoc,
      canonicalDoc,
      confirmationDoc,
    ] = await Promise.all([
      transaction.get(proposalRef),
      transaction.get(configurationRef),
      transaction.get(validationRef),
      transaction.get(canonicalRef),
      transaction.get(confirmationRef),
    ]);

    const currentProposal = assertProposal(storeId, proposalId, currentProposalDoc.data());
    const currentConfiguration = assertConfiguration(
      currentProposal,
      currentConfigurationDoc.data()
    );
    const currentValidation = assertValidation(
      currentProposal,
      currentConfiguration,
      currentValidationDoc.data()
    );
    if (
      currentConfiguration.configuredAt !== configuration.configuredAt ||
      currentConfiguration.familyName !== configuration.familyName ||
      currentValidation.validatedAt !== validation.validatedAt ||
      currentProposal.canonicalBaselineHash !== proposal.canonicalBaselineHash
    ) {
      throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_STALE');
    }
    if (!canonicalDoc.exists) {
      throw new Error('MERCADO_LIVRE_OUTBOUND_PRODUCT_NOT_FOUND');
    }
    const canonical = canonicalDoc.data() as Record<string, unknown>;
    const currentBaselineHash = canonicalBaselineHashFrom(
      proposal.canonicalStoreId,
      proposal.canonicalProductId,
      canonical
    );
    if (!currentBaselineHash || currentBaselineHash !== proposal.canonicalBaselineHash) {
      throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_STALE');
    }

    if (confirmationDoc.exists) {
      const prior = confirmationDoc.data() as Record<string, unknown>;
      if (
        clean(prior.dimensionFingerprint, 80) === dimensionFingerprint &&
        clean(prior.requirementConfiguredAt, 80) === configuration.configuredAt &&
        clean(prior.providerValidatedAt, 80) === validation.validatedAt &&
        clean(prior.canonicalProductId, 160) === proposal.canonicalProductId
      ) {
        alreadyApplied = true;
        return;
      }
    }

    transaction.update(canonicalRef, {
      'catalogProfile.variantIdentity': {
        schemaVersion: 1,
        familyKey,
        familyName: configuration.familyName,
        dimensions,
        provider: 'mercado_livre',
        providerCategoryId: proposal.providerCategoryId,
        publicationModel: 'user_products',
        authority: 'store_owner_confirmed_user_product_variant',
        proposalId,
        requirementConfiguredAt: configuration.configuredAt,
        providerValidatedAt: validation.validatedAt,
        updatedByUserId: confirmedByUserId,
        updatedAt: confirmedAt,
      },
      updatedByUserId: confirmedByUserId,
      updatedByRole: 'owner',
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(confirmationRef, {
      schemaVersion: 1,
      proposalId,
      storeId,
      canonicalStoreId: proposal.canonicalStoreId,
      canonicalProductId: proposal.canonicalProductId,
      provider: 'mercado_livre',
      providerCategoryId: proposal.providerCategoryId,
      publicationModel: 'user_products',
      familyKey,
      familyName: configuration.familyName,
      dimensions,
      dimensionFingerprint,
      requirementConfiguredAt: configuration.configuredAt,
      providerValidatedAt: validation.validatedAt,
      authority: 'store_owner_confirmed_user_product_variant',
      confirmedByUserId,
      confirmedAt,
      serverConfirmedAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    proposalId,
    canonicalStoreId: proposal.canonicalStoreId,
    canonicalProductId: proposal.canonicalProductId,
    familyKey,
    familyName: configuration.familyName,
    dimensions,
    dimensionFingerprint,
    alreadyApplied,
    authority: 'store_owner_confirmed_user_product_variant',
    confirmedAt,
  };
};
