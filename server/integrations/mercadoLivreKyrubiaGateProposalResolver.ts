import { adminDb } from '../firebaseAdmin.js';

export type MercadoLivreKyrubiaGateKind = 'validate' | 'authorize' | 'publish';

export type MercadoLivreKyrubiaGateProposalCandidate = {
  proposalId: string;
  canonicalProductId: string;
  productName: string;
  categoryId: string;
  categoryName: string;
  condition: string;
  listingTypeId: string;
  listingTypeName: string;
  executionStatus: string;
  publicationReadiness: string;
  configuredAt: string;
};

export type MercadoLivreKyrubiaGateProposalResolution =
  | {
      status: 'resolved';
      candidate: MercadoLivreKyrubiaGateProposalCandidate;
    }
  | {
      status: 'ambiguous';
      candidates: MercadoLivreKyrubiaGateProposalCandidate[];
    }
  | {
      status: 'not_found';
      candidates: MercadoLivreKyrubiaGateProposalCandidate[];
    };

const clean = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const isSafeProposalId = (value: string): boolean =>
  /^[a-zA-Z0-9_-]{1,180}$/.test(value);

const normalizeCandidate = (
  storeId: string,
  proposalValue: unknown,
  configurationValue: unknown
): MercadoLivreKyrubiaGateProposalCandidate | null => {
  const proposal = record(proposalValue);
  const configuration = record(configurationValue);
  const canonical = record(proposal.canonical);
  const category = record(configuration.category);
  const listingType = record(configuration.listingType);
  const proposalId = clean(proposal.id, 180);
  const canonicalProductId = clean(proposal.canonicalProductId, 160);
  const productName = clean(canonical.name, 180);
  const categoryId = clean(category.id, 160);
  const categoryName = clean(category.name, 180);
  const condition = clean(configuration.condition, 120);
  const listingTypeId = clean(listingType.id, 120);
  const listingTypeName = clean(listingType.name, 180);
  const executionStatus = clean(proposal.executionStatus, 80);
  const publicationReadiness = clean(proposal.publicationReadiness, 80);
  const configuredAt = clean(configuration.configuredAt, 80);

  if (
    proposal.schemaVersion !== 2 ||
    clean(proposal.storeId, 160) !== storeId ||
    proposal.provider !== 'mercado_livre' ||
    proposal.action !== 'create_external_listing' ||
    proposal.status !== 'review_required' ||
    !proposalId || !isSafeProposalId(proposalId) ||
    !canonicalProductId || !productName ||
    configuration.schemaVersion !== 2 ||
    clean(configuration.proposalId, 180) !== proposalId ||
    configuration.ready !== true ||
    !configuredAt || !categoryId || !categoryName ||
    !condition || !listingTypeId || !listingTypeName
  ) {
    return null;
  }

  return {
    proposalId,
    canonicalProductId,
    productName,
    categoryId,
    categoryName,
    condition,
    listingTypeId,
    listingTypeName,
    executionStatus,
    publicationReadiness,
    configuredAt,
  };
};

const eligibleForGate = (
  gate: MercadoLivreKyrubiaGateKind,
  candidate: MercadoLivreKyrubiaGateProposalCandidate,
  proposalValue: unknown
): boolean => {
  const proposal = record(proposalValue);
  if (gate === 'validate') {
    return candidate.executionStatus === 'not_authorized';
  }
  if (gate === 'authorize') {
    return candidate.executionStatus === 'not_authorized' &&
      candidate.publicationReadiness === 'ready_for_owner_authorization' &&
      proposal.publicationReadinessAuthority === 'provider_items_validate' &&
      proposal.publicationValidationSource === 'kyrubia_revalidated_draft';
  }
  return candidate.executionStatus === 'authorized';
};

export const resolveMercadoLivreKyrubiaGateProposal = async (input: {
  storeId: string;
  gate: MercadoLivreKyrubiaGateKind;
  requestedProposalId?: string;
}): Promise<MercadoLivreKyrubiaGateProposalResolution> => {
  const storeId = clean(input.storeId, 160);
  const requestedProposalId = clean(input.requestedProposalId, 180);
  if (!storeId || (requestedProposalId && !isSafeProposalId(requestedProposalId))) {
    return { status: 'not_found', candidates: [] };
  }

  const proposalSnapshot = await adminDb
    .collection(`stores/${storeId}/catalogOutboundPublicationProposals`)
    .limit(100)
    .get();

  const proposalDocs = requestedProposalId
    ? proposalSnapshot.docs.filter(doc => doc.id === requestedProposalId)
    : proposalSnapshot.docs;

  const candidates = (await Promise.all(proposalDocs.map(async proposalDoc => {
    const proposalValue = proposalDoc.data();
    const proposalId = clean((proposalValue as Record<string, unknown>).id, 180) || proposalDoc.id;
    if (!proposalId || !isSafeProposalId(proposalId)) return null;
    const configurationDoc = await adminDb
      .doc(`stores/${storeId}/catalogOutboundRequirementConfigurations/${proposalId}`)
      .get();
    if (!configurationDoc.exists) return null;
    const candidate = normalizeCandidate(storeId, proposalValue, configurationDoc.data());
    if (!candidate || !eligibleForGate(input.gate, candidate, proposalValue)) return null;
    return candidate;
  })))
    .filter((candidate): candidate is MercadoLivreKyrubiaGateProposalCandidate => Boolean(candidate))
    .sort((left, right) => right.configuredAt.localeCompare(left.configuredAt));

  if (candidates.length === 1) {
    return { status: 'resolved', candidate: candidates[0] };
  }
  if (candidates.length > 1) {
    return { status: 'ambiguous', candidates: candidates.slice(0, 8) };
  }
  return { status: 'not_found', candidates: [] };
};
