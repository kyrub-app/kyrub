import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { FieldValue, type DocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  evaluateExternalWriteAttempt,
  evaluateExternalWriteAuthorizationRequest,
  type ExternalWriteAuthorizationBinding,
  type ExternalWriteTargetScope,
} from '../../shared/externalWriteGovernance.js';
import type { InventoryOrderStatus } from '../../shared/inventoryConsumption.js';

const AUTHORIZATION_COLLECTION = 'ninetyNineFoodStatusWriteAuthorizations';
const AUTHORIZATION_TTL_MS = 15 * 60 * 1000;

const SUPPORTED_STATUSES = new Set<InventoryOrderStatus>([
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'rejected',
  'cancelled',
]);

const PENDING_STATUSES = new Set([
  'authorization_required',
  'attention',
]);

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const integrationData = (value: unknown): Record<string, unknown> =>
  record(record(value).integration);

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const safeHashEquals = (expectedHex: string, actualHex: string): boolean => {
  if (!/^[a-f0-9]{64}$/i.test(expectedHex) || !/^[a-f0-9]{64}$/i.test(actualHex)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(expectedHex, 'hex'), Buffer.from(actualHex, 'hex'));
};

const orderReference = (tenantId: string, orderId: string) =>
  adminDb.doc(`artifacts/${tenantId}/public/data/customerOrders/${orderId}`);

export const ninetyNineFoodStatusWriteAuthorizationReference = (authorizationId: string) =>
  adminDb.doc(`${AUTHORIZATION_COLLECTION}/${authorizationId}`);

const orderRevision = (snapshot: Pick<DocumentSnapshot, 'updateTime'>): string => {
  if (!snapshot.updateTime) return '';
  return `${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}`;
};

const operationRef = (
  orderId: string,
  status: InventoryOrderStatus,
  revision: string
): string => `${orderId}:${status}:${revision}`;

const targetScope = (input: {
  tenantId: string;
  orderId: string;
  status: InventoryOrderStatus;
  orderRevision: string;
}): ExternalWriteTargetScope => ({
  storeId: input.tenantId,
  channel: '99food',
  operationKind: 'order.status_transition',
  operationRef: operationRef(input.orderId, input.status, input.orderRevision),
  targetRef: input.orderId,
});

export interface NinetyNineFoodStatusWriteAuthorizationCredential {
  authorizationId: string;
  authorizationToken: string;
  orderId: string;
  externalOrderId: string;
  status: InventoryOrderStatus;
  orderRevision: string;
  expiresAtMillis: number;
}

export interface NinetyNineFoodStatusWriteAuthorizationRecord {
  schemaVersion: 1;
  id: string;
  tenantId: string;
  storeId: string;
  provider: '99food';
  channel: '99food';
  operationKind: 'order.status_transition';
  operationRef: string;
  targetRef: string;
  orderId: string;
  externalOrderId: string;
  targetStatus: InventoryOrderStatus;
  orderRevision: string;
  status: 'authorized';
  consumptionStatus: 'available' | 'consumed';
  useCount: number;
  authoritySource: 'explicit_user_authorization';
  authorizedFields: string[];
  protectedFields: string[];
  tokenHash: string;
  expiresAtMillis: number;
  authorizedByUserId: string;
}

const parseAuthorizationRecord = (
  authorizationId: string,
  value: unknown
): NinetyNineFoodStatusWriteAuthorizationRecord => {
  const candidate = record(value);
  const targetStatus = clean(candidate.targetStatus) as InventoryOrderStatus;
  const authorizedFields = Array.isArray(candidate.authorizedFields)
    ? candidate.authorizedFields.map(clean).filter(Boolean)
    : [];
  const protectedFields = Array.isArray(candidate.protectedFields)
    ? candidate.protectedFields.map(clean).filter(Boolean)
    : [];
  if (
    Number(candidate.schemaVersion) !== 1 ||
    clean(candidate.id) !== authorizationId ||
    !clean(candidate.tenantId) ||
    clean(candidate.storeId) !== clean(candidate.tenantId) ||
    candidate.provider !== '99food' ||
    candidate.channel !== '99food' ||
    candidate.operationKind !== 'order.status_transition' ||
    !clean(candidate.operationRef) ||
    !clean(candidate.targetRef) ||
    !clean(candidate.orderId) ||
    !clean(candidate.externalOrderId) ||
    !SUPPORTED_STATUSES.has(targetStatus) ||
    !clean(candidate.orderRevision) ||
    candidate.status !== 'authorized' ||
    (candidate.consumptionStatus !== 'available' && candidate.consumptionStatus !== 'consumed') ||
    !Number.isSafeInteger(Number(candidate.useCount)) ||
    candidate.authoritySource !== 'explicit_user_authorization' ||
    authorizedFields.length === 0 ||
    !clean(candidate.tokenHash) ||
    !Number.isFinite(Number(candidate.expiresAtMillis)) ||
    !clean(candidate.authorizedByUserId)
  ) {
    throw new Error('Autorização one-time 99Food inválida.');
  }
  return {
    ...(candidate as unknown as NinetyNineFoodStatusWriteAuthorizationRecord),
    targetStatus,
    authorizedFields,
    protectedFields,
    useCount: Number(candidate.useCount),
    expiresAtMillis: Number(candidate.expiresAtMillis),
  };
};

export const issueNinetyNineFoodStatusWriteAuthorization = async (input: {
  tenantId: string;
  orderId: string;
  status: InventoryOrderStatus;
  expectedOrderRevision: string;
  authorizedByUserId: string;
}): Promise<NinetyNineFoodStatusWriteAuthorizationCredential> => {
  const tenantId = clean(input.tenantId);
  const orderId = clean(input.orderId);
  const expectedOrderRevision = clean(input.expectedOrderRevision);
  const authorizedByUserId = clean(input.authorizedByUserId);
  if (
    !tenantId ||
    !orderId ||
    !expectedOrderRevision ||
    authorizedByUserId !== tenantId ||
    !SUPPORTED_STATUSES.has(input.status)
  ) {
    throw new Error('Autorização one-time 99Food inválida.');
  }

  const governance = evaluateExternalWriteAuthorizationRequest({
    request: targetScope({
      tenantId,
      orderId,
      status: input.status,
      orderRevision: expectedOrderRevision,
    }),
    userSignal: 'explicit_authorization',
    authorizedFields: ['status'],
    protectedFields: [],
  });
  if (!governance.allowed) {
    throw new Error(`Autorização 99Food bloqueada pela governança multicanal (${governance.code}).`);
  }

  const orderRef = orderReference(tenantId, orderId);
  const authorizationToken = randomBytes(32).toString('base64url');
  const authorizationId = `99fwauth_${sha256(`${tenantId}:${orderId}:${input.status}:${authorizationToken}`).slice(0, 32)}`;
  const authorizationRef = ninetyNineFoodStatusWriteAuthorizationReference(authorizationId);
  const tokenHash = sha256(authorizationToken);
  const expiresAtMillis = Date.now() + AUTHORIZATION_TTL_MS;

  const result = await adminDb.runTransaction(async transaction => {
    const [snapshot, existingAuthorization] = await Promise.all([
      transaction.get(orderRef),
      transaction.get(authorizationRef),
    ]);
    if (!snapshot.exists) throw new Error('Pedido não encontrado.');
    const actualRevision = orderRevision(snapshot);
    if (!actualRevision || actualRevision !== expectedOrderRevision) {
      throw new Error('O pedido mudou desde a leitura da fila 99Food. Atualize a fila e confirme novamente.');
    }
    if (existingAuthorization.exists) {
      throw new Error('Autorização one-time 99Food já existe para esta confirmação.');
    }

    const order = record(snapshot.data());
    const integration = integrationData(order);
    const provider = clean(integration.provider);
    const outboundStatus = clean(integration.outboundStatus);
    const currentStatus = clean(order.status) as InventoryOrderStatus;
    const frozenTargetStatus = clean(integration.outboundTargetStatus) as InventoryOrderStatus;
    const expectedStatus = SUPPORTED_STATUSES.has(frozenTargetStatus)
      ? frozenTargetStatus
      : currentStatus;
    const externalOrderId = clean(integration.externalOrderId);

    if (provider !== '99food') {
      throw new Error('Autorização 99Food não corresponde ao provedor deste pedido.');
    }
    if (!PENDING_STATUSES.has(outboundStatus)) {
      throw new Error('Sincronização 99Food deste pedido não está pendente para autorização.');
    }
    if (
      !SUPPORTED_STATUSES.has(currentStatus) ||
      currentStatus !== input.status ||
      expectedStatus !== input.status
    ) {
      throw new Error('O status do pedido mudou desde a autorização 99Food. Revise a fila e confirme novamente.');
    }
    if (!externalOrderId) {
      throw new Error('Pedido 99Food sem identificador externo válido.');
    }

    const authorizedAt = new Date().toISOString();
    transaction.create(authorizationRef, {
      schemaVersion: 1,
      id: authorizationId,
      tenantId,
      storeId: tenantId,
      provider: '99food',
      channel: '99food',
      operationKind: 'order.status_transition',
      operationRef: operationRef(orderId, input.status, expectedOrderRevision),
      targetRef: orderId,
      orderId,
      externalOrderId,
      targetStatus: input.status,
      orderRevision: expectedOrderRevision,
      status: 'authorized',
      consumptionStatus: 'available',
      useCount: 0,
      authoritySource: 'explicit_user_authorization',
      authorizedFields: ['status'],
      protectedFields: [],
      tokenHash,
      expiresAtMillis,
      authorizedByUserId,
      authorizedAt,
      serverAuthorizedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { externalOrderId };
  });

  return {
    authorizationId,
    authorizationToken,
    orderId,
    externalOrderId: result.externalOrderId,
    status: input.status,
    orderRevision: expectedOrderRevision,
    expiresAtMillis,
  };
};

export const assertNinetyNineFoodStatusWriteAuthorizationForExecution = (input: {
  authorizationId: string;
  authorizationToken: string;
  tenantId: string;
  orderId: string;
  status: InventoryOrderStatus;
  orderRevision: string;
  externalOrderId: string;
  value: unknown;
}): NinetyNineFoodStatusWriteAuthorizationRecord => {
  const authorizationId = clean(input.authorizationId);
  const authorizationToken = clean(input.authorizationToken);
  const tenantId = clean(input.tenantId);
  const orderId = clean(input.orderId);
  const expectedOrderRevision = clean(input.orderRevision);
  const externalOrderId = clean(input.externalOrderId);
  if (!authorizationId || !authorizationToken || !tenantId || !orderId || !expectedOrderRevision || !externalOrderId) {
    throw new Error('Autorização one-time 99Food inválida.');
  }
  const authorization = parseAuthorizationRecord(authorizationId, input.value);
  if (
    authorization.tenantId !== tenantId ||
    authorization.storeId !== tenantId ||
    authorization.orderId !== orderId ||
    authorization.targetRef !== orderId ||
    authorization.externalOrderId !== externalOrderId ||
    authorization.targetStatus !== input.status ||
    authorization.orderRevision !== expectedOrderRevision ||
    authorization.operationRef !== operationRef(orderId, input.status, expectedOrderRevision) ||
    authorization.authorizedByUserId !== tenantId
  ) {
    throw new Error('Autorização one-time 99Food não corresponde ao pedido, status ou revisão atuais.');
  }
  if (authorization.expiresAtMillis <= Date.now()) {
    throw new Error('Autorização one-time 99Food expirou. Atualize a fila e confirme novamente.');
  }
  if (authorization.consumptionStatus !== 'available' || authorization.useCount !== 0) {
    throw new Error('Autorização one-time 99Food já foi consumida. Atualize a fila antes de qualquer novo envio.');
  }
  if (!safeHashEquals(authorization.tokenHash, sha256(authorizationToken))) {
    throw new Error('Token da autorização one-time 99Food é inválido.');
  }

  const request = targetScope({
    tenantId,
    orderId,
    status: input.status,
    orderRevision: expectedOrderRevision,
  });
  const binding: ExternalWriteAuthorizationBinding = {
    ...request,
    authorizationId,
    authoritySource: 'explicit_user_authorization',
    authorizedFields: authorization.authorizedFields,
    protectedFields: authorization.protectedFields,
    revalidatedImmediatelyBeforeWrite: true,
    consumptionStatus: 'available',
  };
  const governance = evaluateExternalWriteAttempt({
    request,
    authorization: binding,
    userSignal: 'explicit_authorization',
    providerWriteAttempted: false,
    reconciled: false,
  });
  if (!governance.allowed) {
    throw new Error(`Autorização 99Food bloqueada antes do provider write (${governance.code}).`);
  }
  return authorization;
};
