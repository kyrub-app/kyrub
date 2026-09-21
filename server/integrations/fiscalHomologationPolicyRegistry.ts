import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  parseFiscalHomologationPolicyDraft,
  resolveFiscalHomologationPolicy,
  validateFiscalHomologationPolicyForApproval,
  type FiscalHomologationDocumentFamily,
  type FiscalHomologationOperationScope,
  type FiscalHomologationOperationalTrigger,
  type FiscalHomologationPolicyResolution,
} from '../../shared/fiscalHomologationPolicy.js';

const clean = (value: unknown, maxLength = 240): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const canonicalStoreIdForOwner = async (
  tenantId: string,
  requestedByUserId: string
): Promise<string> => {
  if (!tenantId || tenantId !== requestedByUserId) {
    throw new Error('STORE_CONNECTION_FORBIDDEN');
  }
  const tenantSnapshot = await adminDb.doc(`tenants/${tenantId}`).get();
  const canonicalStoreId = clean(tenantSnapshot.data()?.canonicalStoreId, 160);
  if (!canonicalStoreId) {
    throw new Error('FISCAL_HOMOLOGATION_CANONICAL_STORE_REQUIRED');
  }
  return canonicalStoreId;
};

const currentPath = (canonicalStoreId: string): string =>
  `stores/${canonicalStoreId}/fiscalPolicies/homologation`;

const revisionPath = (canonicalStoreId: string, version: number): string =>
  `stores/${canonicalStoreId}/fiscalPolicies/homologation/revisions/v${String(version).padStart(6, '0')}`;

export interface FiscalHomologationPolicyRegistryRecord {
  schemaVersion: 1;
  canonicalStoreId: string;
  updatedByUserId: string;
  updatedAt: string;
  resolution: FiscalHomologationPolicyResolution;
}

export interface SaveFiscalHomologationPolicyInput {
  tenantId: string;
  requestedByUserId: string;
  approveForHomologation?: boolean;
  policyReference?: string;
  effectiveFrom?: string;
  operationScope?: FiscalHomologationOperationScope | null;
  documentFamily?: FiscalHomologationDocumentFamily | null;
  operationalTrigger?: FiscalHomologationOperationalTrigger | null;
  now?: Date;
}

const parseStoredRecord = (
  value: unknown,
  canonicalStoreId: string
): FiscalHomologationPolicyRegistryRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const rawResolution = record(raw.resolution);
  const rawPolicy = record(rawResolution.policy);
  try {
    const policy = parseFiscalHomologationPolicyDraft({
      policyId: clean(rawPolicy.policyId, 160),
      storeId: canonicalStoreId,
      version: typeof rawPolicy.version === 'number' ? rawPolicy.version : 1,
      status: rawPolicy.status === 'approved_for_homologation'
        ? 'approved_for_homologation'
        : 'draft',
      policyReference: clean(rawPolicy.policyReference, 160),
      effectiveFrom: clean(rawPolicy.effectiveFrom, 64),
      operationScope:
        rawPolicy.operationScope === 'goods' ||
        rawPolicy.operationScope === 'service' ||
        rawPolicy.operationScope === 'mixed'
          ? rawPolicy.operationScope
          : null,
      documentFamily:
        rawPolicy.documentFamily === 'nfe' ||
        rawPolicy.documentFamily === 'nfce' ||
        rawPolicy.documentFamily === 'nfse'
          ? rawPolicy.documentFamily
          : null,
      operationalTrigger:
        rawPolicy.operationalTrigger === 'payment_confirmed' ||
        rawPolicy.operationalTrigger === 'fulfillment_confirmed' ||
        rawPolicy.operationalTrigger === 'service_completed'
          ? rawPolicy.operationalTrigger
          : null,
    });
    const resolution = resolveFiscalHomologationPolicy(policy);
    return {
      schemaVersion: 1,
      canonicalStoreId,
      updatedByUserId: clean(raw.updatedByUserId, 160),
      updatedAt: clean(raw.updatedAt, 64),
      resolution,
    };
  } catch {
    throw new Error('FISCAL_HOMOLOGATION_POLICY_STORED_RECORD_INVALID');
  }
};

export const loadFiscalHomologationPolicy = async (input: {
  tenantId: string;
  requestedByUserId: string;
}): Promise<FiscalHomologationPolicyRegistryRecord | null> => {
  const tenantId = clean(input.tenantId, 160);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  const canonicalStoreId = await canonicalStoreIdForOwner(tenantId, requestedByUserId);
  const snapshot = await adminDb.doc(currentPath(canonicalStoreId)).get();
  return snapshot.exists
    ? parseStoredRecord(snapshot.data(), canonicalStoreId)
    : null;
};

export const saveFiscalHomologationPolicy = async (
  input: SaveFiscalHomologationPolicyInput
): Promise<FiscalHomologationPolicyRegistryRecord> => {
  const tenantId = clean(input.tenantId, 160);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  const canonicalStoreId = await canonicalStoreIdForOwner(tenantId, requestedByUserId);
  const updatedAt = (input.now ?? new Date()).toISOString();
  const currentRef = adminDb.doc(currentPath(canonicalStoreId));

  return adminDb.runTransaction(async transaction => {
    const currentSnapshot = await transaction.get(currentRef);
    const currentVersion = currentSnapshot.exists
      ? Number(record(record(currentSnapshot.data()).resolution).policy && record(record(currentSnapshot.data()).resolution).policy
        ? record(record(currentSnapshot.data()).resolution).policy.version
        : 0)
      : 0;
    const version = Number.isInteger(currentVersion) && currentVersion > 0
      ? currentVersion + 1
      : 1;
    const policyId = `homologation:${canonicalStoreId}`;
    const draftInput = {
      policyId,
      storeId: canonicalStoreId,
      version,
      policyReference: clean(input.policyReference, 160),
      effectiveFrom: clean(input.effectiveFrom, 64),
      operationScope: input.operationScope ?? null,
      documentFamily: input.documentFamily ?? null,
      operationalTrigger: input.operationalTrigger ?? null,
    };
    const resolution = input.approveForHomologation === true
      ? validateFiscalHomologationPolicyForApproval(draftInput)
      : resolveFiscalHomologationPolicy(draftInput);
    const stored: FiscalHomologationPolicyRegistryRecord & { serverUpdatedAt: FieldValue } = {
      schemaVersion: 1,
      canonicalStoreId,
      updatedByUserId: requestedByUserId,
      updatedAt,
      resolution,
      serverUpdatedAt: FieldValue.serverTimestamp(),
    };

    transaction.set(currentRef, stored);
    transaction.create(
      adminDb.doc(revisionPath(canonicalStoreId, version)),
      stored
    );

    return {
      schemaVersion: 1,
      canonicalStoreId,
      updatedByUserId: requestedByUserId,
      updatedAt,
      resolution,
    };
  });
};
