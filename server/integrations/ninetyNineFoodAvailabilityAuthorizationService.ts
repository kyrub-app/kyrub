import { createHash, randomBytes } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin';

const PROVIDER = '99food' as const;
const AUTHORITY = 'store_owner_99food_availability_authorization' as const;
const PROPOSAL_AUTHORITY = 'kyrub_channel_availability_snapshot_and_store_owner_mapping' as const;
const IDENTITY_AUTHORITY = 'provider_merchant_snapshot_exact_identity_match' as const;
const SNAPSHOT_AUTHORITY = 'kyrub_inventory_reservation_policy_snapshot' as const;
const BINDING_AUTHORITY = 'store_owner_product_mapping' as const;
const AUTHORIZATION_TTL_MS = 15 * 60 * 1000;

const clean = (value: unknown, maximum = 500): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().slice(0, maximum)
    : '';

const integer = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const canonicalStoreIdForTenant = async (tenantId: string): Promise<string> => {
  const tenant = await adminDb.doc(`tenants/${tenantId}`).get();
  const canonicalStoreId = clean(tenant.data()?.canonicalStoreId, 160);
  if (!canonicalStoreId) throw new Error('NINETY_NINE_FOOD_AVAILABILITY_AUTHORIZATION_CANONICAL_STORE_REQUIRED');
  return canonicalStoreId;
};

const proposalPath = (canonicalStoreId: string, proposalId: string): string =>
  `stores/${canonicalStoreId}/ninetyNineFoodAvailabilityProposals/${proposalId}`;
const authorizationPath = (canonicalStoreId: string, authorizationId: string): string =>
  `stores/${canonicalStoreId}/ninetyNineFoodAvailabilityAuthorizations/${authorizationId}`;
const currentIdentityPath = (canonicalStoreId: string, bindingId: string): string =>
  `stores/${canonicalStoreId}/ninetyNineFoodCatalogIdentityCurrent/${bindingId}`;

export interface NinetyNineFoodAvailabilityAuthorization {
  schemaVersion: 1;
  id: string;
  provider: typeof PROVIDER;
  tenantId: string;
  canonicalStoreId: string;
  proposalId: string;
  canonicalProductId: string;
  bindingId: string;
  bindingRevision: number;
  externalStoreId: string;
  externalProductId: string;
  channelAvailabilitySnapshotId: string;
  channelAvailabilitySourceFingerprint: string;
  policyRevision: number;
  targetAvailableQuantity: number;
  catalogIdentityResolutionId: string;
  catalogIdentityProviderEvidenceHash: string;
  capabilitySnapshotId: string;
  capabilityManifestHash: string;
  providerMenuId: string;
  providerItemOfferId: string;
  providerItemExternalCode: string;
  intendedMutation: {
    contract: 'merchant_v2_item_offer_quantity_available';
    field: 'quantityAvailable';
    value: number;
  };
  intendedMutationHash: string;
  tokenHash: string;
  useCount: 0;
  status: 'authorized';
  executionStatus: 'not_executed';
  authority: typeof AUTHORITY;
  authorizedByUserId: string;
  authorizedAt: string;
  expiresAt: string;
}

export const authorizeNinetyNineFoodAvailability = async (input: {
  tenantId: string;
  proposalId: string;
  authorizedByUserId: string;
}): Promise<{ authorization: Omit<NinetyNineFoodAvailabilityAuthorization, 'tokenHash'>; authorizationToken: string }> => {
  const tenantId = clean(input.tenantId, 160);
  const proposalId = clean(input.proposalId, 160);
  const authorizedByUserId = clean(input.authorizedByUserId, 160);
  if (!tenantId || !proposalId || authorizedByUserId !== tenantId) {
    throw new Error('NINETY_NINE_FOOD_AVAILABILITY_AUTHORIZATION_INPUT_INVALID');
  }

  const canonicalStoreId = await canonicalStoreIdForTenant(tenantId);
  const proposalReference = adminDb.doc(proposalPath(canonicalStoreId, proposalId));
  const proposalDocument = await proposalReference.get();
  if (!proposalDocument.exists) throw new Error('NINETY_NINE_FOOD_AVAILABILITY_AUTHORIZATION_PROPOSAL_NOT_FOUND');
  const proposal = proposalDocument.data() as Record<string, unknown>;

  const bindingId = clean(proposal.bindingId, 160);
  const bindingRevision = integer(proposal.bindingRevision);
  const canonicalProductId = clean(proposal.canonicalProductId, 160);
  const externalStoreId = clean(proposal.externalStoreId, 500);
  const externalProductId = clean(proposal.externalProductId, 500);
  const snapshotId = clean(proposal.channelAvailabilitySnapshotId, 160);
  const sourceFingerprint = clean(proposal.channelAvailabilitySourceFingerprint, 160);
  const policyRevision = integer(proposal.policyRevision);
  const targetAvailableQuantity = integer(proposal.targetAvailableQuantity);
  if (
    proposal.provider !== PROVIDER ||
    clean(proposal.tenantId, 160) !== tenantId ||
    clean(proposal.canonicalStoreId, 160) !== canonicalStoreId ||
    proposal.authority !== PROPOSAL_AUTHORITY ||
    !bindingId || bindingRevision === null || bindingRevision < 1 || !canonicalProductId ||
    !externalStoreId || !externalProductId || !snapshotId || !sourceFingerprint ||
    policyRevision === null || policyRevision < 1 || targetAvailableQuantity === null ||
    proposal.status !== 'review_required' || proposal.executionStatus !== 'not_authorized'
  ) {
    throw new Error('NINETY_NINE_FOOD_AVAILABILITY_AUTHORIZATION_PROPOSAL_INVALID');
  }

  const [bindingDocument, snapshotDocument, identityDocument, capabilityDocument] = await Promise.all([
    adminDb.doc(`stores/${canonicalStoreId}/externalProductBindings/${bindingId}`).get(),
    adminDb.doc(`stores/${canonicalStoreId}/channelAvailabilitySnapshots/${snapshotId}`).get(),
    adminDb.doc(currentIdentityPath(canonicalStoreId, bindingId)).get(),
    adminDb.doc(`integrationConnections/${tenantId}__${PROVIDER}/capabilityState/menu`).get(),
  ]);
  if (!bindingDocument.exists) throw new Error('NINETY_NINE_FOOD_AVAILABILITY_AUTHORIZATION_BINDING_STALE');
  if (!snapshotDocument.exists) throw new Error('NINETY_NINE_FOOD_AVAILABILITY_AUTHORIZATION_SNAPSHOT_STALE');
  if (!identityDocument.exists) throw new Error('NINETY_NINE_FOOD_AVAILABILITY_AUTHORIZATION_IDENTITY_REQUIRED');
  if (!capabilityDocument.exists) throw new Error('NINETY_NINE_FOOD_AVAILABILITY_AUTHORIZATION_CAPABILITY_REQUIRED');

  const binding = bindingDocument.data() as Record<string, unknown>;
  const snapshot = snapshotDocument.data() as Record<string, unknown>;
  const identity = identityDocument.data() as Record<string, unknown>;
  const capability = capabilityDocument.data() as Record<string, unknown>;

  if (
    binding.provider !== PROVIDER || binding.bindingAuthority !== BINDING_AUTHORITY || binding.status !== 'active' ||
    clean(binding.id, 160) !== bindingId || integer(binding.revision) !== bindingRevision ||
    clean(binding.canonicalProductId, 160) !== canonicalProductId ||
    clean(binding.externalStoreId, 500) !== externalStoreId || clean(binding.externalProductId, 500) !== externalProductId
  ) {
    throw new Error('NINETY_NINE_FOOD_AVAILABILITY_AUTHORIZATION_BINDING_STALE');
  }

  if (
    clean(snapshot.snapshotId, 160) !== snapshotId || clean(snapshot.storeId, 160) !== canonicalStoreId ||
    clean(snapshot.productId, 160) !== canonicalProductId || clean(snapshot.channel, 80) !== PROVIDER ||
    snapshot.authority !== SNAPSHOT_AUTHORITY || clean(snapshot.sourceFingerprint, 160) !== sourceFingerprint ||
    integer(snapshot.policyRevision) !== policyRevision || integer(snapshot.publishableUnits) !== targetAvailableQuantity ||
    clean(snapshot.inventoryAuthorityOwnerUserId, 160) !== tenantId
  ) {
    throw new Error('NINETY_NINE_FOOD_AVAILABILITY_AUTHORIZATION_SNAPSHOT_STALE');
  }

  const identityResolutionId = clean(identity.id, 160);
  const identityProviderEvidenceHash = clean(identity.providerEvidenceHash, 128);
  const capabilitySnapshotId = clean(identity.capabilitySnapshotId, 160);
  const capabilityManifestHash = clean(identity.capabilityManifestHash, 128);
  const providerMenuId = clean(identity.providerMenuId, 160);
  const providerItemOfferId = clean(identity.providerItemOfferId, 500);
  const providerItemExternalCode = clean(identity.providerItemExternalCode, 500);
  if (
    identity.provider !== PROVIDER || clean(identity.tenantId, 160) !== tenantId ||
    clean(identity.canonicalStoreId, 160) !== canonicalStoreId || clean(identity.bindingId, 160) !== bindingId ||
    integer(identity.bindingRevision) !== bindingRevision || identity.status !== 'resolved' ||
    identity.authority !== 'latest_provider_merchant_catalog_identity_pointer' ||
    !identityResolutionId || !identityProviderEvidenceHash || !capabilitySnapshotId || !capabilityManifestHash ||
    !providerMenuId || !providerItemOfferId
  ) {
    throw new Error('NINETY_NINE_FOOD_AVAILABILITY_AUTHORIZATION_IDENTITY_STALE');
  }
  if (
    capability.provider !== PROVIDER || clean(capability.tenantId, 160) !== tenantId ||
    clean(capability.id, 160) !== capabilitySnapshotId || clean(capability.manifestHash, 128) !== capabilityManifestHash ||
    capability.status !== 'merchant_v2_candidate' || capability.supportsPartialUpdate !== true
  ) {
    throw new Error('NINETY_NINE_FOOD_AVAILABILITY_AUTHORIZATION_CAPABILITY_STALE');
  }

  const intendedMutation = {
    contract: 'merchant_v2_item_offer_quantity_available' as const,
    field: 'quantityAvailable' as const,
    value: targetAvailableQuantity,
  };
  const intendedMutationHash = sha256(JSON.stringify({
    merchantId: externalStoreId,
    menuId: providerMenuId,
    itemOfferId: providerItemOfferId,
    mutation: intendedMutation,
    proposalId,
    snapshotId,
    sourceFingerprint,
    bindingId,
    bindingRevision,
    capabilityManifestHash,
    identityProviderEvidenceHash,
  }));
  const authorizationToken = randomBytes(32).toString('base64url');
  const tokenHash = sha256(authorizationToken);
  const authorizationId = `99faa_${randomBytes(20).toString('hex')}`;
  const authorizedAtDate = new Date();
  const expiresAtDate = new Date(authorizedAtDate.getTime() + AUTHORIZATION_TTL_MS);
  const authorization: NinetyNineFoodAvailabilityAuthorization = {
    schemaVersion: 1,
    id: authorizationId,
    provider: PROVIDER,
    tenantId,
    canonicalStoreId,
    proposalId,
    canonicalProductId,
    bindingId,
    bindingRevision,
    externalStoreId,
    externalProductId,
    channelAvailabilitySnapshotId: snapshotId,
    channelAvailabilitySourceFingerprint: sourceFingerprint,
    policyRevision,
    targetAvailableQuantity,
    catalogIdentityResolutionId: identityResolutionId,
    catalogIdentityProviderEvidenceHash: identityProviderEvidenceHash,
    capabilitySnapshotId,
    capabilityManifestHash,
    providerMenuId,
    providerItemOfferId,
    providerItemExternalCode,
    intendedMutation,
    intendedMutationHash,
    tokenHash,
    useCount: 0,
    status: 'authorized',
    executionStatus: 'not_executed',
    authority: AUTHORITY,
    authorizedByUserId,
    authorizedAt: authorizedAtDate.toISOString(),
    expiresAt: expiresAtDate.toISOString(),
  };
  const authorizationReference = adminDb.doc(authorizationPath(canonicalStoreId, authorizationId));

  await adminDb.runTransaction(async transaction => {
    const [currentProposal, currentBinding, currentSnapshot, currentIdentity, currentCapability] = await Promise.all([
      transaction.get(proposalReference),
      transaction.get(adminDb.doc(`stores/${canonicalStoreId}/externalProductBindings/${bindingId}`)),
      transaction.get(adminDb.doc(`stores/${canonicalStoreId}/channelAvailabilitySnapshots/${snapshotId}`)),
      transaction.get(adminDb.doc(currentIdentityPath(canonicalStoreId, bindingId))),
      transaction.get(adminDb.doc(`integrationConnections/${tenantId}__${PROVIDER}/capabilityState/menu`)),
    ]);
    const proposalNow = currentProposal.data() as Record<string, unknown> | undefined;
    const bindingNow = currentBinding.data() as Record<string, unknown> | undefined;
    const snapshotNow = currentSnapshot.data() as Record<string, unknown> | undefined;
    const identityNow = currentIdentity.data() as Record<string, unknown> | undefined;
    const capabilityNow = currentCapability.data() as Record<string, unknown> | undefined;
    if (!proposalNow || proposalNow.status !== 'review_required' || proposalNow.executionStatus !== 'not_authorized') {
      throw new Error('NINETY_NINE_FOOD_AVAILABILITY_AUTHORIZATION_PROPOSAL_STALE');
    }
    if (!bindingNow || bindingNow.status !== 'active' || integer(bindingNow.revision) !== bindingRevision) {
      throw new Error('NINETY_NINE_FOOD_AVAILABILITY_AUTHORIZATION_BINDING_STALE');
    }
    if (!snapshotNow || clean(snapshotNow.sourceFingerprint, 160) !== sourceFingerprint || integer(snapshotNow.publishableUnits) !== targetAvailableQuantity) {
      throw new Error('NINETY_NINE_FOOD_AVAILABILITY_AUTHORIZATION_SNAPSHOT_STALE');
    }
    if (!identityNow || clean(identityNow.id, 160) !== identityResolutionId || clean(identityNow.providerEvidenceHash, 128) !== identityProviderEvidenceHash || identityNow.status !== 'resolved') {
      throw new Error('NINETY_NINE_FOOD_AVAILABILITY_AUTHORIZATION_IDENTITY_STALE');
    }
    if (!capabilityNow || clean(capabilityNow.id, 160) !== capabilitySnapshotId || clean(capabilityNow.manifestHash, 128) !== capabilityManifestHash || capabilityNow.supportsPartialUpdate !== true) {
      throw new Error('NINETY_NINE_FOOD_AVAILABILITY_AUTHORIZATION_CAPABILITY_STALE');
    }

    transaction.create(authorizationReference, {
      ...authorization,
      tokenExpiresAt: Timestamp.fromDate(expiresAtDate),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(proposalReference, {
      status: 'authorized',
      executionStatus: 'authorized',
      activeAuthorizationId: authorizationId,
      authorizedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  const { tokenHash: _tokenHash, ...publicAuthorization } = authorization;
  return { authorization: publicAuthorization, authorizationToken };
};
