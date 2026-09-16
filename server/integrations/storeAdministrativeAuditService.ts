import { createHash } from 'node:crypto';
import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { getPrimaryUserStoreDocumentPath } from '../../src/utils/storePaths.js';

export type StoreAdministrativeAuditDomain =
  | 'governance'
  | 'inventory'
  | 'orders'
  | 'integrations'
  | 'finance'
  | 'users'
  | 'ai'
  | 'store';

export type StoreAdministrativeAuditActorType =
  | 'store_owner'
  | 'authorized_user'
  | 'integration'
  | 'kyrubia'
  | 'system';

export interface StoreAdministrativeAuditEvent {
  id: string;
  tenantId: string;
  canonicalStoreId: string;
  domain: StoreAdministrativeAuditDomain;
  action: string;
  result: string;
  actorType: StoreAdministrativeAuditActorType;
  actorLabel: string;
  authority: string;
  subjectType: string;
  subjectId: string;
  reason: string;
  occurredAt: string;
  sourceKind: string;
  sourceRef: string;
  metadata: Record<string, string | number | boolean | null>;
}

export interface StoreAdministrativeAuditSnapshot {
  tenantId: string;
  canonicalStoreId: string;
  readAuthority: 'store_owner';
  items: StoreAdministrativeAuditEvent[];
  sourceWarnings: string[];
  generatedAt: string;
}

type AuditMetadata = Record<string, string | number | boolean | null>;

type AppendStoreAdministrativeAuditInput = {
  tenantId: string;
  canonicalStoreId: string;
  domain: StoreAdministrativeAuditDomain;
  action: string;
  result: string;
  actorType: StoreAdministrativeAuditActorType;
  actorUserId?: string;
  authority: string;
  subjectType?: string;
  subjectId?: string;
  reason?: string;
  sourceKind: string;
  sourceRef: string;
  metadata?: AuditMetadata;
};

const clean = (value: unknown, maximum = 240): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const safeInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const safeNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const timestampIso = (value: unknown): string => {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
  }
  if (typeof value === 'object') {
    const candidate = value as {
      toDate?: () => Date;
      seconds?: number;
      _seconds?: number;
    };
    if (typeof candidate.toDate === 'function') {
      try {
        return candidate.toDate().toISOString();
      } catch {
        return '';
      }
    }
    const seconds = Number(candidate.seconds ?? candidate._seconds);
    if (Number.isFinite(seconds)) return new Date(seconds * 1000).toISOString();
  }
  return '';
};

const sanitizeMetadata = (input: AuditMetadata | undefined): AuditMetadata => {
  const output: AuditMetadata = {};
  for (const [key, value] of Object.entries(input ?? {}).slice(0, 24)) {
    const safeKey = clean(key, 80);
    if (!safeKey) continue;
    if (typeof value === 'string') output[safeKey] = clean(value, 240);
    else if (typeof value === 'number' && Number.isFinite(value)) output[safeKey] = value;
    else if (typeof value === 'boolean' || value === null) output[safeKey] = value;
  }
  return output;
};

const actorLabel = (actorType: StoreAdministrativeAuditActorType): string => {
  if (actorType === 'store_owner') return 'Proprietário da loja';
  if (actorType === 'authorized_user') return 'Usuário autorizado';
  if (actorType === 'integration') return 'Integração';
  if (actorType === 'kyrubia') return 'Kyrubia';
  return 'Sistema Kyrub';
};

const eventIdFor = (input: AppendStoreAdministrativeAuditInput): string =>
  `store-audit-${createHash('sha256')
    .update(`${input.canonicalStoreId}:${input.sourceRef}:${input.action}:${input.result}`)
    .digest('hex')
    .slice(0, 48)}`;

export const appendStoreAdministrativeAuditEvent = (
  transaction: Transaction,
  input: AppendStoreAdministrativeAuditInput
): string => {
  const tenantId = clean(input.tenantId, 160);
  const canonicalStoreId = clean(input.canonicalStoreId, 160);
  const action = clean(input.action, 120);
  const result = clean(input.result, 120);
  const authority = clean(input.authority, 160);
  const sourceKind = clean(input.sourceKind, 120);
  const sourceRef = clean(input.sourceRef, 500);
  if (!tenantId || !canonicalStoreId || !action || !result || !authority || !sourceKind || !sourceRef) {
    throw new Error('STORE_ADMINISTRATIVE_AUDIT_EVENT_INVALID');
  }

  const id = eventIdFor({ ...input, tenantId, canonicalStoreId, action, result, authority, sourceKind, sourceRef });
  const auditRef = adminDb.doc(`stores/${canonicalStoreId}/administrativeAudit/${id}`);
  transaction.create(auditRef, {
    schemaVersion: 1,
    id,
    tenantId,
    canonicalStoreId,
    domain: input.domain,
    action,
    result,
    actorType: input.actorType,
    actorUserId: clean(input.actorUserId, 160) || null,
    authority,
    subjectType: clean(input.subjectType, 120) || null,
    subjectId: clean(input.subjectId, 240) || null,
    reason: clean(input.reason, 500) || null,
    sourceKind,
    sourceRef,
    metadata: sanitizeMetadata(input.metadata),
    occurredAt: FieldValue.serverTimestamp(),
  });
  return id;
};

const resolveCanonicalStoreId = async (tenantId: string): Promise<string> => {
  const [tenantSnapshot, privateStoreSnapshot] = await Promise.all([
    adminDb.doc(`tenants/${tenantId}`).get(),
    adminDb.doc(getPrimaryUserStoreDocumentPath(tenantId)).get(),
  ]);
  const tenant = tenantSnapshot.data() as Record<string, unknown> | undefined;
  const privateStore = privateStoreSnapshot.data() as Record<string, unknown> | undefined;

  if (tenantSnapshot.exists && clean(tenant?.ownerId, 160) && clean(tenant?.ownerId, 160) !== tenantId) {
    throw new Error('STORE_ADMINISTRATIVE_AUDIT_FORBIDDEN');
  }
  if (
    privateStoreSnapshot.exists &&
    clean(privateStore?.ownerId, 160) &&
    clean(privateStore?.ownerId, 160) !== tenantId
  ) {
    throw new Error('STORE_ADMINISTRATIVE_AUDIT_FORBIDDEN');
  }

  const tenantCanonical = clean(tenant?.canonicalStoreId, 160);
  const privateCanonical = clean(privateStore?.canonicalStoreId, 160);
  if (tenantCanonical && privateCanonical && tenantCanonical !== privateCanonical) return '';
  const candidate = tenantCanonical || privateCanonical;
  if (!candidate || candidate === tenantId) return '';

  const storeSnapshot = await adminDb.doc(`stores/${candidate}`).get();
  const store = storeSnapshot.data() as Record<string, unknown> | undefined;
  if (!storeSnapshot.exists || clean(store?.ownerId, 160) !== tenantId) return '';
  const legacyTenantId = clean(store?.legacyTenantId, 160);
  return legacyTenantId && legacyTenantId !== tenantId ? '' : candidate;
};

const canonicalEvent = (
  tenantId: string,
  canonicalStoreId: string,
  id: string,
  data: Record<string, unknown>
): StoreAdministrativeAuditEvent => {
  const actorType = clean(data.actorType, 80) as StoreAdministrativeAuditActorType;
  const safeActorType: StoreAdministrativeAuditActorType = [
    'store_owner', 'authorized_user', 'integration', 'kyrubia', 'system',
  ].includes(actorType) ? actorType : 'system';
  const metadataInput = data.metadata && typeof data.metadata === 'object'
    ? data.metadata as AuditMetadata
    : {};
  return {
    id: clean(data.id, 180) || id,
    tenantId,
    canonicalStoreId,
    domain: clean(data.domain, 80) as StoreAdministrativeAuditDomain || 'store',
    action: clean(data.action, 120),
    result: clean(data.result, 120),
    actorType: safeActorType,
    actorLabel: actorLabel(safeActorType),
    authority: clean(data.authority, 160),
    subjectType: clean(data.subjectType, 120),
    subjectId: clean(data.subjectId, 240),
    reason: clean(data.reason, 500),
    occurredAt: timestampIso(data.occurredAt),
    sourceKind: clean(data.sourceKind, 120) || 'canonical_store_audit',
    sourceRef: clean(data.sourceRef, 500) || `stores/${canonicalStoreId}/administrativeAudit/${id}`,
    metadata: sanitizeMetadata(metadataInput),
  };
};

const ownerGovernanceEvent = (
  tenantId: string,
  canonicalStoreId: string,
  id: string,
  data: Record<string, unknown>
): StoreAdministrativeAuditEvent => {
  const action = clean(data.action, 120);
  return {
    id: `owner-governance:${id}`,
    tenantId,
    canonicalStoreId,
    domain: 'governance',
    action,
    result: 'applied',
    actorType: 'store_owner',
    actorLabel: actorLabel('store_owner'),
    authority: clean(data.authority, 160),
    subjectType: 'store_membership',
    subjectId: clean(data.selectedMemberUserId ?? data.canonicalOwnerUserId, 240),
    reason: clean(data.conflictId, 240),
    occurredAt: timestampIso(data.appliedAt),
    sourceKind: 'owner_governance_decision',
    sourceRef: `stores/${canonicalStoreId}/ownerGovernanceDecisions/${id}`,
    metadata: sanitizeMetadata({
      conflictId: clean(data.conflictId, 240) || null,
      confirmed: data.confirmed === true,
    }),
  };
};

const inventoryRepairEvent = (
  tenantId: string,
  canonicalStoreId: string,
  id: string,
  data: Record<string, unknown>
): StoreAdministrativeAuditEvent => ({
  id: `inventory-authority:${id}`,
  tenantId,
  canonicalStoreId,
  domain: 'inventory',
  action: clean(data.action, 120),
  result: 'applied',
  actorType: 'store_owner',
  actorLabel: actorLabel('store_owner'),
  authority: clean(data.authority, 160),
  subjectType: 'inventory_authority',
  subjectId: id,
  reason: clean(data.stateBefore, 160),
  occurredAt: timestampIso(data.appliedAt),
  sourceKind: 'inventory_authority_repair',
  sourceRef: `stores/${canonicalStoreId}/inventoryAuthorityRepairs/${id}`,
  metadata: sanitizeMetadata({
    stateBefore: clean(data.stateBefore, 160) || null,
    confirmed: data.confirmed === true,
  }),
});

const mercadoLivreManualReviewEvent = (
  tenantId: string,
  id: string,
  data: Record<string, unknown>
): StoreAdministrativeAuditEvent => {
  const eventType = clean(data.eventType, 120);
  const queueFailure = eventType === 'manual_retry_queue_failure';
  const actorType: StoreAdministrativeAuditActorType = queueFailure ? 'integration' : 'store_owner';
  const failureCount = safeInteger(data.retryableFailureCount);
  const failureBudget = safeInteger(data.retryableFailureBudget);
  const retryCycle = safeInteger(data.manualRetryCycle ?? data.nextRetryCycle);
  return {
    id: `mercado-livre-manual-review:${id}`,
    tenantId,
    canonicalStoreId: '',
    domain: 'orders',
    action: clean(data.action, 120) || eventType,
    result: clean(data.decisionResult ?? data.result, 120) || eventType,
    actorType,
    actorLabel: actorLabel(actorType),
    authority: clean(data.authority, 160),
    subjectType: 'external_order',
    subjectId: clean(data.externalOrderId, 240),
    reason: clean(data.reason, 500),
    occurredAt: timestampIso(data.occurredAt),
    sourceKind: 'mercado_livre_manual_review',
    sourceRef: `integrationManualReviewAudit/${id}`,
    metadata: sanitizeMetadata({
      provider: clean(data.provider, 80) || 'mercado_livre',
      decisionSequence: safeInteger(data.decisionSequence),
      retryCycle,
      failureCount,
      failureBudget,
      errorCode: clean(data.errorCode ?? data.lastRetryableErrorCode, 120) || null,
    }),
  };
};

const ninetyNineFoodProductBindingAuditEvent = (
  tenantId: string,
  canonicalStoreId: string,
  id: string,
  data: Record<string, unknown>
): StoreAdministrativeAuditEvent => {
  const bindingAction = clean(data.action, 80) || 'updated';
  return {
    id: `99food-product-binding:${id}`,
    tenantId,
    canonicalStoreId,
    domain: 'integrations',
    action: `99food_product_binding_${bindingAction}`,
    result: 'applied',
    actorType: 'store_owner',
    actorLabel: actorLabel('store_owner'),
    authority: clean(data.authority, 160),
    subjectType: 'external_product_binding',
    subjectId: clean(data.externalProductId, 240),
    reason: '',
    occurredAt: timestampIso(data.serverCreatedAt ?? data.occurredAt),
    sourceKind: '99food_product_binding_audit',
    sourceRef: `stores/${canonicalStoreId}/externalProductBindingAudits/${id}`,
    metadata: sanitizeMetadata({
      provider: '99food',
      externalStoreId: clean(data.externalStoreId, 240) || null,
      externalProductId: clean(data.externalProductId, 240) || null,
      canonicalProductId: clean(data.canonicalProductId, 240) || null,
      previousCanonicalProductId: clean(data.previousCanonicalProductId, 240) || null,
      revision: safeInteger(data.revision),
    }),
  };
};

const ninetyNineFoodOrderBlockResolutionEvent = (
  tenantId: string,
  canonicalStoreId: string,
  id: string,
  data: Record<string, unknown>
): StoreAdministrativeAuditEvent => {
  const status = clean(data.status, 120) || 'recorded';
  return {
    id: `99food-order-block-resolution:${id}`,
    tenantId,
    canonicalStoreId,
    domain: 'orders',
    action: clean(data.requestedAction, 120) || 'resolve_blocked_order',
    result: status,
    actorType: 'store_owner',
    actorLabel: actorLabel('store_owner'),
    authority: clean(data.authority, 160),
    subjectType: 'external_order',
    subjectId: clean(data.externalOrderId ?? data.orderId, 240),
    reason: clean(data.reason, 500),
    occurredAt: timestampIso(
      data.serverCompletedAt ??
      data.serverFailedAt ??
      data.serverRequestedAt ??
      data.completedAt ??
      data.failedAt ??
      data.requestedAt
    ),
    sourceKind: '99food_order_block_resolution',
    sourceRef: `stores/${canonicalStoreId}/integrationOrderBlockResolutions/${id}`,
    metadata: sanitizeMetadata({
      provider: '99food',
      orderId: clean(data.orderId, 240) || null,
      blockedState: clean(data.blockedState, 160) || null,
      attempts: safeInteger(data.attempts),
      reconciliationRequired: status === 'reconciliation_required',
    }),
  };
};

const readCanonicalEvents = async (
  tenantId: string,
  canonicalStoreId: string,
  limit: number
): Promise<StoreAdministrativeAuditEvent[]> => {
  if (!canonicalStoreId) return [];
  const snapshot = await adminDb
    .collection(`stores/${canonicalStoreId}/administrativeAudit`)
    .orderBy('occurredAt', 'desc')
    .limit(limit)
    .get();
  return snapshot.docs.map(document =>
    canonicalEvent(tenantId, canonicalStoreId, document.id, document.data() as Record<string, unknown>)
  );
};

const readOwnerGovernanceEvents = async (
  tenantId: string,
  canonicalStoreId: string,
  limit: number
): Promise<StoreAdministrativeAuditEvent[]> => {
  if (!canonicalStoreId) return [];
  const snapshot = await adminDb
    .collection(`stores/${canonicalStoreId}/ownerGovernanceDecisions`)
    .orderBy('appliedAt', 'desc')
    .limit(limit)
    .get();
  return snapshot.docs.map(document =>
    ownerGovernanceEvent(tenantId, canonicalStoreId, document.id, document.data() as Record<string, unknown>)
  );
};

const readInventoryAuthorityEvents = async (
  tenantId: string,
  canonicalStoreId: string,
  limit: number
): Promise<StoreAdministrativeAuditEvent[]> => {
  if (!canonicalStoreId) return [];
  const snapshot = await adminDb
    .collection(`stores/${canonicalStoreId}/inventoryAuthorityRepairs`)
    .orderBy('appliedAt', 'desc')
    .limit(limit)
    .get();
  return snapshot.docs.map(document =>
    inventoryRepairEvent(tenantId, canonicalStoreId, document.id, document.data() as Record<string, unknown>)
  );
};

const readMercadoLivreManualReviewEvents = async (
  tenantId: string,
  limit: number
): Promise<StoreAdministrativeAuditEvent[]> => {
  const snapshot = await adminDb
    .collection('integrationManualReviewAudit')
    .where('storeId', '==', tenantId)
    .orderBy('occurredAt', 'desc')
    .limit(limit)
    .get();
  return snapshot.docs.map(document =>
    mercadoLivreManualReviewEvent(tenantId, document.id, document.data() as Record<string, unknown>)
  );
};

const readNinetyNineFoodProductBindingAuditEvents = async (
  tenantId: string,
  canonicalStoreId: string,
  limit: number
): Promise<StoreAdministrativeAuditEvent[]> => {
  if (!canonicalStoreId) return [];
  const snapshot = await adminDb
    .collection(`stores/${canonicalStoreId}/externalProductBindingAudits`)
    .orderBy('occurredAt', 'desc')
    .limit(Math.min(240, Math.max(limit * 2, 80)))
    .get();
  return snapshot.docs.flatMap(document => {
    const data = document.data() as Record<string, unknown>;
    if (clean(data.provider, 80) !== '99food' || clean(data.tenantId, 160) !== tenantId) return [];
    return [ninetyNineFoodProductBindingAuditEvent(tenantId, canonicalStoreId, document.id, data)];
  }).slice(0, limit);
};

const readNinetyNineFoodOrderBlockResolutionEvents = async (
  tenantId: string,
  canonicalStoreId: string,
  limit: number
): Promise<StoreAdministrativeAuditEvent[]> => {
  if (!canonicalStoreId) return [];
  const snapshot = await adminDb
    .collection(`stores/${canonicalStoreId}/integrationOrderBlockResolutions`)
    .orderBy('serverRequestedAt', 'desc')
    .limit(Math.min(240, Math.max(limit * 2, 80)))
    .get();
  return snapshot.docs.flatMap(document => {
    const data = document.data() as Record<string, unknown>;
    if (clean(data.provider, 80) !== '99food' || clean(data.tenantId, 160) !== tenantId) return [];
    return [ninetyNineFoodOrderBlockResolutionEvent(tenantId, canonicalStoreId, document.id, data)];
  }).slice(0, limit);
};

const timeValue = (event: StoreAdministrativeAuditEvent): number => {
  const value = Date.parse(event.occurredAt);
  return Number.isFinite(value) ? value : 0;
};

export const loadStoreAdministrativeAudit = async (input: {
  tenantId: string;
  requestedByUserId: string;
  limit?: number;
}): Promise<StoreAdministrativeAuditSnapshot> => {
  const tenantId = clean(input.tenantId, 160);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  if (!tenantId || requestedByUserId !== tenantId) {
    throw new Error('STORE_ADMINISTRATIVE_AUDIT_FORBIDDEN');
  }
  const limit = Math.max(1, Math.min(100, Math.trunc(safeNumber(input.limit) ?? 50)));
  const sourceLimit = Math.min(120, Math.max(limit * 2, 40));
  const canonicalStoreId = await resolveCanonicalStoreId(tenantId);

  const sources = await Promise.allSettled([
    readCanonicalEvents(tenantId, canonicalStoreId, sourceLimit),
    readOwnerGovernanceEvents(tenantId, canonicalStoreId, sourceLimit),
    readInventoryAuthorityEvents(tenantId, canonicalStoreId, sourceLimit),
    readMercadoLivreManualReviewEvents(tenantId, sourceLimit),
    readNinetyNineFoodProductBindingAuditEvents(tenantId, canonicalStoreId, sourceLimit),
    readNinetyNineFoodOrderBlockResolutionEvents(tenantId, canonicalStoreId, sourceLimit),
  ]);
  const sourceNames = [
    'canonical_store_audit',
    'owner_governance_decision',
    'inventory_authority_repair',
    'mercado_livre_manual_review',
    '99food_product_binding_audit',
    '99food_order_block_resolution',
  ];
  const sourceWarnings = sources.flatMap((source, index) =>
    source.status === 'rejected' ? [`${sourceNames[index]}_unavailable`] : []
  );
  for (const [index, source] of sources.entries()) {
    if (source.status === 'rejected') {
      console.warn('[Store administrative audit source unavailable]', {
        tenantId,
        source: sourceNames[index],
        error: source.reason instanceof Error ? source.reason.message : String(source.reason),
      });
    }
  }

  const merged = new Map<string, StoreAdministrativeAuditEvent>();
  for (const source of sources) {
    if (source.status !== 'fulfilled') continue;
    for (const event of source.value) {
      if (!event.sourceRef || merged.has(event.sourceRef)) continue;
      merged.set(event.sourceRef, event);
    }
  }

  return {
    tenantId,
    canonicalStoreId,
    readAuthority: 'store_owner',
    items: [...merged.values()]
      .sort((left, right) => timeValue(right) - timeValue(left))
      .slice(0, limit),
    sourceWarnings,
    generatedAt: new Date().toISOString(),
  };
};
