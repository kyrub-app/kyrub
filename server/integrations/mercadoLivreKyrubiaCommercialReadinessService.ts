import { adminDb } from '../firebaseAdmin.js';
import {
  inspectMercadoLivreCommercialRequirements,
  type MercadoLivreShippingSelection,
} from './mercadoLivreCommercialRequirementsService.js';
import { getStoreConnectionRegistryRecord } from './storeConnectionRegistry.js';

const clean = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const recordFrom = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

interface ProposalRecord {
  id: string;
  storeId: string;
  provider: 'mercado_livre';
  connectionId: string;
  canonicalBaselineHash: string;
  providerSiteId: string;
  providerCategoryId: string;
  providerListingTypeId: string;
  providerCondition: string;
  providerCurrencyId: string;
  canonical: {
    name: string;
    price: number;
  };
  executionStatus: 'not_authorized';
}

interface RequirementConfigurationRecord {
  proposalId: string;
  configuredAt: string;
  canonicalBaselineHash: string;
  authority: 'provider_api_refetch_and_store_owner_selection';
  attributes: unknown[];
}

const assertProposal = (
  storeId: string,
  proposalId: string,
  value: unknown
): ProposalRecord => {
  const record = recordFrom(value);
  const canonical = recordFrom(record.canonical);
  const price = Number(canonical.price);
  if (
    clean(record.id, 160) !== proposalId ||
    clean(record.storeId, 160) !== storeId ||
    record.provider !== 'mercado_livre' ||
    record.executionStatus !== 'not_authorized' ||
    !clean(record.connectionId, 200) ||
    !clean(record.canonicalBaselineHash, 80) ||
    !clean(record.providerSiteId, 16) ||
    !clean(record.providerCategoryId, 160) ||
    !clean(record.providerListingTypeId, 120) ||
    !clean(record.providerCondition, 120) ||
    !clean(record.providerCurrencyId, 16) ||
    !clean(canonical.name, 120) ||
    !Number.isFinite(price) ||
    price < 0
  ) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_PROPOSAL_INVALID');
  }
  return {
    ...(record as unknown as ProposalRecord),
    canonical: {
      name: clean(canonical.name, 120),
      price,
    },
  };
};

const assertRequirementConfiguration = (
  proposal: ProposalRecord,
  value: unknown
): RequirementConfigurationRecord => {
  const record = recordFrom(value);
  if (
    clean(record.proposalId, 160) !== proposal.id ||
    clean(record.canonicalBaselineHash, 80) !== proposal.canonicalBaselineHash ||
    record.authority !== 'provider_api_refetch_and_store_owner_selection' ||
    !clean(record.configuredAt, 80) ||
    !Array.isArray(record.attributes)
  ) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_REQUIREMENTS_NOT_CONFIGURED');
  }
  return {
    ...(record as unknown as RequirementConfigurationRecord),
    attributes: record.attributes,
  };
};

const configuredShippingFrom = (
  proposal: ProposalRecord,
  requirementConfiguration: RequirementConfigurationRecord,
  value: unknown
): MercadoLivreShippingSelection | null => {
  const record = recordFrom(value);
  if (
    clean(record.proposalId, 160) !== proposal.id ||
    clean(record.canonicalBaselineHash, 80) !== proposal.canonicalBaselineHash ||
    clean(record.requirementConfiguredAt, 80) !== requirementConfiguration.configuredAt ||
    record.authority !== 'provider_api_commercial_options_and_store_owner_selection'
  ) {
    return null;
  }
  const shipping = recordFrom(record.shipping);
  const mode = clean(shipping.mode, 120);
  if (!mode) return null;
  return {
    mode,
    freeShipping: shipping.freeShipping === true,
    localPickUp: shipping.localPickUp === true,
  };
};

const configuredSaleTermIdsFrom = (
  proposal: ProposalRecord,
  requirementConfiguration: RequirementConfigurationRecord,
  value: unknown
): Set<string> => {
  const record = recordFrom(value);
  if (
    clean(record.proposalId, 160) !== proposal.id ||
    clean(record.canonicalBaselineHash, 80) !== proposal.canonicalBaselineHash ||
    clean(record.requirementConfiguredAt, 80) !== requirementConfiguration.configuredAt ||
    record.authority !== 'provider_api_commercial_options_and_store_owner_selection' ||
    !Array.isArray(record.saleTerms)
  ) {
    return new Set();
  }
  return new Set(
    record.saleTerms
      .map(item => clean(recordFrom(item).id, 160))
      .filter(Boolean)
  );
};

export interface MercadoLivreKyrubiaCommercialReadiness {
  proposalId: string;
  allowedShippingModes: string[];
  sellerShippingModes: string[];
  categoryShippingModes: string[];
  localPickUpAvailable: boolean;
  configuredShipping: MercadoLivreShippingSelection | null;
  requiredSaleTerms: Array<{ id: string; name: string }>;
  missingRequiredSaleTermIds: string[];
  authority: 'provider_api_commercial_options';
}

export const inspectKyrubiaMercadoLivreCommercialReadiness = async (input: {
  storeId: string;
  proposalId: string;
  requestedByUserId: string;
}): Promise<MercadoLivreKyrubiaCommercialReadiness> => {
  const storeId = clean(input.storeId, 160);
  const proposalId = clean(input.proposalId, 160);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  if (!storeId || !proposalId || requestedByUserId !== storeId) {
    throw new Error('MERCADO_LIVRE_KYRUBIA_COMMERCIAL_READINESS_TARGET_INVALID');
  }

  const proposalRef = adminDb.doc(
    `stores/${storeId}/catalogOutboundPublicationProposals/${proposalId}`
  );
  const requirementsRef = adminDb.doc(
    `stores/${storeId}/catalogOutboundRequirementConfigurations/${proposalId}`
  );
  const commercialRef = adminDb.doc(
    `stores/${storeId}/catalogOutboundCommercialConfigurations/${proposalId}`
  );
  const [proposalDoc, requirementsDoc, commercialDoc] = await Promise.all([
    proposalRef.get(),
    requirementsRef.get(),
    commercialRef.get(),
  ]);
  const proposal = assertProposal(storeId, proposalId, proposalDoc.data());
  const requirementConfiguration = assertRequirementConfiguration(
    proposal,
    requirementsDoc.data()
  );

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

  const providerRequirements = await inspectMercadoLivreCommercialRequirements({
    storeId,
    categoryId: proposal.providerCategoryId,
    externalAccountId: connection.externalAccountId,
    siteId: proposal.providerSiteId,
    title: proposal.canonical.name,
    price: proposal.canonical.price,
    currencyId: proposal.providerCurrencyId,
    listingTypeId: proposal.providerListingTypeId,
    condition: proposal.providerCondition,
    attributes: requirementConfiguration.attributes,
  });
  const configuredShipping = commercialDoc.exists
    ? configuredShippingFrom(
        proposal,
        requirementConfiguration,
        commercialDoc.data()
      )
    : null;
  const configuredSaleTermIds = commercialDoc.exists
    ? configuredSaleTermIdsFrom(
        proposal,
        requirementConfiguration,
        commercialDoc.data()
      )
    : new Set<string>();
  const requiredSaleTerms = providerRequirements.saleTerms
    .filter(term => term.required)
    .map(term => ({ id: term.id, name: term.name }));

  return {
    proposalId,
    allowedShippingModes: providerRequirements.shipping.allowedModes,
    sellerShippingModes: providerRequirements.shipping.sellerModes,
    categoryShippingModes: providerRequirements.shipping.categoryModes,
    localPickUpAvailable: providerRequirements.shipping.localPickUpAvailable,
    configuredShipping,
    requiredSaleTerms,
    missingRequiredSaleTermIds: requiredSaleTerms
      .map(term => term.id)
      .filter(id => !configuredSaleTermIds.has(id)),
    authority: 'provider_api_commercial_options',
  };
};
