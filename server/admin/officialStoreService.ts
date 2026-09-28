import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  CanonicalStoreIdentityError,
  resolveCanonicalStoreIdentity,
} from '../identity/canonicalStoreIdentityService.js';
import { authorizeOperationsHealth } from './operationsHealthRouter.js';
import { PlanManagementError } from './planManagementService.js';

const OFFICIAL_STORE_PATH = 'kyrub_admin/official_store';
const AUDIT_COLLECTION = 'kyrub_admin/control_plane/audit_logs';
const OFFICIAL_STORE_KIND = 'official_cairobi_store' as const;

export interface OfficialStoreIdentitySnapshot {
  schemaVersion: 1;
  kind: typeof OFFICIAL_STORE_KIND;
  canonicalStoreId: string;
  legacyStoreId: string;
  ownerUserId: string;
  storeName: string;
  designatedAt: string;
  designatedBy: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const timestampIso = (value: unknown): string => {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value && typeof value === 'object' && 'toDate' in value) {
    try {
      return (value as { toDate(): Date }).toDate().toISOString();
    } catch {
      return '';
    }
  }
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
};

const parseIdentity = (value: unknown): OfficialStoreIdentitySnapshot | null => {
  const data = record(value);
  if (data.kind !== OFFICIAL_STORE_KIND) return null;
  const canonicalStoreId = clean(data.canonicalStoreId);
  const legacyStoreId = clean(data.legacyStoreId);
  const ownerUserId = clean(data.ownerUserId);
  const designatedBy = clean(data.designatedBy);
  if (!canonicalStoreId || !legacyStoreId || !ownerUserId || !designatedBy) return null;
  return {
    schemaVersion: 1,
    kind: OFFICIAL_STORE_KIND,
    canonicalStoreId,
    legacyStoreId,
    ownerUserId,
    storeName: clean(data.storeName),
    designatedAt: timestampIso(data.designatedAt),
    designatedBy,
  };
};

const requireSuperAdmin = async (authorization: string) => {
  const admin = await authorizeOperationsHealth(authorization);
  if (admin.role !== 'super_admin') {
    throw new PlanManagementError(
      403,
      'OFFICIAL_STORE_FORBIDDEN',
      'Somente Super Admin pode administrar a identidade da Loja Oficial Cairobi.'
    );
  }
  return admin;
};

const canonicalIdentityOrPlanError = async (storeId: unknown) => {
  try {
    return await resolveCanonicalStoreIdentity(storeId, {
      requirePublishedTenant: true,
    });
  } catch (error) {
    if (error instanceof CanonicalStoreIdentityError) {
      throw new PlanManagementError(error.status, error.code, error.message);
    }
    throw error;
  }
};

export const getOfficialStoreIdentity = async (): Promise<OfficialStoreIdentitySnapshot | null> => {
  const snapshot = await adminDb.doc(OFFICIAL_STORE_PATH).get();
  return snapshot.exists ? parseIdentity(snapshot.data()) : null;
};

export const loadOfficialStoreSnapshot = async (
  authorization: string
): Promise<{ identity: OfficialStoreIdentitySnapshot | null }> => {
  await requireSuperAdmin(authorization);
  return { identity: await getOfficialStoreIdentity() };
};

export const designateOfficialStore = async (
  authorization: string,
  input: unknown
): Promise<{ identity: OfficialStoreIdentitySnapshot; changed: boolean }> => {
  const admin = await requireSuperAdmin(authorization);
  const body = record(input);
  const candidate = await canonicalIdentityOrPlanError(body.storeId);
  const replaceExisting = body.replaceExisting === true;
  const officialRef = adminDb.doc(OFFICIAL_STORE_PATH);

  const result = await adminDb.runTransaction(async transaction => {
    const currentSnapshot = await transaction.get(officialRef);
    const current = currentSnapshot.exists
      ? parseIdentity(currentSnapshot.data())
      : null;

    if (current?.canonicalStoreId === candidate.canonicalStoreId) {
      return { identity: current, changed: false };
    }

    if (current && !replaceExisting) {
      throw new PlanManagementError(
        409,
        'OFFICIAL_STORE_REPLACEMENT_CONFIRMATION_REQUIRED',
        'Já existe uma Loja Oficial Cairobi. Confirme explicitamente a substituição.'
      );
    }

    const designatedAt = Timestamp.now();
    const persisted = {
      schemaVersion: 1,
      kind: OFFICIAL_STORE_KIND,
      canonicalStoreId: candidate.canonicalStoreId,
      legacyStoreId: candidate.legacyStoreId,
      ownerUserId: candidate.ownerUserId,
      storeName: candidate.storeName,
      designatedAt,
      designatedBy: admin.uid,
    };

    transaction.set(officialRef, persisted);

    const auditRef = adminDb.doc(`${AUDIT_COLLECTION}/${randomUUID()}`);
    transaction.set(auditRef, {
      schemaVersion: 1,
      actorUid: admin.uid,
      actorRole: admin.role,
      action: current
        ? 'admin.official_store.reassigned'
        : 'admin.official_store.designated',
      targetType: 'official_store',
      targetId: candidate.canonicalStoreId,
      metadata: {
        previousCanonicalStoreId: current?.canonicalStoreId ?? '',
        canonicalStoreId: candidate.canonicalStoreId,
        legacyStoreId: candidate.legacyStoreId,
      },
      createdAt: designatedAt,
    });

    return {
      identity: parseIdentity(persisted) as OfficialStoreIdentitySnapshot,
      changed: true,
    };
  });

  return result;
};
