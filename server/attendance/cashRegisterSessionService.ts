import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { hasStorePermission, isStoreRole, type StoreRole } from '../../src/utils/storeSecurity.js';
import { authorizeInPersonOrderOperator } from './inPersonOrderService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const validId = (value: string): boolean =>
  /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value);

const validOperationId = (value: string): boolean =>
  /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,95}$/.test(value);

const sessionPath = (storeId: string, sessionId: string): string =>
  `stores/${storeId}/cashSessions/${sessionId}`;

const registerPath = (storeId: string, registerId: string): string =>
  `stores/${storeId}/cashRegisters/${registerId}`;

type RegisterActor = {
  canonicalStoreId: string;
  legacyStoreId: string;
  actorId: string;
  role: StoreRole;
};

/**
 * Resolve canonical store authority but recheck the CURRENT membership inside
 * each transaction. Request-provided store IDs, roles and actors grant nothing.
 */
const authorizeRegisterActor = async (input: {
  legacyStoreId: string;
  authenticatedUserId: string;
}): Promise<RegisterActor> => {
  const context = await authorizeInPersonOrderOperator({
    legacyStoreId: input.legacyStoreId,
    authenticatedUserId: input.authenticatedUserId,
    permission: 'cash.manage',
  });
  return {
    canonicalStoreId: context.canonicalStoreId,
    legacyStoreId: context.legacyStoreId,
    actorId: input.authenticatedUserId,
    role: context.role,
  };
};

const requireTransactionActor = async (
  transaction: FirebaseFirestore.Transaction,
  actor: RegisterActor
): Promise<void> => {
  const store = await transaction.get(adminDb.doc(`stores/${actor.canonicalStoreId}`));
  const data = store.data() as Record<string, unknown> | undefined;
  if (
    !store.exists ||
    clean(data?.ownerId) !== actor.legacyStoreId ||
    clean(data?.legacyTenantId) !== actor.legacyStoreId
  ) throw new Error('CASH_REGISTER_FORBIDDEN');

  if (actor.actorId === actor.legacyStoreId) return;
  const member = await transaction.get(adminDb.doc(
    `stores/${actor.canonicalStoreId}/members/${actor.actorId}`
  ));
  const current = member.data() as Record<string, unknown> | undefined;
  if (
    !member.exists ||
    clean(current?.userId) !== actor.actorId ||
    clean(current?.storeId) !== actor.canonicalStoreId ||
    clean(current?.status) !== 'active' ||
    !isStoreRole(current?.role) ||
    !hasStorePermission(current.role, 'cash.manage') ||
    current.role !== actor.role
  ) throw new Error('CASH_REGISTER_FORBIDDEN');
};

export const normalizedCashRegisterName = (value: unknown): string => {
  const name = clean(value);
  if (name.length < 2 || name.length > 60 || /[\r\n]/.test(name)) {
    throw new Error('CASH_REGISTER_NAME_INVALID');
  }
  return name;
};

export const cashOpeningAmountMinor = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) ||
    value < 0 || !Number.isSafeInteger(value) || value > 10_000_000_000) {
    throw new Error('CASH_REGISTER_AMOUNT_INVALID');
  }
  return value;
};

export const assertCashRegisterOpenIdempotency = (input: {
  existing: Record<string, unknown> | undefined;
  registerId: string;
  actorId: string;
  amountMinor: number;
  operationId: string;
}): 'create' | 'replay' => {
  if (!input.existing) return 'create';
  if (
    clean(input.existing.registerId) !== input.registerId ||
    clean(input.existing.openedByUserId) !== input.actorId ||
    input.existing.openingMinor !== input.amountMinor ||
    clean(input.existing.openOperationId) !== input.operationId
  ) throw new Error('CASH_REGISTER_IDEMPOTENCY_CONFLICT');
  return 'replay';
};

export const listCanonicalCashRegisters = async (input: {
  legacyStoreId: string;
  authenticatedUserId: string;
}): Promise<Array<{ id: string; name: string; activeSessionId: string }>> => {
  const actor = await authorizeRegisterActor(input);
  const snapshot = await adminDb
    .collection(`stores/${actor.canonicalStoreId}/cashRegisters`)
    .limit(100).get();
  return snapshot.docs.flatMap(document => {
    const data = document.data() as Record<string, unknown>;
    if (
      clean(data.storeId) !== actor.canonicalStoreId ||
      clean(data.id) !== document.id ||
      clean(data.status) !== 'active'
    ) return [];
    return [{
      id: document.id,
      name: clean(data.name),
      activeSessionId: clean(data.activeSessionId),
    }];
  }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
};

/** A register document is coordination metadata, not another financial book. */
export const createCanonicalCashRegister = async (input: {
  legacyStoreId: string;
  authenticatedUserId: string;
  name: unknown;
}): Promise<{ id: string; name: string }> => {
  const actor = await authorizeRegisterActor(input);
  const name = normalizedCashRegisterName(input.name);
  const id = `register-${randomUUID()}`;
  const register = adminDb.doc(registerPath(actor.canonicalStoreId, id));
  await adminDb.runTransaction(async transaction => {
    await requireTransactionActor(transaction, actor);
    transaction.create(register, {
      id,
      storeId: actor.canonicalStoreId,
      name,
      status: 'active',
      activeSessionId: '',
      revision: 0,
      createdByUserId: actor.actorId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(
      adminDb.doc(`stores/${actor.canonicalStoreId}/auditLogs/audit-cash-register-${id}`),
      {
        id: `audit-cash-register-${id}`,
        storeId: actor.canonicalStoreId,
        actorUserId: actor.actorId,
        actorRole: actor.role,
        action: 'cash.register.created',
        entityType: 'cashRegister',
        entityId: id,
        reason: '',
        before: null,
        after: { name },
        createdAt: FieldValue.serverTimestamp(),
      }
    );
  });
  return { id, name };
};

/**
 * A Firestore transaction serializes openings for the SAME register, while
 * independent registers can open in parallel. The session document remains
 * the existing canonical Cash ledger, not a parallel cash implementation.
 *
 * NOT yet wired to the CashWorkspace until closing, movement guards, the
 * direct-write rules and legacy pending Dexie compatibility are reconciled.
 */
export const openCanonicalCashRegisterSession = async (input: {
  legacyStoreId: string;
  authenticatedUserId: string;
  registerId: unknown;
  operationId: unknown;
  openingMinor: unknown;
  shiftLabel: unknown;
}): Promise<{
  sessionId: string;
  registerId: string;
  status: 'open' | 'closed';
  replay: boolean;
}> => {
  const actor = await authorizeRegisterActor(input);
  const registerId = clean(input.registerId);
  const operationId = clean(input.operationId);
  const shiftLabel = clean(input.shiftLabel);
  const openingMinor = cashOpeningAmountMinor(input.openingMinor);

  if (!validId(registerId)) throw new Error('CASH_REGISTER_ID_INVALID');
  if (!validOperationId(operationId)) throw new Error('CASH_REGISTER_OPERATION_INVALID');
  if (!shiftLabel || shiftLabel.length > 60) throw new Error('CASH_REGISTER_SHIFT_INVALID');
  const sessionId = `cash-session-${operationId}`;
  const register = adminDb.doc(registerPath(actor.canonicalStoreId, registerId));
  const session = adminDb.doc(sessionPath(actor.canonicalStoreId, sessionId));

  return adminDb.runTransaction(async transaction => {
    // ALL reads precede ANY write, as required by Firestore transactions.
    await requireTransactionActor(transaction, actor);
    const [registerSnapshot, sessionSnapshot] = await Promise.all([
      transaction.get(register),
      transaction.get(session),
    ]);
    const registerValue = registerSnapshot.data() as Record<string, unknown> | undefined;
    if (
      !registerSnapshot.exists ||
      clean(registerValue?.id) !== registerId ||
      clean(registerValue?.storeId) !== actor.canonicalStoreId ||
      clean(registerValue?.status) !== 'active'
    ) throw new Error('CASH_REGISTER_NOT_FOUND');

    const idempotency = assertCashRegisterOpenIdempotency({
      existing: sessionSnapshot.exists
        ? sessionSnapshot.data() as Record<string, unknown>
        : undefined,
      registerId,
      actorId: actor.actorId,
      amountMinor: openingMinor,
      operationId,
    });
    if (idempotency === 'replay') {
      const status = clean(sessionSnapshot.data()?.status);
      if (status !== 'open' && status !== 'closed') {
        throw new Error('CASH_REGISTER_IDEMPOTENCY_CONFLICT');
      }
      return { sessionId, registerId, status: status as 'open' | 'closed', replay: true };
    }

    if (clean(registerValue?.activeSessionId)) {
      throw new Error('CASH_REGISTER_ALREADY_OPEN');
    }
    const revision = registerValue?.revision;
    if (!Number.isSafeInteger(revision) || (revision as number) < 0) {
      throw new Error('CASH_REGISTER_INTEGRITY_CONFLICT');
    }
    transaction.create(session, {
      id: sessionId,
      storeId: actor.canonicalStoreId,
      registerId,
      openOperationId: operationId,
      shiftLabel,
      revision: 0,
      openingMinor,
      movementNetMinor: 0,
      movementCount: 0,
      status: 'open',
      operatorUserId: actor.actorId,
      openedByUserId: actor.actorId,
      operatorRole: actor.role,
      operatorName: actor.actorId,
      openingAmount: openingMinor / 100,
      expectedAmount: openingMinor / 100,
      countedAmount: 0,
      difference: 0,
      openedAt: FieldValue.serverTimestamp(),
      closedAt: '',
      closedByUserId: '',
      closedByRole: '',
      closedByName: '',
      closeReason: '',
      deviceId: 'server-managed-register',
      legacyStoreId: actor.legacyStoreId,
      migration: { mode: 'write_through', source: 'dexie' },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(register, {
      activeSessionId: sessionId,
      revision: (revision as number) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(
      adminDb.doc(`stores/${actor.canonicalStoreId}/auditLogs/audit-cash-open-${sessionId}`),
      {
        id: `audit-cash-open-${sessionId}`,
        storeId: actor.canonicalStoreId,
        actorUserId: actor.actorId,
        actorRole: actor.role,
        action: 'cash.session.opened',
        entityType: 'cashSession',
        entityId: sessionId,
        reason: '',
        before: null,
        after: { status: 'open', openingAmount: openingMinor / 100, registerId },
        createdAt: FieldValue.serverTimestamp(),
      }
    );
    return { sessionId, registerId, status: 'open' as const, replay: false };
  });
};
