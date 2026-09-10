import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { mercadoLivreGetJson } from './mercadoLivreOauthService.js';

const clean = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const recordFrom = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

interface ProposalRecord {
  schemaVersion: 2;
  id: string;
  storeId: string;
  canonicalStoreId: string;
  provider: 'mercado_livre';
  connectionId: string;
  canonicalProductId: string;
  canonicalBaselineHash: string;
  providerCategoryId: string;
  executionStatus: 'not_authorized';
}

interface RequirementConfigurationRecord {
  proposalId: string;
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
}

interface ProviderAttributeDefinition {
  id?: unknown;
  name?: unknown;
  value_type?: unknown;
  tags?: Record<string, unknown>;
  values?: unknown;
}

export interface CanonicalCatalogFact {
  key: string;
  canonicalKey?: string;
  label: string;
  valueText: string;
  valueId?: string;
  valueType: string;
  provenance: {
    source: 'owner_confirmed_external_taxonomy';
    provider: 'mercado_livre';
    providerAttributeId: string;
    providerCategoryId: string;
    proposalId: string;
    requirementConfiguredAt: string;
    providerValidatedAt: string;
  };
}

const CANONICAL_KEY_BY_PROVIDER_ATTRIBUTE: Record<string, string> = {
  BRAND: 'brand',
  MODEL: 'model',
  MANUFACTURER: 'manufacturer',
  MPN: 'manufacturer_part_number',
  GTIN: 'gtin',
  EAN: 'gtin',
  ISBN: 'isbn',
  MATERIAL: 'material',
  LINE: 'line',
  PRODUCT_TYPE: 'product_type',
  COLOR: 'color',
  MAIN_COLOR: 'color',
  SIZE: 'size',
};

const assertProposal = (storeId: string, proposalId: string, value: unknown): ProposalRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_NOT_FOUND');
  }
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 2 ||
    clean(record.id, 160) !== proposalId ||
    clean(record.storeId, 160) !== storeId ||
    record.provider !== 'mercado_livre' ||
    record.executionStatus !== 'not_authorized' ||
    !clean(record.canonicalStoreId, 160) ||
    !clean(record.connectionId, 200) ||
    !clean(record.canonicalProductId, 160) ||
    !clean(record.canonicalBaselineHash, 80) ||
    !clean(record.providerCategoryId, 160)
  ) throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_INVALID');
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
    record.authority !== 'provider_api_refetch_and_store_owner_selection' ||
    !Array.isArray(record.attributes) ||
    !clean(record.configuredAt, 80)
  ) throw new Error('MERCADO_LIVRE_OUTBOUND_REQUIREMENTS_INVALID');
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
    record.status !== 'ready_for_owner_authorization' ||
    record.authority !== 'provider_items_validate' ||
    !clean(record.validatedAt, 80)
  ) throw new Error('MERCADO_LIVRE_OUTBOUND_LISTING_VALIDATION_REQUIRED');
  return record as unknown as ListingValidationRecord;
};

const providerValueName = (definition: ProviderAttributeDefinition, valueId: string): string => {
  const values = Array.isArray(definition.values) ? definition.values : [];
  for (const candidate of values) {
    const record = recordFrom(candidate);
    if (clean(record.id, 160) === valueId) return clean(record.name, 600);
  }
  return '';
};

const factFingerprint = (facts: CanonicalCatalogFact[]): string => createHash('sha256')
  .update(JSON.stringify(facts.map(fact => ({
    key: fact.key,
    canonicalKey: fact.canonicalKey ?? '',
    label: fact.label,
    valueText: fact.valueText,
    valueId: fact.valueId ?? '',
    valueType: fact.valueType,
    providerAttributeId: fact.provenance.providerAttributeId,
    providerCategoryId: fact.provenance.providerCategoryId,
    requirementConfiguredAt: fact.provenance.requirementConfiguredAt,
    providerValidatedAt: fact.provenance.providerValidatedAt,
  }))))
  .digest('hex');

const existingFactsFrom = (value: unknown): CanonicalCatalogFact[] => {
  const profile = recordFrom(value);
  const facts = Array.isArray(profile.facts) ? profile.facts : [];
  return facts.flatMap(candidate => {
    const record = recordFrom(candidate);
    const provenance = recordFrom(record.provenance);
    const key = clean(record.key, 220);
    const label = clean(record.label, 255);
    const valueText = clean(record.valueText, 600);
    if (!key || !label || !valueText) return [];
    if (
      provenance.source !== 'owner_confirmed_external_taxonomy' ||
      provenance.provider !== 'mercado_livre'
    ) {
      return [candidate as CanonicalCatalogFact];
    }
    const providerAttributeId = clean(provenance.providerAttributeId, 160);
    const providerCategoryId = clean(provenance.providerCategoryId, 160);
    const proposalId = clean(provenance.proposalId, 160);
    const requirementConfiguredAt = clean(provenance.requirementConfiguredAt, 80);
    const providerValidatedAt = clean(provenance.providerValidatedAt, 80);
    if (!providerAttributeId || !providerCategoryId || !proposalId || !requirementConfiguredAt || !providerValidatedAt) return [];
    return [{
      key,
      ...(clean(record.canonicalKey, 120) ? { canonicalKey: clean(record.canonicalKey, 120) } : {}),
      label,
      valueText,
      ...(clean(record.valueId, 160) ? { valueId: clean(record.valueId, 160) } : {}),
      valueType: clean(record.valueType, 80),
      provenance: {
        source: 'owner_confirmed_external_taxonomy',
        provider: 'mercado_livre',
        providerAttributeId,
        providerCategoryId,
        proposalId,
        requirementConfiguredAt,
        providerValidatedAt,
      },
    }];
  }).slice(0, 200);
};

const buildFacts = (input: {
  proposal: ProposalRecord;
  configuration: RequirementConfigurationRecord;
  validation: ListingValidationRecord;
  definitions: ProviderAttributeDefinition[];
}): CanonicalCatalogFact[] => {
  const definitionsById = new Map<string, ProviderAttributeDefinition>();
  for (const definition of input.definitions) {
    const id = clean(definition.id, 160);
    if (id) definitionsById.set(id, definition);
  }

  const facts: CanonicalCatalogFact[] = [];
  for (const configured of input.configuration.attributes) {
    const id = clean(configured.id, 160);
    if (!id) continue;
    const definition = definitionsById.get(id);
    if (!definition) continue;
    const tags = recordFrom(definition.tags);
    if (tags.variation_attribute === true || tags.allow_variations === true) continue;
    if (tags.hidden === true || tags.read_only === true) continue;

    const valueId = clean(configured.valueId, 160);
    const valueText = clean(configured.valueName, 600) || (valueId ? providerValueName(definition, valueId) : '');
    if (!valueText) continue;
    const canonicalKey = CANONICAL_KEY_BY_PROVIDER_ATTRIBUTE[id];
    facts.push({
      key: canonicalKey ? `canonical:${canonicalKey}` : `external:mercado_livre:${id.toLocaleLowerCase('en-US')}`,
      ...(canonicalKey ? { canonicalKey } : {}),
      label: clean(definition.name, 255) || id,
      valueText,
      ...(valueId ? { valueId } : {}),
      valueType: clean(definition.value_type, 80),
      provenance: {
        source: 'owner_confirmed_external_taxonomy',
        provider: 'mercado_livre',
        providerAttributeId: id,
        providerCategoryId: input.proposal.providerCategoryId,
        proposalId: input.proposal.id,
        requirementConfiguredAt: input.configuration.configuredAt,
        providerValidatedAt: input.validation.validatedAt,
      },
    });
  }
  return facts.slice(0, 100);
};

export interface MercadoLivreCanonicalEnrichmentResult {
  proposalId: string;
  canonicalStoreId: string;
  canonicalProductId: string;
  appliedFactCount: number;
  canonicalKeys: string[];
  factFingerprint: string;
  alreadyApplied: boolean;
  authority: 'store_owner_confirmed_external_taxonomy_enrichment';
  enrichedAt: string;
}

export const enrichCanonicalProductFromMercadoLivre = async (input: {
  storeId: string;
  proposalId: string;
  confirmedByUserId: string;
}): Promise<MercadoLivreCanonicalEnrichmentResult> => {
  const storeId = clean(input.storeId, 160);
  const proposalId = clean(input.proposalId, 160);
  const confirmedByUserId = clean(input.confirmedByUserId, 160);
  if (!storeId || !proposalId || confirmedByUserId !== storeId) {
    throw new Error('MERCADO_LIVRE_CANONICAL_ENRICHMENT_TARGET_INVALID');
  }

  const proposalRef = adminDb.doc(`stores/${storeId}/catalogOutboundPublicationProposals/${proposalId}`);
  const configurationRef = adminDb.doc(`stores/${storeId}/catalogOutboundRequirementConfigurations/${proposalId}`);
  const validationRef = adminDb.doc(`stores/${storeId}/catalogOutboundListingValidations/${proposalId}`);
  const [proposalDoc, configurationDoc, validationDoc] = await Promise.all([
    proposalRef.get(), configurationRef.get(), validationRef.get(),
  ]);
  const proposal = assertProposal(storeId, proposalId, proposalDoc.data());
  const configuration = assertConfiguration(proposal, configurationDoc.data());
  const validation = assertValidation(proposal, configuration, validationDoc.data());

  const definitionsRaw = await mercadoLivreGetJson<unknown>(
    storeId,
    `/categories/${encodeURIComponent(proposal.providerCategoryId)}/attributes`
  );
  if (!Array.isArray(definitionsRaw)) throw new Error('MERCADO_LIVRE_OUTBOUND_ATTRIBUTES_INVALID');
  const facts = buildFacts({
    proposal,
    configuration,
    validation,
    definitions: definitionsRaw as ProviderAttributeDefinition[],
  });
  if (!facts.length) throw new Error('MERCADO_LIVRE_CANONICAL_ENRICHMENT_EMPTY');

  const fingerprint = factFingerprint(facts);
  const canonicalRef = adminDb.doc(`stores/${proposal.canonicalStoreId}/products/${proposal.canonicalProductId}`);
  const confirmationRef = adminDb.doc(`stores/${storeId}/catalogEnrichmentConfirmations/${proposalId}`);
  const enrichedAt = new Date().toISOString();
  let alreadyApplied = false;

  await adminDb.runTransaction(async transaction => {
    const [currentProposalDoc, currentConfigurationDoc, currentValidationDoc, canonicalDoc, confirmationDoc] = await Promise.all([
      transaction.get(proposalRef),
      transaction.get(configurationRef),
      transaction.get(validationRef),
      transaction.get(canonicalRef),
      transaction.get(confirmationRef),
    ]);
    const currentProposal = assertProposal(storeId, proposalId, currentProposalDoc.data());
    const currentConfiguration = assertConfiguration(currentProposal, currentConfigurationDoc.data());
    const currentValidation = assertValidation(currentProposal, currentConfiguration, currentValidationDoc.data());
    if (
      currentConfiguration.configuredAt !== configuration.configuredAt ||
      currentValidation.validatedAt !== validation.validatedAt ||
      currentProposal.canonicalBaselineHash !== proposal.canonicalBaselineHash
    ) throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_STALE');
    if (!canonicalDoc.exists) throw new Error('MERCADO_LIVRE_OUTBOUND_PRODUCT_NOT_FOUND');
    const canonical = canonicalDoc.data() as Record<string, unknown>;
    if (
      clean(canonical.id, 160) !== proposal.canonicalProductId ||
      clean(canonical.storeId, 160) !== proposal.canonicalStoreId
    ) throw new Error('MERCADO_LIVRE_OUTBOUND_PRODUCT_INVALID');

    if (confirmationDoc.exists) {
      const prior = confirmationDoc.data() as Record<string, unknown>;
      if (
        clean(prior.factFingerprint, 80) === fingerprint &&
        clean(prior.requirementConfiguredAt, 80) === configuration.configuredAt &&
        clean(prior.providerValidatedAt, 80) === validation.validatedAt &&
        clean(prior.canonicalProductId, 160) === proposal.canonicalProductId
      ) {
        alreadyApplied = true;
        return;
      }
    }

    const existingFacts = existingFactsFrom(canonical.catalogProfile);
    const replacedIds = new Set(facts.map(fact => fact.provenance.providerAttributeId));
    const preserved = existingFacts.filter(fact => !(
      fact.provenance?.provider === 'mercado_livre' &&
      replacedIds.has(fact.provenance.providerAttributeId)
    ));
    const mergedFacts = [...preserved, ...facts].slice(-200);

    transaction.update(canonicalRef, {
      'catalogProfile.schemaVersion': 1,
      'catalogProfile.facts': mergedFacts,
      'catalogProfile.authority': 'store_owner_confirmed_enrichment',
      'catalogProfile.updatedByUserId': confirmedByUserId,
      'catalogProfile.updatedAt': enrichedAt,
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
      factFingerprint: fingerprint,
      facts,
      requirementConfiguredAt: configuration.configuredAt,
      providerValidatedAt: validation.validatedAt,
      authority: 'store_owner_confirmed_external_taxonomy_enrichment',
      confirmedByUserId,
      enrichedAt,
      serverEnrichedAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    proposalId,
    canonicalStoreId: proposal.canonicalStoreId,
    canonicalProductId: proposal.canonicalProductId,
    appliedFactCount: facts.length,
    canonicalKeys: [...new Set(facts.map(fact => fact.canonicalKey).filter((value): value is string => Boolean(value)))],
    factFingerprint: fingerprint,
    alreadyApplied,
    authority: 'store_owner_confirmed_external_taxonomy_enrichment',
    enrichedAt,
  };
};
