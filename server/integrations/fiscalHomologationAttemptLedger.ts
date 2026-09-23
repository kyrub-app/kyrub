import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { getPrimaryUserStoreDocumentPath } from '../../src/utils/storePaths.js';
import { hasStoreFiscalPermission } from '../../src/utils/storeSecurity.js';
import type {
  FiscalHomologationAttempt,
  FiscalHomologationAttemptConsumerEvidence,
  FiscalHomologationAttemptPolicyEvidence,
  FiscalHomologationAttemptTriggerEvidence,
} from '../../shared/fiscalHomologationAttempt.js';
import { loadCanonicalFiscalPreflight } from './fiscalPreflightReadService.js';

const ORDER_ID_PATTERN = /^[a-zA-Z0-9:_-]{1,240}$/;

const clean = (value: unknown, maxLength = 240): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const requiredIsoTimestamp = (value: Date): string => {
  const timestamp = value.toISOString();
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error('FISCAL_ATTEMPT_TIMESTAMP_INVALID');
  }
  return timestamp;
};

const stableFingerprint = (value: unknown): string => createHash('sha256')
  .update(JSON.stringify(value))
  .digest('hex');

const attemptPath = (canonicalStoreId: string, attemptId: string): string =>
  `stores/${canonicalStoreId}/fiscalAttempts/${attemptId}`;

const resolveOwnerAuthority = async (input: {
  tenantId: string;
  requestedByUserId: string;
}): Promise<string> => {
  const tenantId = clean(input.tenantId, 160);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  if (!tenantId || tenantId !== requestedByUserId) {
    throw new Error('FISCAL_ATTEMPT_FORBIDDEN');
  }
  if (!hasStoreFiscalPermission('owner', 'fiscal.homologation.emit')) {
    throw new Error('FISCAL_ATTEMPT_FORBIDDEN');
  }

  const [tenantSnapshot, privateStoreSnapshot] = await Promise.all([
    adminDb.doc(`tenants/${tenantId}`).get(),
    adminDb.doc(getPrimaryUserStoreDocumentPath(tenantId)).get(),
  ]);
  const tenant = record(tenantSnapshot.data());
  const privateStore = record(privateStoreSnapshot.data());
  if (
    !tenantSnapshot.exists ||
    !privateStoreSnapshot.exists ||
    clean(tenant.ownerId, 160) !== requestedByUserId ||
    clean(privateStore.ownerId, 160) !== requestedByUserId
  ) {
    throw new Error('FISCAL_ATTEMPT_FORBIDDEN');
  }

  const tenantCanonicalStoreId = clean(tenant.canonicalStoreId, 160);
  const privateCanonicalStoreId = clean(privateStore.canonicalStoreId, 160);
  const canonicalStoreId = tenantCanonicalStoreId || privateCanonicalStoreId;
  if (
    !canonicalStoreId ||
    (tenantCanonicalStoreId &&
      privateCanonicalStoreId &&
      tenantCanonicalStoreId !== privateCanonicalStoreId)
  ) {
    throw new Error('FISCAL_ATTEMPT_CANONICAL_STORE_REQUIRED');
  }

  const [canonicalStoreSnapshot, membershipSnapshot] = await Promise.all([
    adminDb.doc(`stores/${canonicalStoreId}`).get(),
    adminDb.doc(`stores/${canonicalStoreId}/members/${requestedByUserId}`).get(),
  ]);
  const canonicalStore = record(canonicalStoreSnapshot.data());
  if (
    !canonicalStoreSnapshot.exists ||
    clean(canonicalStore.ownerId, 160) !== requestedByUserId ||
    (clean(canonicalStore.legacyTenantId, 160) &&
      clean(canonicalStore.legacyTenantId, 160) !== tenantId)
  ) {
    throw new Error('FISCAL_ATTEMPT_FORBIDDEN');
  }

  if (membershipSnapshot.exists) {
    const membership = record(membershipSnapshot.data());
    if (
      clean(membership.userId, 160) !== requestedByUserId ||
      membership.role !== 'owner' ||
      membership.status !== 'active'
    ) {
      throw new Error('FISCAL_ATTEMPT_FORBIDDEN');
    }
  }

  return canonicalStoreId;
};

const buildAttemptFromPreflight = (input: {
  canonicalStoreId: string;
  requestedByUserId: string;
  orderId: string;
  now: Date;
  preflight: Awaited<ReturnType<typeof loadCanonicalFiscalPreflight>>;
}): FiscalHomologationAttempt => {
  const { preflight } = input;
  const policy = preflight.evidence.homologationPolicy;
  const trigger = preflight.evidence.operationalTrigger;
  if (
    preflight.canonicalStoreId !== input.canonicalStoreId ||
    preflight.simulation.preflightStatus !== 'ready_for_homologation' ||
    policy.status !== 'approved' ||
    !policy.policyId ||
    typeof policy.version !== 'number' ||
    !policy.policyReference ||
    !policy.effectiveFrom ||
    !policy.operationScope ||
    !policy.documentFamily ||
    !policy.operationalTrigger ||
    policy.environment !== 'sandbox' ||
    preflight.simulation.execution.emissionAuthority !== 'none_homologation_only' ||
    preflight.simulation.execution.providerCallAllowed !== false ||
    preflight.simulation.execution.sefazCallAllowed !== false ||
    preflight.simulation.execution.documentFamily !== policy.documentFamily ||
    preflight.simulation.execution.fiscalTrigger !== policy.operationalTrigger ||
    trigger.trigger !== policy.operationalTrigger ||
    trigger.satisfied !== true ||
    trigger.authority !== 'canonical_payment_projection'
  ) {
    throw new Error('FISCAL_ATTEMPT_PREFLIGHT_NOT_READY');
  }

  const policyEvidence: FiscalHomologationAttemptPolicyEvidence = {
    policyId: policy.policyId,
    version: policy.version,
    policyReference: policy.policyReference,
    effectiveFrom: policy.effectiveFrom,
    operationScope: policy.operationScope,
    documentFamily: policy.documentFamily,
    operationalTrigger: policy.operationalTrigger,
    environment: 'sandbox',
  };
  const consumerIdentity: FiscalHomologationAttemptConsumerEvidence = {
    status: preflight.evidence.consumerIdentity.status,
    identifierKind: preflight.evidence.consumerIdentity.identifierKind,
    maskedTaxIdentifier: preflight.evidence.consumerIdentity.maskedTaxIdentifier,
  };
  const triggerEvidence: FiscalHomologationAttemptTriggerEvidence = {
    trigger: policy.operationalTrigger,
    satisfied: true,
    authority: 'canonical_payment_projection',
    payment: trigger.payment,
  };
  const productPreparation = [...preflight.evidence.productPreparation]
    .map(item => ({ ...item }))
    .sort((a, b) => `${a.productId}:${a.kind}`.localeCompare(`${b.productId}:${b.kind}`));
  const actor = {
    userId: input.requestedByUserId,
    resolvedRole: 'owner' as const,
    requiredPermission: 'fiscal.homologation.emit' as const,
    authorizationMode: 'canonical_store_owner_fallback' as const,
  };

  const fingerprintInput = {
    canonicalStoreId: input.canonicalStoreId,
    orderId: input.orderId,
    sourceChannel: preflight.evidence.sourceChannel,
    environment: 'sandbox' as const,
    policy: policyEvidence,
    issuerIdentity: preflight.evidence.issuerIdentity,
    consumerIdentity,
    productPreparation,
    triggerEvidence,
    actor,
  };
  const evidenceFingerprint = stableFingerprint(fingerprintInput);
  const attemptId = `fiscal-attempt-${evidenceFingerprint.slice(0, 48)}`;
  const timestamp = requiredIsoTimestamp(input.now);

  return {
    schemaVersion: 1,
    attemptId,
    evidenceFingerprint,
    canonicalStoreId: input.canonicalStoreId,
    orderId: input.orderId,
    sourceChannel: preflight.evidence.sourceChannel,
    environment: 'sandbox',
    policy: policyEvidence,
    issuerIdentity: { ...preflight.evidence.issuerIdentity },
    consumerIdentity,
    productPreparation,
    triggerEvidence,
    actor,
    state: 'prepared',
    providerAdapterId: null,
    providerAdapterVersion: null,
    externalRequestId: null,
    authorizationProtocol: null,
    accessKey: null,
    documentNumber: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    authority: 'kyrub_fiscal_homologation_attempt_ledger',
  };
};

const parseExistingAttempt = (
  value: unknown,
  expected: FiscalHomologationAttempt
): FiscalHomologationAttempt => {
  const stored = record(value);
  if (
    stored.schemaVersion !== 1 ||
    clean(stored.attemptId, 160) !== expected.attemptId ||
    clean(stored.evidenceFingerprint, 80) !== expected.evidenceFingerprint ||
    clean(stored.canonicalStoreId, 160) !== expected.canonicalStoreId ||
    clean(stored.orderId, 240) !== expected.orderId ||
    stored.environment !== 'sandbox' ||
    stored.authority !== 'kyrub_fiscal_homologation_attempt_ledger'
  ) {
    throw new Error('FISCAL_ATTEMPT_STORED_RECORD_INVALID');
  }

  return stored as unknown as FiscalHomologationAttempt;
};

export interface PrepareFiscalHomologationAttemptResult {
  schemaVersion: 1;
  reused: boolean;
  attemptPath: string;
  attempt: FiscalHomologationAttempt;
}

export const prepareFiscalHomologationAttempt = async (input: {
  tenantId: string;
  requestedByUserId: string;
  orderId: string;
  now?: Date;
}): Promise<PrepareFiscalHomologationAttemptResult> => {
  const tenantId = clean(input.tenantId, 160);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  const orderId = clean(input.orderId, 240);
  if (!ORDER_ID_PATTERN.test(orderId)) {
    throw new Error('FISCAL_ATTEMPT_ORDER_ID_INVALID');
  }

  const canonicalStoreId = await resolveOwnerAuthority({
    tenantId,
    requestedByUserId,
  });

  // All fiscal evidence is re-read server-side immediately before preparation.
  // Browser input supplies only the order id; policy, trigger, actor, store and
  // readiness evidence are never accepted as trusted client fields.
  const preflight = await loadCanonicalFiscalPreflight({
    tenantId,
    requestedByUserId,
    orderId,
    now: input.now,
  });
  const attempt = buildAttemptFromPreflight({
    canonicalStoreId,
    requestedByUserId,
    orderId,
    now: input.now ?? new Date(),
    preflight,
  });
  const path = attemptPath(canonicalStoreId, attempt.attemptId);
  const attemptRef = adminDb.doc(path);

  return adminDb.runTransaction(async transaction => {
    const existingSnapshot = await transaction.get(attemptRef);
    if (existingSnapshot.exists) {
      return {
        schemaVersion: 1,
        reused: true,
        attemptPath: path,
        attempt: parseExistingAttempt(existingSnapshot.data(), attempt),
      };
    }

    transaction.create(attemptRef, {
      ...attempt,
      serverCreatedAt: FieldValue.serverTimestamp(),
      serverUpdatedAt: FieldValue.serverTimestamp(),
    });

    return {
      schemaVersion: 1,
      reused: false,
      attemptPath: path,
      attempt,
    };
  });
};
