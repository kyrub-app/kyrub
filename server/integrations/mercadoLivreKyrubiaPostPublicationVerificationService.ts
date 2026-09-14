import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { mercadoLivreGetJson } from './mercadoLivreOauthService.js';
import { reconcileMercadoLivrePublishedItem } from './mercadoLivrePostPublicationReconciliationService.js';

type ProviderAttribute = {
  id?: unknown;
  value_id?: unknown;
  value_name?: unknown;
  values?: unknown;
};

type ProviderItem = {
  id?: unknown;
  user_product_id?: unknown;
  title?: unknown;
  family_name?: unknown;
  price?: unknown;
  currency_id?: unknown;
  status?: unknown;
  category_id?: unknown;
  listing_type_id?: unknown;
  condition?: unknown;
  attributes?: unknown;
};

type ProviderUserProduct = {
  id?: unknown;
  family_name?: unknown;
  attributes?: unknown;
};

type ProposalRecord = {
  schemaVersion: 2;
  id: string;
  storeId: string;
  provider: 'mercado_livre';
  executionStatus: 'published';
  publicationExecutionId: string;
  externalItemId: string;
  externalUserProductId?: string;
  externalCatalogBindingId: string;
};

type ExecutionRecord = {
  schemaVersion: 2;
  id: string;
  proposalId: string;
  authorizationId: string;
  storeId: string;
  provider: 'mercado_livre';
  status: 'published';
  externalItemId: string;
  externalUserProductId?: string;
  bindingId: string;
  providerStatus?: string;
  providerPublicationModel: 'legacy_items' | 'user_products';
};

type AuthorizationRecord = {
  schemaVersion: 2;
  id: string;
  proposalId: string;
  storeId: string;
  provider: 'mercado_livre';
  consumptionStatus: 'consumed';
  externalItemId: string;
  externalUserProductId?: string;
  bindingId: string;
  payload: Record<string, unknown>;
};

export type MercadoLivreReadbackCheck = {
  field: string;
  status: 'match' | 'mismatch';
  expected: string;
  actual: string;
};

export type MercadoLivreKyrubiaPostPublicationVerificationResult = {
  proposalId: string;
  executionId: string;
  bindingId: string;
  externalItemId: string;
  externalUserProductId?: string;
  status: 'verified' | 'mismatch';
  providerStatus: string;
  providerTitle: string;
  providerPrice: number | null;
  providerCurrencyId: string;
  providerCategoryId: string;
  expectedAttributeCount: number;
  matchedAttributeCount: number;
  mismatches: string[];
  reconciliationStatus?: 'reconciled';
  alreadyReconciled?: boolean;
};

const clean = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const finiteNonNegative = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const safeId = (value: string): boolean => /^[a-zA-Z0-9_-]{1,180}$/.test(value);

const semantic = (value: unknown): string => clean(value, 600)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('pt-BR')
  .replace(/[^a-z0-9]+/g, '');

const display = (value: unknown): string => clean(value, 240) || '∅';

const assertProposal = (storeId: string, proposalId: string, value: unknown): ProposalRecord => {
  const proposal = record(value);
  if (
    proposal.schemaVersion !== 2 ||
    clean(proposal.id, 180) !== proposalId ||
    clean(proposal.storeId, 160) !== storeId ||
    proposal.provider !== 'mercado_livre' ||
    proposal.executionStatus !== 'published' ||
    !safeId(clean(proposal.publicationExecutionId, 180)) ||
    !safeId(clean(proposal.externalItemId, 180)) ||
    !safeId(clean(proposal.externalCatalogBindingId, 180))
  ) throw new Error('MERCADO_LIVRE_KYRUBIA_POST_PUBLICATION_PROPOSAL_NOT_RECONCILABLE');
  return proposal as unknown as ProposalRecord;
};

const assertExecution = (proposal: ProposalRecord, value: unknown): ExecutionRecord => {
  const execution = record(value);
  if (
    execution.schemaVersion !== 2 ||
    clean(execution.id, 180) !== proposal.publicationExecutionId ||
    clean(execution.proposalId, 180) !== proposal.id ||
    clean(execution.storeId, 160) !== proposal.storeId ||
    execution.provider !== 'mercado_livre' ||
    execution.status !== 'published' ||
    clean(execution.externalItemId, 180) !== proposal.externalItemId ||
    clean(execution.bindingId, 180) !== proposal.externalCatalogBindingId ||
    (execution.providerPublicationModel !== 'legacy_items' && execution.providerPublicationModel !== 'user_products') ||
    !safeId(clean(execution.authorizationId, 180)) ||
    (execution.providerPublicationModel === 'user_products' &&
      (!safeId(clean(execution.externalUserProductId, 180)) ||
        clean(execution.externalUserProductId, 180) !== clean(proposal.externalUserProductId, 180)))
  ) throw new Error('MERCADO_LIVRE_KYRUBIA_POST_PUBLICATION_EXECUTION_NOT_RECONCILABLE');
  return execution as unknown as ExecutionRecord;
};

const assertAuthorization = (execution: ExecutionRecord, value: unknown): AuthorizationRecord => {
  const authorization = record(value);
  if (
    authorization.schemaVersion !== 2 ||
    clean(authorization.id, 180) !== execution.authorizationId ||
    clean(authorization.proposalId, 180) !== execution.proposalId ||
    clean(authorization.storeId, 160) !== execution.storeId ||
    authorization.provider !== 'mercado_livre' ||
    authorization.consumptionStatus !== 'consumed' ||
    clean(authorization.externalItemId, 180) !== execution.externalItemId ||
    clean(authorization.bindingId, 180) !== execution.bindingId ||
    !authorization.payload || typeof authorization.payload !== 'object' || Array.isArray(authorization.payload) ||
    (execution.providerPublicationModel === 'user_products' &&
      clean(authorization.externalUserProductId, 180) !== clean(execution.externalUserProductId, 180))
  ) throw new Error('MERCADO_LIVRE_KYRUBIA_POST_PUBLICATION_AUTHORIZATION_STALE');
  return authorization as unknown as AuthorizationRecord;
};

const normalizeAttribute = (value: unknown): { id: string; valueId: string; valueName: string } | null => {
  const attribute = record(value) as ProviderAttribute;
  const id = clean(attribute.id, 160);
  if (!id) return null;
  const values = Array.isArray(attribute.values) ? attribute.values : [];
  const firstValue = record(values[0]);
  return {
    id,
    valueId: clean(attribute.value_id, 160) || clean(firstValue.id, 160),
    valueName: clean(attribute.value_name, 600) || clean(firstValue.name, 600),
  };
};

const normalizedAttributes = (value: unknown): Map<string, { valueId: string; valueName: string }> => {
  const result = new Map<string, { valueId: string; valueName: string }>();
  if (!Array.isArray(value)) return result;
  for (const candidate of value) {
    const attribute = normalizeAttribute(candidate);
    if (!attribute) continue;
    result.set(attribute.id, { valueId: attribute.valueId, valueName: attribute.valueName });
  }
  return result;
};

const pushCheck = (
  checks: MercadoLivreReadbackCheck[],
  field: string,
  expected: unknown,
  actual: unknown,
  matches: boolean
): void => {
  checks.push({
    field,
    status: matches ? 'match' : 'mismatch',
    expected: display(expected),
    actual: display(actual),
  });
};

export const compareMercadoLivrePublishedReadback = (input: {
  execution: {
    externalItemId: string;
    externalUserProductId?: string;
    providerStatus?: string;
    providerPublicationModel: 'legacy_items' | 'user_products';
  };
  payload: Record<string, unknown>;
  item: ProviderItem;
  userProduct?: ProviderUserProduct | null;
}): {
  checks: MercadoLivreReadbackCheck[];
  mismatches: string[];
  expectedAttributeCount: number;
  matchedAttributeCount: number;
} => {
  const checks: MercadoLivreReadbackCheck[] = [];
  const itemId = clean(input.item.id, 180);
  pushCheck(checks, 'item.id', input.execution.externalItemId, itemId, itemId === input.execution.externalItemId);

  const expectedUserProductId = clean(input.execution.externalUserProductId, 180);
  const observedUserProductId = clean(input.item.user_product_id, 180);
  if (input.execution.providerPublicationModel === 'user_products') {
    pushCheck(checks, 'item.user_product_id', expectedUserProductId, observedUserProductId, observedUserProductId === expectedUserProductId);
    const fetchedUserProductId = clean(input.userProduct?.id, 180);
    pushCheck(checks, 'user_product.id', expectedUserProductId, fetchedUserProductId, fetchedUserProductId === expectedUserProductId);
  }

  const categoryId = clean(input.payload.category_id, 160);
  if (categoryId) pushCheck(checks, 'item.category_id', categoryId, input.item.category_id, clean(input.item.category_id, 160) === categoryId);

  const listingTypeId = clean(input.payload.listing_type_id, 120);
  if (listingTypeId) pushCheck(checks, 'item.listing_type_id', listingTypeId, input.item.listing_type_id, clean(input.item.listing_type_id, 120) === listingTypeId);

  const condition = clean(input.payload.condition, 120);
  if (condition) pushCheck(checks, 'item.condition', condition, input.item.condition, clean(input.item.condition, 120) === condition);

  const currencyId = clean(input.payload.currency_id, 16);
  if (currencyId) pushCheck(checks, 'item.currency_id', currencyId, input.item.currency_id, clean(input.item.currency_id, 16) === currencyId);

  const expectedPrice = finiteNonNegative(input.payload.price);
  const actualPrice = finiteNonNegative(input.item.price);
  if (expectedPrice !== null) {
    pushCheck(checks, 'item.price', expectedPrice, actualPrice, actualPrice !== null && Math.abs(actualPrice - expectedPrice) < 0.000001);
  }

  if (input.execution.providerPublicationModel === 'legacy_items') {
    const expectedTitle = clean(input.payload.title, 120);
    if (expectedTitle) {
      pushCheck(checks, 'item.title', expectedTitle, input.item.title, semantic(input.item.title) === semantic(expectedTitle));
    }
  } else {
    const expectedFamilyName = clean(input.payload.family_name, 120);
    const actualFamilyName = clean(input.userProduct?.family_name, 120) || clean(input.item.family_name, 120);
    if (expectedFamilyName) {
      pushCheck(checks, 'user_product.family_name', expectedFamilyName, actualFamilyName, semantic(actualFamilyName) === semantic(expectedFamilyName));
    }
  }

  const itemAttributes = normalizedAttributes(input.item.attributes);
  const userProductAttributes = normalizedAttributes(input.userProduct?.attributes);
  const providerAttributes = new Map(itemAttributes);
  for (const [id, value] of userProductAttributes) providerAttributes.set(id, value);

  const expectedAttributes = Array.isArray(input.payload.attributes)
    ? input.payload.attributes.flatMap(candidate => {
        const attribute = normalizeAttribute(candidate);
        return attribute ? [attribute] : [];
      })
    : [];
  let matchedAttributeCount = 0;
  for (const expected of expectedAttributes) {
    const actual = providerAttributes.get(expected.id);
    const matches = Boolean(actual) && (
      expected.valueId
        ? actual?.valueId === expected.valueId
        : semantic(actual?.valueName) === semantic(expected.valueName)
    );
    if (matches) matchedAttributeCount += 1;
    pushCheck(
      checks,
      `attribute.${expected.id}`,
      expected.valueId || expected.valueName,
      actual?.valueId || actual?.valueName,
      matches
    );
  }

  const mismatches = checks
    .filter(check => check.status === 'mismatch')
    .map(check => `${check.field}: esperado ${check.expected}, recebido ${check.actual}`);
  return {
    checks,
    mismatches,
    expectedAttributeCount: expectedAttributes.length,
    matchedAttributeCount,
  };
};

export const verifyAndReconcileKyrubiaMercadoLivrePublication = async (input: {
  storeId: string;
  proposalId: string;
  verifiedByUserId: string;
}): Promise<MercadoLivreKyrubiaPostPublicationVerificationResult> => {
  const storeId = clean(input.storeId, 160);
  const proposalId = clean(input.proposalId, 180);
  const verifiedByUserId = clean(input.verifiedByUserId, 160);
  if (!storeId || verifiedByUserId !== storeId || !safeId(proposalId)) {
    throw new Error('MERCADO_LIVRE_KYRUBIA_POST_PUBLICATION_TARGET_INVALID');
  }

  const proposalRef = adminDb.doc(`stores/${storeId}/catalogOutboundPublicationProposals/${proposalId}`);
  const proposalDoc = await proposalRef.get();
  if (!proposalDoc.exists) throw new Error('MERCADO_LIVRE_KYRUBIA_POST_PUBLICATION_PROPOSAL_NOT_FOUND');
  const proposal = assertProposal(storeId, proposalId, proposalDoc.data());
  const executionRef = adminDb.doc(`stores/${storeId}/catalogOutboundPublicationExecutions/${proposal.publicationExecutionId}`);
  const executionDoc = await executionRef.get();
  if (!executionDoc.exists) throw new Error('MERCADO_LIVRE_PUBLICATION_EXECUTION_NOT_FOUND');
  const execution = assertExecution(proposal, executionDoc.data());
  const authorizationRef = adminDb.doc(`stores/${storeId}/catalogOutboundPublicationAuthorizations/${execution.authorizationId}`);
  const authorizationDoc = await authorizationRef.get();
  if (!authorizationDoc.exists) throw new Error('MERCADO_LIVRE_PUBLICATION_AUTHORIZATION_NOT_FOUND');
  const authorization = assertAuthorization(execution, authorizationDoc.data());

  const providerItem = await mercadoLivreGetJson<ProviderItem>(
    storeId,
    `/items/${encodeURIComponent(execution.externalItemId)}?include_attributes=all`
  );
  const providerUserProduct = execution.providerPublicationModel === 'user_products' && execution.externalUserProductId
    ? await mercadoLivreGetJson<ProviderUserProduct>(
        storeId,
        `/user-products/${encodeURIComponent(execution.externalUserProductId)}`
      )
    : null;

  const comparison = compareMercadoLivrePublishedReadback({
    execution,
    payload: authorization.payload,
    item: providerItem,
    userProduct: providerUserProduct,
  });
  const checkedAt = new Date().toISOString();
  const verificationRef = adminDb.doc(`stores/${storeId}/catalogOutboundPublicationReadbackVerifications/${execution.id}`);
  const providerTitle = clean(providerItem.title, 120);
  const providerStatus = clean(providerItem.status, 80);
  const providerPrice = finiteNonNegative(providerItem.price);
  const providerCurrencyId = clean(providerItem.currency_id, 16);
  const providerCategoryId = clean(providerItem.category_id, 160);

  if (comparison.mismatches.length > 0) {
    await verificationRef.set({
      schemaVersion: 1,
      id: execution.id,
      storeId,
      provider: 'mercado_livre',
      proposalId,
      executionId: execution.id,
      authorizationId: execution.authorizationId,
      bindingId: execution.bindingId,
      externalItemId: execution.externalItemId,
      ...(execution.externalUserProductId ? { externalUserProductId: execution.externalUserProductId } : {}),
      status: 'mismatch',
      authority: 'provider_api_post_publication_readback',
      checks: comparison.checks,
      mismatches: comparison.mismatches,
      expectedAttributeCount: comparison.expectedAttributeCount,
      matchedAttributeCount: comparison.matchedAttributeCount,
      providerStatus,
      providerTitle,
      providerPrice,
      providerCurrencyId,
      providerCategoryId,
      checkedByUserId: verifiedByUserId,
      checkedAt,
      serverCheckedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return {
      proposalId,
      executionId: execution.id,
      bindingId: execution.bindingId,
      externalItemId: execution.externalItemId,
      ...(execution.externalUserProductId ? { externalUserProductId: execution.externalUserProductId } : {}),
      status: 'mismatch',
      providerStatus,
      providerTitle,
      providerPrice,
      providerCurrencyId,
      providerCategoryId,
      expectedAttributeCount: comparison.expectedAttributeCount,
      matchedAttributeCount: comparison.matchedAttributeCount,
      mismatches: comparison.mismatches,
    };
  }

  const reconciliation = await reconcileMercadoLivrePublishedItem({
    storeId,
    executionId: execution.id,
    reconciledByUserId: verifiedByUserId,
  });

  await verificationRef.set({
    schemaVersion: 1,
    id: execution.id,
    storeId,
    provider: 'mercado_livre',
    proposalId,
    executionId: execution.id,
    authorizationId: execution.authorizationId,
    bindingId: execution.bindingId,
    externalItemId: execution.externalItemId,
    ...(execution.externalUserProductId ? { externalUserProductId: execution.externalUserProductId } : {}),
    status: 'verified',
    authority: 'provider_api_post_publication_readback',
    checks: comparison.checks,
    mismatches: [],
    expectedAttributeCount: comparison.expectedAttributeCount,
    matchedAttributeCount: comparison.matchedAttributeCount,
    providerStatus,
    providerTitle,
    providerPrice,
    providerCurrencyId,
    providerCategoryId,
    reconciliationStatus: reconciliation.reconciliationStatus,
    reconciliationSnapshotId: reconciliation.snapshotId,
    checkedByUserId: verifiedByUserId,
    checkedAt,
    serverCheckedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    proposalId,
    executionId: execution.id,
    bindingId: execution.bindingId,
    externalItemId: execution.externalItemId,
    ...(execution.externalUserProductId ? { externalUserProductId: execution.externalUserProductId } : {}),
    status: 'verified',
    providerStatus,
    providerTitle,
    providerPrice,
    providerCurrencyId,
    providerCategoryId,
    expectedAttributeCount: comparison.expectedAttributeCount,
    matchedAttributeCount: comparison.matchedAttributeCount,
    mismatches: [],
    reconciliationStatus: reconciliation.reconciliationStatus,
    alreadyReconciled: reconciliation.alreadyReconciled,
  };
};
