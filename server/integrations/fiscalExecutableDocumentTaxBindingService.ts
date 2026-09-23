import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type { FiscalHomologationAttempt } from '../../shared/fiscalHomologationAttempt.js';
import type { FiscalExecutableDocumentSnapshot } from '../../shared/fiscalExecutableDocument.js';
import type { FiscalTaxExecutionPolicy } from '../../shared/fiscalTaxExecutionPolicy.js';
import { resolveFiscalHomologationOwnerAuthority } from './fiscalHomologationAttemptLedger.js';
import { requireEffectiveFiscalTaxExecutionPolicy } from './fiscalTaxExecutionPolicyRegistry.js';

const ATTEMPT_ID_PATTERN = /^fiscal-attempt-[a-f0-9]{48}$/;
const SNAPSHOT_ID_PATTERN = /^fiscal-doc-[a-f0-9]{48}$/;

const clean = (value: unknown, maxLength = 240): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const attemptPath = (canonicalStoreId: string, attemptId: string): string =>
  `stores/${canonicalStoreId}/fiscalAttempts/${attemptId}`;

const snapshotPath = (
  canonicalStoreId: string,
  attemptId: string,
  snapshotId: string
): string => `${attemptPath(canonicalStoreId, attemptId)}/fiscalDocumentSnapshots/${snapshotId}`;

const fingerprint = (value: unknown): string => createHash('sha256')
  .update(JSON.stringify(value))
  .digest('hex');

const parseAttempt = (
  value: unknown,
  expected: { canonicalStoreId: string; attemptId: string; actorUserId: string }
): FiscalHomologationAttempt => {
  const stored = record(value);
  const actor = record(stored.actor);
  const policy = record(stored.policy);
  if (
    stored.schemaVersion !== 1 ||
    clean(stored.attemptId, 160) !== expected.attemptId ||
    clean(stored.canonicalStoreId, 160) !== expected.canonicalStoreId ||
    clean(actor.userId, 160) !== expected.actorUserId ||
    actor.requiredPermission !== 'fiscal.homologation.emit' ||
    !['nfe', 'nfce', 'nfse'].includes(String(policy.documentFamily ?? '')) ||
    stored.environment !== 'sandbox' ||
    stored.authority !== 'kyrub_fiscal_homologation_attempt_ledger'
  ) {
    throw new Error('FISCAL_ATTEMPT_STORED_RECORD_INVALID');
  }
  return stored as unknown as FiscalHomologationAttempt;
};

const parseBlockedSnapshot = (
  value: unknown,
  expected: {
    canonicalStoreId: string;
    attemptId: string;
    snapshotId: string;
    orderId: string;
  }
): FiscalExecutableDocumentSnapshot => {
  const stored = record(value);
  if (
    stored.schemaVersion !== 1 ||
    clean(stored.snapshotId, 160) !== expected.snapshotId ||
    clean(stored.canonicalStoreId, 160) !== expected.canonicalStoreId ||
    clean(stored.attemptId, 160) !== expected.attemptId ||
    clean(stored.orderId, 240) !== expected.orderId ||
    stored.environment !== 'sandbox' ||
    stored.status !== 'blocked_explicit_tax_policy_required' ||
    record(stored.taxExecutionPolicy).status !== 'required' ||
    stored.authority !== 'kyrub_canonical_fiscal_document_snapshot' ||
    !Array.isArray(stored.lines) || stored.lines.length === 0
  ) {
    throw new Error('FISCAL_EXECUTABLE_DOCUMENT_SOURCE_INVALID');
  }
  return stored as unknown as FiscalExecutableDocumentSnapshot;
};

const assertPolicyCoversSnapshot = (
  policy: FiscalTaxExecutionPolicy,
  snapshot: FiscalExecutableDocumentSnapshot
): void => {
  if (
    policy.status !== 'approved_for_homologation' ||
    policy.environment !== 'sandbox' ||
    policy.storeId !== snapshot.canonicalStoreId ||
    policy.documentFamily !== snapshot.documentFamily
  ) {
    throw new Error('FISCAL_TAX_EXECUTION_POLICY_SCOPE_MISMATCH');
  }

  for (const line of snapshot.lines) {
    if (line.kind === 'goods') {
      const rule = policy.goodsRules[line.productId];
      if (!rule || rule.productId !== line.productId) {
        throw new Error('FISCAL_TAX_EXECUTION_PRODUCT_RULE_REQUIRED');
      }
      if (line.fiscalProfile.kind !== 'goods') {
        throw new Error('FISCAL_TAX_EXECUTION_PRODUCT_RULE_MISMATCH');
      }
    } else {
      const rule = policy.serviceRules[line.productId];
      if (!rule || rule.productId !== line.productId) {
        throw new Error('FISCAL_TAX_EXECUTION_SERVICE_RULE_REQUIRED');
      }
      if (
        line.fiscalProfile.kind !== 'service' ||
        (rule.serviceListCode &&
          line.fiscalProfile.serviceListCode &&
          rule.serviceListCode !== line.fiscalProfile.serviceListCode) ||
        (rule.municipalServiceCode &&
          line.fiscalProfile.municipalServiceCode &&
          rule.municipalServiceCode !== line.fiscalProfile.municipalServiceCode)
      ) {
        throw new Error('FISCAL_TAX_EXECUTION_SERVICE_RULE_MISMATCH');
      }
    }
  }
};

export interface BindFiscalTaxExecutionPolicyResult {
  schemaVersion: 1;
  sourceSnapshotId: string;
  reused: boolean;
  snapshotPath: string;
  snapshot: FiscalExecutableDocumentSnapshot;
  policy: {
    policyId: string;
    version: number;
    accountingReference: string;
  };
}

export const bindFiscalTaxExecutionPolicyToAttempt = async (input: {
  tenantId: string;
  requestedByUserId: string;
  attemptId: string;
  now?: Date;
}): Promise<BindFiscalTaxExecutionPolicyResult> => {
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
  const sourceSnapshotId = clean(attempt.fiscalDocumentSnapshotId, 160);
  if (
    !SNAPSHOT_ID_PATTERN.test(sourceSnapshotId) ||
    attempt.fiscalDocumentStatus !== 'blocked_explicit_tax_policy_required'
  ) {
    throw new Error('FISCAL_EXECUTABLE_DOCUMENT_SOURCE_REQUIRED');
  }

  const sourceRef = adminDb.doc(snapshotPath(canonicalStoreId, attemptId, sourceSnapshotId));
  const sourceSnapshot = await sourceRef.get();
  if (!sourceSnapshot.exists) throw new Error('FISCAL_EXECUTABLE_DOCUMENT_SOURCE_REQUIRED');
  const source = parseBlockedSnapshot(sourceSnapshot.data(), {
    canonicalStoreId,
    attemptId,
    snapshotId: sourceSnapshotId,
    orderId: attempt.orderId,
  });
  if (source.documentFamily !== attempt.policy.documentFamily) {
    throw new Error('FISCAL_EXECUTABLE_DOCUMENT_SOURCE_STALE');
  }

  const now = input.now ?? new Date();
  const policy = await requireEffectiveFiscalTaxExecutionPolicy({
    tenantId: input.tenantId,
    requestedByUserId: input.requestedByUserId,
    documentFamily: attempt.policy.documentFamily,
    at: now,
  });
  assertPolicyCoversSnapshot(policy, source);

  const binding = {
    status: 'bound' as const,
    policyId: policy.policyId,
    version: policy.version,
  };
  const boundEvidence = {
    sourceSnapshotFingerprint: source.evidenceFingerprint,
    taxExecutionPolicy: binding,
  };
  const evidenceFingerprint = fingerprint(boundEvidence);
  const snapshotId = `fiscal-doc-${evidenceFingerprint.slice(0, 48)}`;
  const timestamp = now.toISOString();
  const ready: FiscalExecutableDocumentSnapshot = {
    ...source,
    snapshotId,
    evidenceFingerprint,
    taxExecutionPolicy: binding,
    status: 'ready',
    createdAt: timestamp,
  };
  const readyRef = adminDb.doc(snapshotPath(canonicalStoreId, attemptId, snapshotId));

  return adminDb.runTransaction(async transaction => {
    const [currentAttemptSnapshot, existingSnapshot] = await Promise.all([
      transaction.get(attemptRef),
      transaction.get(readyRef),
    ]);
    if (!currentAttemptSnapshot.exists) throw new Error('FISCAL_ATTEMPT_NOT_FOUND');
    const current = parseAttempt(currentAttemptSnapshot.data(), {
      canonicalStoreId,
      attemptId,
      actorUserId: input.requestedByUserId,
    });
    if (
      current.state !== 'prepared' ||
      current.fiscalDocumentSnapshotId !== sourceSnapshotId ||
      current.fiscalDocumentStatus !== 'blocked_explicit_tax_policy_required'
    ) {
      throw new Error('FISCAL_EXECUTABLE_DOCUMENT_BINDING_STALE');
    }

    if (existingSnapshot.exists) {
      const existing = record(existingSnapshot.data());
      if (
        clean(existing.snapshotId, 160) !== snapshotId ||
        clean(existing.evidenceFingerprint, 80) !== evidenceFingerprint ||
        existing.status !== 'ready' ||
        existing.authority !== 'kyrub_canonical_fiscal_document_snapshot'
      ) {
        throw new Error('FISCAL_EXECUTABLE_DOCUMENT_SNAPSHOT_INVALID');
      }
    } else {
      transaction.create(readyRef, {
        ...ready,
        serverCreatedAt: FieldValue.serverTimestamp(),
      });
    }

    transaction.update(attemptRef, {
      fiscalDocumentSnapshotId: snapshotId,
      fiscalDocumentStatus: 'ready',
      updatedAt: timestamp,
      serverUpdatedAt: FieldValue.serverTimestamp(),
    });

    return {
      schemaVersion: 1,
      sourceSnapshotId,
      reused: existingSnapshot.exists,
      snapshotPath: readyRef.path,
      snapshot: ready,
      policy: {
        policyId: policy.policyId,
        version: policy.version,
        accountingReference: policy.accountingReference,
      },
    };
  });
};
