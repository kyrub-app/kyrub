import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type { FiscalHomologationAttempt } from '../../shared/fiscalHomologationAttempt.js';
import type {
  FiscalDocumentLineSnapshot,
  FiscalExecutableDocumentSnapshot,
  FiscalProductProfileSnapshot,
} from '../../shared/fiscalExecutableDocument.js';
import { resolveFiscalHomologationOwnerAuthority } from './fiscalHomologationAttemptLedger.js';

const ATTEMPT_ID_PATTERN = /^fiscal-attempt-[a-f0-9]{48}$/;
const PRODUCT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

const clean = (value: unknown, maxLength = 240): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const nonNegativeInteger = (value: unknown, fallback = 0): number | null => {
  const resolved = value ?? fallback;
  return typeof resolved === 'number' && Number.isSafeInteger(resolved) && resolved >= 0
    ? resolved
    : null;
};

const money = (value: number): number => Number(value.toFixed(2));

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const stableFingerprint = (value: unknown): string =>
  sha256(JSON.stringify(value));

const normalizeTaxIdentifier = (value: unknown): string =>
  clean(value, 40).replace(/[^0-9A-Za-z]/g, '').toUpperCase();

const attemptPath = (canonicalStoreId: string, attemptId: string): string =>
  `stores/${canonicalStoreId}/fiscalAttempts/${attemptId}`;

const snapshotPath = (
  canonicalStoreId: string,
  attemptId: string,
  snapshotId: string
): string => `${attemptPath(canonicalStoreId, attemptId)}/fiscalDocumentSnapshots/${snapshotId}`;

const parseAttempt = (
  value: unknown,
  expected: { canonicalStoreId: string; attemptId: string; actorUserId: string }
): FiscalHomologationAttempt => {
  const stored = record(value);
  const policy = record(stored.policy);
  const actor = record(stored.actor);
  if (
    stored.schemaVersion !== 1 ||
    clean(stored.attemptId, 160) !== expected.attemptId ||
    clean(stored.canonicalStoreId, 160) !== expected.canonicalStoreId ||
    !clean(stored.orderId, 240) ||
    stored.environment !== 'sandbox' ||
    !['nfe', 'nfce', 'nfse'].includes(String(policy.documentFamily ?? '')) ||
    !['goods', 'service', 'mixed'].includes(String(policy.operationScope ?? '')) ||
    clean(actor.userId, 160) !== expected.actorUserId ||
    actor.requiredPermission !== 'fiscal.homologation.emit' ||
    stored.authority !== 'kyrub_fiscal_homologation_attempt_ledger'
  ) {
    throw new Error('FISCAL_ATTEMPT_STORED_RECORD_INVALID');
  }
  return stored as unknown as FiscalHomologationAttempt;
};

const parseFiscalProfile = (
  value: unknown,
  kind: 'goods' | 'service'
): FiscalProductProfileSnapshot => {
  const profile = record(value);
  if (
    profile.enabled !== true ||
    profile.kind !== kind ||
    !clean(profile.fiscalDescription, 200)
  ) {
    throw new Error('FISCAL_DOCUMENT_PRODUCT_PROFILE_INVALID');
  }

  if (kind === 'service') {
    const serviceListCode = clean(profile.serviceListCode, 20);
    const municipalServiceCode = clean(profile.municipalServiceCode, 30);
    if (!serviceListCode && !municipalServiceCode) {
      throw new Error('FISCAL_DOCUMENT_PRODUCT_PROFILE_INVALID');
    }
    return {
      kind: 'service',
      fiscalDescription: clean(profile.fiscalDescription, 200),
      serviceListCode,
      municipalServiceCode,
      nbs: clean(profile.nbs, 20),
    };
  }

  const ncm = clean(profile.ncm, 8);
  const cest = clean(profile.cest, 7);
  const commercialUnit = clean(profile.commercialUnit, 4);
  const taxUnit = clean(profile.taxUnit, 4);
  const conversionFactor = finite(profile.conversionFactor);
  const origin = clean(profile.origin, 1);
  const noGtin = profile.noGtin === true;
  const gtin = clean(profile.gtin, 14);
  if (
    !/^\d{8}$/.test(ncm) ||
    (cest && !/^\d{7}$/.test(cest)) ||
    !commercialUnit ||
    !taxUnit ||
    conversionFactor === null ||
    conversionFactor <= 0 ||
    !/^[0-8]$/.test(origin) ||
    (!noGtin && !/^\d{8,14}$/.test(gtin))
  ) {
    throw new Error('FISCAL_DOCUMENT_PRODUCT_PROFILE_INVALID');
  }

  return {
    kind: 'goods',
    fiscalDescription: clean(profile.fiscalDescription, 200),
    ncm,
    cest,
    gtin: noGtin ? '' : gtin,
    noGtin,
    commercialUnit,
    taxUnit,
    conversionFactor,
    origin,
  };
};

const buildLines = (input: {
  order: Record<string, unknown>;
  fiscalProfiles: Record<string, unknown>;
}): FiscalDocumentLineSnapshot[] => {
  if (!Array.isArray(input.order.items) || input.order.items.length === 0) {
    throw new Error('FISCAL_DOCUMENT_ORDER_INVALID');
  }

  return input.order.items.map((rawItem, index) => {
    const item = record(rawItem);
    const productId = clean(item.productId, 128);
    const productName = clean(item.name, 200);
    const lineId = clean(item.lineId, 180) || `line-${index + 1}`;
    const orderedQuantity = nonNegativeInteger(item.quantity);
    const transferredQuantity = nonNegativeInteger(item.transferredQuantity, 0);
    const voidedQuantity = nonNegativeInteger(item.voidedQuantity, 0);
    const unitPrice = finite(item.price);
    const discountAmount = finite(item.discountAmount ?? 0);
    if (
      !PRODUCT_ID_PATTERN.test(productId) ||
      !productName ||
      orderedQuantity === null || orderedQuantity <= 0 ||
      transferredQuantity === null ||
      voidedQuantity === null ||
      transferredQuantity + voidedQuantity >= orderedQuantity ||
      unitPrice === null || unitPrice < 0 ||
      discountAmount === null || discountAmount < 0
    ) {
      throw new Error('FISCAL_DOCUMENT_ORDER_LINE_INVALID');
    }

    const quantity = orderedQuantity - transferredQuantity - voidedQuantity;
    const gross = money(quantity * unitPrice);
    if (discountAmount > gross + 0.009) {
      throw new Error('FISCAL_DOCUMENT_ORDER_LINE_INVALID');
    }
    const kind: 'goods' | 'service' = item.isService === true ? 'service' : 'goods';
    const fiscalProfile = parseFiscalProfile(input.fiscalProfiles[productId], kind);

    return {
      lineId,
      productId,
      productName,
      kind,
      quantity,
      unitPrice: money(unitPrice),
      discountAmount: money(discountAmount),
      lineTotal: money(gross - discountAmount),
      fiscalProfile,
    };
  });
};

const sourceIdentityHashes = (input: {
  tenant: Record<string, unknown>;
  order: Record<string, unknown>;
}): { issuerTaxIdentifierHash: string; consumerTaxIdentifierHash: string | null } => {
  const operationalSettings = record(input.tenant.operationalSettings);
  const profile = record(operationalSettings.fiscalIssuerProfile);
  const integrations = record(operationalSettings.integrations);
  const sefaz = record(integrations.sefaz);
  const issuerRaw = normalizeTaxIdentifier(
    Object.keys(profile).length > 0 ? profile.taxIdentifier : sefaz.externalStoreId
  );
  if (!issuerRaw) throw new Error('FISCAL_DOCUMENT_ISSUER_IDENTITY_REQUIRED');

  const consumer = record(input.order.fiscalConsumerIdentity);
  const consumerRaw = normalizeTaxIdentifier(consumer.taxIdentifier);
  return {
    issuerTaxIdentifierHash: sha256(issuerRaw),
    consumerTaxIdentifierHash: consumerRaw ? sha256(consumerRaw) : null,
  };
};

export interface PrepareFiscalExecutableDocumentSnapshotResult {
  schemaVersion: 1;
  reused: boolean;
  snapshotPath: string;
  snapshot: FiscalExecutableDocumentSnapshot;
}

export const prepareFiscalExecutableDocumentSnapshot = async (input: {
  tenantId: string;
  requestedByUserId: string;
  attemptId: string;
  now?: Date;
}): Promise<PrepareFiscalExecutableDocumentSnapshotResult> => {
  const attemptId = clean(input.attemptId, 160);
  if (!ATTEMPT_ID_PATTERN.test(attemptId)) throw new Error('FISCAL_ATTEMPT_ID_INVALID');
  const canonicalStoreId = await resolveFiscalHomologationOwnerAuthority(input);
  const attemptRef = adminDb.doc(attemptPath(canonicalStoreId, attemptId));
  const attemptSnapshot = await attemptRef.get();
  if (!attemptSnapshot.exists) throw new Error('FISCAL_ATTEMPT_NOT_FOUND');
  const attempt = parseAttempt(attemptSnapshot.data(), {
    canonicalStoreId,
    attemptId,
    actorUserId: input.requestedByUserId,
  });
  if (attempt.state !== 'prepared') throw new Error('FISCAL_DOCUMENT_ATTEMPT_NOT_PREPARED');

  const [tenantSnapshot, orderSnapshot, inventorySnapshot] = await Promise.all([
    adminDb.doc(`tenants/${input.tenantId}`).get(),
    adminDb.doc(`stores/${canonicalStoreId}/orders/${attempt.orderId}`).get(),
    adminDb.doc(`users/${input.tenantId}/private_store/inventory`).get(),
  ]);
  if (!tenantSnapshot.exists || !orderSnapshot.exists) {
    throw new Error('FISCAL_DOCUMENT_SOURCE_NOT_FOUND');
  }
  const tenant = record(tenantSnapshot.data());
  const order = record(orderSnapshot.data());
  const inventory = record(inventorySnapshot.data());
  const fiscalProfiles = record(inventory.productFiscalProfiles);
  const persistedOrderId = clean(order.id, 240);
  if (persistedOrderId && persistedOrderId !== attempt.orderId) {
    throw new Error('FISCAL_DOCUMENT_ORDER_INTEGRITY_INVALID');
  }

  const lines = buildLines({ order, fiscalProfiles });
  const preparedKinds = [...attempt.productPreparation]
    .map(item => `${item.productId}:${item.kind}:${item.fiscalProfileReady === true ? 'ready' : 'blocked'}`)
    .sort();
  const lineKinds = [...lines]
    .map(item => `${item.productId}:${item.kind}:ready`)
    .sort();
  if (JSON.stringify(preparedKinds) !== JSON.stringify(lineKinds)) {
    throw new Error('FISCAL_DOCUMENT_ATTEMPT_EVIDENCE_STALE');
  }

  const subtotal = money(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0));
  const discountTotal = money(lines.reduce((sum, line) => sum + line.discountAmount, 0));
  const documentTotal = money(lines.reduce((sum, line) => sum + line.lineTotal, 0));
  const expectedAmount = attempt.triggerEvidence.payment?.projection.expectedAmount;
  if (
    typeof expectedAmount !== 'number' ||
    !Number.isFinite(expectedAmount) ||
    Math.abs(expectedAmount - documentTotal) > 0.009
  ) {
    throw new Error('FISCAL_DOCUMENT_PAYMENT_TOTAL_MISMATCH');
  }

  const identityFingerprints = sourceIdentityHashes({ tenant, order });
  const frozenEvidence = {
    canonicalStoreId,
    attemptId,
    orderId: attempt.orderId,
    documentFamily: attempt.policy.documentFamily,
    operationScope: attempt.policy.operationScope,
    environment: 'sandbox' as const,
    lines,
    subtotal,
    discountTotal,
    documentTotal,
    identityFingerprints,
    taxExecutionPolicy: {
      status: 'required' as const,
      policyId: null,
      version: null,
    },
  };
  const evidenceFingerprint = stableFingerprint(frozenEvidence);
  const snapshotId = `fiscal-doc-${evidenceFingerprint.slice(0, 48)}`;
  const timestamp = (input.now ?? new Date()).toISOString();
  const snapshot: FiscalExecutableDocumentSnapshot = {
    schemaVersion: 1,
    snapshotId,
    evidenceFingerprint,
    ...frozenEvidence,
    status: 'blocked_explicit_tax_policy_required',
    createdAt: timestamp,
    authority: 'kyrub_canonical_fiscal_document_snapshot',
  };
  const path = snapshotPath(canonicalStoreId, attemptId, snapshotId);
  const snapshotRef = adminDb.doc(path);

  return adminDb.runTransaction(async transaction => {
    const [currentAttemptSnapshot, existingSnapshot] = await Promise.all([
      transaction.get(attemptRef),
      transaction.get(snapshotRef),
    ]);
    if (!currentAttemptSnapshot.exists) throw new Error('FISCAL_ATTEMPT_NOT_FOUND');
    const currentAttempt = parseAttempt(currentAttemptSnapshot.data(), {
      canonicalStoreId,
      attemptId,
      actorUserId: input.requestedByUserId,
    });
    if (currentAttempt.state !== 'prepared') {
      throw new Error('FISCAL_DOCUMENT_ATTEMPT_NOT_PREPARED');
    }

    if (existingSnapshot.exists) {
      const existing = record(existingSnapshot.data());
      if (
        clean(existing.snapshotId, 160) !== snapshotId ||
        clean(existing.evidenceFingerprint, 80) !== evidenceFingerprint ||
        existing.authority !== 'kyrub_canonical_fiscal_document_snapshot'
      ) {
        throw new Error('FISCAL_DOCUMENT_SNAPSHOT_INVALID');
      }
    } else {
      transaction.create(snapshotRef, {
        ...snapshot,
        serverCreatedAt: FieldValue.serverTimestamp(),
      });
    }

    transaction.update(attemptRef, {
      fiscalDocumentSnapshotId: snapshotId,
      fiscalDocumentStatus: snapshot.status,
      updatedAt: timestamp,
      serverUpdatedAt: FieldValue.serverTimestamp(),
    });

    return {
      schemaVersion: 1,
      reused: existingSnapshot.exists,
      snapshotPath: path,
      snapshot,
    };
  });
};

export const loadReadyFiscalExecutableDocumentSnapshot = async (input: {
  canonicalStoreId: string;
  attempt: FiscalHomologationAttempt;
}): Promise<FiscalExecutableDocumentSnapshot> => {
  const snapshotId = clean(input.attempt.fiscalDocumentSnapshotId, 160);
  if (!snapshotId || input.attempt.fiscalDocumentStatus !== 'ready') {
    throw new Error('FISCAL_EXECUTABLE_DOCUMENT_NOT_READY');
  }
  const snapshot = await adminDb.doc(
    snapshotPath(input.canonicalStoreId, input.attempt.attemptId, snapshotId)
  ).get();
  if (!snapshot.exists) throw new Error('FISCAL_EXECUTABLE_DOCUMENT_NOT_READY');
  const stored = record(snapshot.data());
  if (
    stored.schemaVersion !== 1 ||
    clean(stored.snapshotId, 160) !== snapshotId ||
    clean(stored.canonicalStoreId, 160) !== input.canonicalStoreId ||
    clean(stored.attemptId, 160) !== input.attempt.attemptId ||
    stored.status !== 'ready' ||
    stored.authority !== 'kyrub_canonical_fiscal_document_snapshot'
  ) {
    throw new Error('FISCAL_EXECUTABLE_DOCUMENT_NOT_READY');
  }
  return stored as unknown as FiscalExecutableDocumentSnapshot;
};
