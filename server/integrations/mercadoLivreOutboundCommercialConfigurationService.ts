import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { getStoreConnectionRegistryRecord } from './storeConnectionRegistry.js';
import {
  inspectMercadoLivreCommercialRequirements,
  validateMercadoLivreCommercialSelections,
  type MercadoLivreSaleTermSelection,
  type MercadoLivreShippingSelection,
} from './mercadoLivreCommercialRequirementsService.js';

const clean = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

interface ProposalRecord {
  id: string;
  storeId: string;
  provider: 'mercado_livre';
  connectionId: string;
  canonicalStoreId: string;
  canonicalProductId: string;
  canonicalBaselineHash: string;
  providerCategoryId: string;
  executionStatus: 'not_authorized';
}

interface RequirementConfigurationRecord {
  proposalId: string;
  category: { id: string };
  configuredAt: string;
  canonicalBaselineHash: string;
  authority: 'provider_api_refetch_and_store_owner_selection';
}

const assertProposal = (storeId: string, proposalId: string, value: unknown): ProposalRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_NOT_FOUND');
  }
  const record = value as Record<string, unknown>;
  if (
    clean(record.id, 160) !== proposalId ||
    clean(record.storeId, 160) !== storeId ||
    record.provider !== 'mercado_livre' ||
    record.executionStatus !== 'not_authorized' ||
    !clean(record.connectionId, 200) ||
    !clean(record.canonicalStoreId, 160) ||
    !clean(record.canonicalProductId, 160) ||
    !clean(record.canonicalBaselineHash, 80) ||
    !clean(record.providerCategoryId, 160)
  ) throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_INVALID');
  return record as unknown as ProposalRecord;
};

const assertRequirementConfiguration = (
  proposal: ProposalRecord,
  value: unknown
): RequirementConfigurationRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_REQUIREMENTS_NOT_CONFIGURED');
  }
  const record = value as Record<string, unknown>;
  const category = record.category && typeof record.category === 'object' && !Array.isArray(record.category)
    ? record.category as Record<string, unknown>
    : {};
  if (
    clean(record.proposalId, 160) !== proposal.id ||
    clean(record.canonicalBaselineHash, 80) !== proposal.canonicalBaselineHash ||
    clean(category.id, 160) !== proposal.providerCategoryId ||
    record.authority !== 'provider_api_refetch_and_store_owner_selection' ||
    !clean(record.configuredAt, 80)
  ) throw new Error('MERCADO_LIVRE_OUTBOUND_REQUIREMENTS_INVALID');
  return record as unknown as RequirementConfigurationRecord;
};

export interface MercadoLivreOutboundCommercialConfiguration {
  proposalId: string;
  saleTerms: MercadoLivreSaleTermSelection[];
  shipping: MercadoLivreShippingSelection | null;
  missingRequiredSaleTermIds: string[];
  requirementConfiguredAt: string;
  authority: 'provider_api_commercial_options_and_store_owner_selection';
  configuredAt: string;
}

export const configureMercadoLivreOutboundCommercialRequirements = async (input: {
  storeId: string;
  proposalId: string;
  saleTerms: unknown;
  shipping: unknown;
  configuredByUserId: string;
}): Promise<MercadoLivreOutboundCommercialConfiguration> => {
  const storeId = clean(input.storeId, 160);
  const proposalId = clean(input.proposalId, 160);
  const configuredByUserId = clean(input.configuredByUserId, 160);
  if (!storeId || !proposalId || configuredByUserId !== storeId) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_COMMERCIAL_CONFIGURATION_TARGET_INVALID');
  }

  const proposalRef = adminDb.doc(`stores/${storeId}/catalogOutboundPublicationProposals/${proposalId}`);
  const requirementsRef = adminDb.doc(`stores/${storeId}/catalogOutboundRequirementConfigurations/${proposalId}`);
  const [proposalDoc, requirementsDoc] = await Promise.all([proposalRef.get(), requirementsRef.get()]);
  const proposal = assertProposal(storeId, proposalId, proposalDoc.data());
  const requirementConfiguration = assertRequirementConfiguration(proposal, requirementsDoc.data());

  const connection = await getStoreConnectionRegistryRecord({ storeId, connectionId: proposal.connectionId });
  if (
    !connection ||
    connection.provider !== 'mercado_livre' ||
    connection.status !== 'connected' ||
    connection.syncAuthority !== 'manual_review'
  ) throw new Error('MERCADO_LIVRE_CONNECTION_INVALID');

  const providerRequirements = await inspectMercadoLivreCommercialRequirements({
    storeId,
    categoryId: proposal.providerCategoryId,
    externalAccountId: connection.externalAccountId,
  });
  const selections = validateMercadoLivreCommercialSelections({
    saleTerms: input.saleTerms,
    shipping: input.shipping,
    requirements: providerRequirements,
  });
  const configuredAt = new Date().toISOString();
  const configuration: MercadoLivreOutboundCommercialConfiguration = {
    proposalId,
    saleTerms: selections.saleTerms,
    shipping: selections.shipping,
    missingRequiredSaleTermIds: selections.missingRequiredSaleTermIds,
    requirementConfiguredAt: requirementConfiguration.configuredAt,
    authority: 'provider_api_commercial_options_and_store_owner_selection',
    configuredAt,
  };

  const commercialRef = adminDb.doc(`stores/${storeId}/catalogOutboundCommercialConfigurations/${proposalId}`);
  await adminDb.runTransaction(async transaction => {
    const [currentProposalDoc, currentRequirementsDoc] = await Promise.all([
      transaction.get(proposalRef),
      transaction.get(requirementsRef),
    ]);
    const currentProposal = assertProposal(storeId, proposalId, currentProposalDoc.data());
    const currentRequirements = assertRequirementConfiguration(currentProposal, currentRequirementsDoc.data());
    if (
      currentProposal.canonicalBaselineHash !== proposal.canonicalBaselineHash ||
      currentRequirements.configuredAt !== requirementConfiguration.configuredAt
    ) throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_STALE');

    transaction.set(commercialRef, {
      ...configuration,
      connectionId: proposal.connectionId,
      canonicalStoreId: proposal.canonicalStoreId,
      canonicalProductId: proposal.canonicalProductId,
      canonicalBaselineHash: proposal.canonicalBaselineHash,
      configuredByUserId,
      serverConfiguredAt: FieldValue.serverTimestamp(),
    });
    transaction.update(proposalRef, {
      providerSaleTerms: selections.saleTerms,
      providerShipping: selections.shipping,
      commercialRequirementAuthority: configuration.authority,
      commercialRequirementConfiguredAt: configuredAt,
      executionStatus: 'not_authorized',
      serverCommercialRequirementConfiguredAt: FieldValue.serverTimestamp(),
    });
  });

  return configuration;
};
