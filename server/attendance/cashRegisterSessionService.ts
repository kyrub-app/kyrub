import { createHash } from 'node:crypto';
import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { hasStorePermission, isStoreRole, type StoreRole } from '../../src/utils/storeSecurity.js';
import { authorizeInPersonOrderOperator } from './inPersonOrderService.js';
import { assessCashCutoverPreflight, type CashCutoverPreflight } from './cashRegisterCutoverReadiness.js';

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

const coordinationPath = (storeId: string): string =>
  `stores/${storeId}/cashCoordination/current`;

/**
 * Only an explicitly committed, server-owned transition permits managed
 * movements. A missing control doc is LEGACY mode, never managed.
 */
export const isAuthorizedManagedCashMode = (value: unknown, storeId: string): boolean => {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return row.mode === 'managed' &&
    row.storeId === storeId &&
    row.schemaVersion === 1 &&
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,95}$/.test(clean(row.cutoverOperationId));
};

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
  transaction: Transaction,
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

const requireManagedCashMode = async (
  transaction: Transaction,
  actor: RegisterActor
): Promise<void> => {
  const snapshot = await transaction.get(
    adminDb.doc(coordinationPath(actor.canonicalStoreId))
  );
  if (!snapshot.exists ||
    !isAuthorizedManagedCashMode(snapshot.data(), actor.canonicalStoreId)
  ) throw new Error('CASH_REGISTER_CUTOVER_NOT_ENABLED');
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
  shiftLabel: string;
}): 'create' | 'replay' => {
  if (!input.existing) return 'create';
  if (
    clean(input.existing.registerId) !== input.registerId ||
    clean(input.existing.openedByUserId) !== input.actorId ||
    input.existing.openingMinor !== input.amountMinor ||
    clean(input.existing.openOperationId) !== input.operationId ||
    clean(input.existing.shiftLabel) !== input.shiftLabel
  ) throw new Error('CASH_REGISTER_IDEMPOTENCY_CONFLICT');
  return 'replay';
};

/**
 * Read-only, bounded and fail-closed: remote state is not proof that other
 * browsers have no unsynced Dexie writes. Owner or manager only.
 */
export const inspectCanonicalCashCutoverReadiness = async (input: {
  legacyStoreId: string;
  authenticatedUserId: string;
}): Promise<CashCutoverPreflight> => {
  const actor = await authorizeRegisterActor(input);
  if (actor.role !== 'owner' && actor.role !== 'manager') {
    throw new Error('CASH_REGISTER_FORBIDDEN');
  }
  // Revalidate current membership before reading the store's cash metadata.
  await adminDb.runTransaction(transaction => requireTransactionActor(transaction, actor));
  const [sessions, registers] = await Promise.all([
    adminDb.collection(`stores/${actor.canonicalStoreId}/cashSessions`)
      .where('status', '==', 'open').limit(101).get(),
    adminDb.collection(`stores/${actor.canonicalStoreId}/cashRegisters`)
      .limit(101).get(),
  ]);
  return assessCashCutoverPreflight({
    canonicalStoreId: actor.canonicalStoreId,
    openSessions: sessions.docs.slice(0, 100).map(document => ({
      id: document.id, data: document.data() as Record<string, unknown>,
    })),
    registers: registers.docs.slice(0, 100).map(document => ({
      id: document.id, data: document.data() as Record<string, unknown>,
    })),
    openSessionLimitReached: sessions.docs.length > 100,
    registerLimitReached: registers.docs.length > 100,
  });
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
  if (actor.role !== 'owner' && actor.role !== 'manager') {
    throw new Error('CASH_REGISTER_FORBIDDEN');
  }
  const id = `register-${createHash('sha256').update(name.normalize('NFKC').toLocaleLowerCase('pt-BR')).digest('hex').slice(0,24)}`;
  const register = adminDb.doc(registerPath(actor.canonicalStoreId, id));
  await adminDb.runTransaction(async transaction => {
    await requireTransactionActor(transaction, actor);
    if ((await transaction.get(register)).exists) {
      throw new Error('CASH_REGISTER_ALREADY_EXISTS');
    }
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
    await requireManagedCashMode(transaction, actor);
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
      shiftLabel,
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


type ManagedCashMovementType = 'income' | 'expense' | 'supply' | 'withdrawal' | 'adjustment';
type CashDirection = 'in' | 'out';

const validManagedMovementType = (value: string): value is ManagedCashMovementType =>
  ['income', 'expense', 'supply', 'withdrawal', 'adjustment'].includes(value);

const requireManagedSession = (
  session: Record<string, unknown> | undefined,
  register: Record<string, unknown> | undefined,
  actor: RegisterActor,
  registerId: string,
  sessionId: string
): void => {
  if (
    !session ||
    clean(session.id) !== sessionId ||
    clean(session.storeId) !== actor.canonicalStoreId ||
    clean(session.legacyStoreId) !== actor.legacyStoreId ||
    clean(session.registerId) !== registerId ||
    !validOperationId(clean(session.openOperationId)) ||
    session.deviceId !== 'server-managed-register' ||
    !register ||
    clean(register.id) !== registerId ||
    clean(register.storeId) !== actor.canonicalStoreId
  ) throw new Error('CASH_REGISTER_INTEGRITY_CONFLICT');
};

const managedLedgerTotals = (session: Record<string, unknown>): {
  openingMinor: number;
  netMinor: number;
  count: number;
  revision: number;
  expectedMinor: number;
} => {
  const openingMinor = session.openingMinor;
  const netMinor = session.movementNetMinor;
  const count = session.movementCount;
  const revision = session.revision;
  if (
    !Number.isSafeInteger(openingMinor) || (openingMinor as number) < 0 ||
    !Number.isSafeInteger(netMinor) ||
    !Number.isSafeInteger(count) || (count as number) < 0 ||
    !Number.isSafeInteger(revision) || (revision as number) < 0
  ) throw new Error('CASH_REGISTER_INTEGRITY_CONFLICT');
  const expectedMinor = (openingMinor as number) + (netMinor as number);
  if (!Number.isSafeInteger(expectedMinor) || expectedMinor < 0) {
    throw new Error('CASH_REGISTER_INTEGRITY_CONFLICT');
  }
  return {
    openingMinor: openingMinor as number,
    netMinor: netMinor as number,
    count: count as number,
    revision: revision as number,
    expectedMinor,
  };
};

const managedOperationId = (value: unknown): string => {
  const operationId = clean(value);
  if (!validOperationId(operationId)) throw new Error('CASH_REGISTER_OPERATION_INVALID');
  return operationId;
};

export const validateManagedCashMovementInput = (input: {
  type: unknown;
  direction: unknown;
  amountMinor: unknown;
  description: unknown;
  category: unknown;
  reason: unknown;
}): {
  type: ManagedCashMovementType;
  direction: CashDirection;
  amountMinor: number;
  description: string;
  category: string;
  reason: string;
} => {
  const type = clean(input.type);
  const direction = clean(input.direction);
  const description = clean(input.description);
  const category = clean(input.category);
  const reason = clean(input.reason);
  const amountMinor = input.amountMinor;
  if (!validManagedMovementType(type)) throw new Error('CASH_REGISTER_MOVEMENT_TYPE_INVALID');
  if (
    (type === 'income' || type === 'supply') && direction !== 'in' ||
    (type === 'expense' || type === 'withdrawal') && direction !== 'out' ||
    type === 'adjustment' && direction !== 'in' && direction !== 'out'
  ) throw new Error('CASH_REGISTER_MOVEMENT_DIRECTION_INVALID');
  if (
    !Number.isSafeInteger(amountMinor) ||
    (amountMinor as number) <= 0 ||
    (amountMinor as number) > 10_000_000_000
  ) throw new Error('CASH_REGISTER_AMOUNT_INVALID');
  if (!description || description.length > 160 || !category || category.length > 80) {
    throw new Error('CASH_REGISTER_MOVEMENT_INVALID');
  }
  if (reason.length > 300 || (
    ['expense', 'withdrawal', 'adjustment'].includes(type) && !reason
  )) throw new Error('CASH_REGISTER_MOVEMENT_REASON_REQUIRED');
  return { type, direction: direction as CashDirection, amountMinor: amountMinor as number, description, category, reason };
};

/**
 * Physical-money movements only. `sale` and provider `payment_capture`
 * are intentionally excluded; payment settlement uses the existing economic
 * ledger. Never count Pix/card as banknotes in the register.
 *
 * Each movement updates the SAME cashSession aggregate in the transaction,
 * serializing concurrent cashiers with a closing transaction. The route
 * remains disabled until legacy direct Firestore writes are blocked.
 */
export const addCanonicalCashRegisterMovement = async (input: {
  legacyStoreId: string;
  authenticatedUserId: string;
  registerId: unknown;
  sessionId: unknown;
  operationId: unknown;
  type: unknown;
  direction: unknown;
  amountMinor: unknown;
  description: unknown;
  category: unknown;
  reason: unknown;
}): Promise<{ movementId: string; sessionId: string; replay: boolean }> => {
  const actor = await authorizeRegisterActor(input);
  const registerId = clean(input.registerId);
  const sessionId = clean(input.sessionId);
  const operationId = managedOperationId(input.operationId);
  if (!validId(registerId) || !validId(sessionId)) throw new Error('CASH_REGISTER_ID_INVALID');
  const body = validateManagedCashMovementInput(input);
  const movementId = `cash-movement-${operationId}`;
  const registerRef = adminDb.doc(registerPath(actor.canonicalStoreId, registerId));
  const sessionRef = adminDb.doc(sessionPath(actor.canonicalStoreId, sessionId));
  const movementRef = sessionRef.collection('movements').doc(movementId);

  return adminDb.runTransaction(async transaction => {
    await requireTransactionActor(transaction, actor);
    await requireManagedCashMode(transaction, actor);
    const [registerSnapshot, sessionSnapshot, movementSnapshot] = await Promise.all([
      transaction.get(registerRef),
      transaction.get(sessionRef),
      transaction.get(movementRef),
    ]);
    const register = registerSnapshot.data() as Record<string, unknown> | undefined;
    const session = sessionSnapshot.data() as Record<string, unknown> | undefined;
    requireManagedSession(session, register, actor, registerId, sessionId);
    if (movementSnapshot.exists) {
      const previous = movementSnapshot.data() as Record<string, unknown>;
      if (
        clean(previous.id) !== movementId ||
        clean(previous.sessionId) !== sessionId ||
        clean(previous.actorUserId) !== actor.actorId ||
        clean(previous.operationId) !== operationId ||
        clean(previous.type) !== body.type ||
        clean(previous.direction) !== body.direction ||
        previous.amountMinor !== body.amountMinor ||
        clean(previous.description) !== body.description ||
        clean(previous.category) !== body.category ||
        clean(previous.reason) !== body.reason ||
        clean(previous.source) !== 'manual'
      ) throw new Error('CASH_REGISTER_IDEMPOTENCY_CONFLICT');
      return { movementId, sessionId, replay: true };
    }
    if (clean(session?.status) !== 'open' || clean(register?.activeSessionId) !== sessionId) {
      throw new Error('CASH_REGISTER_SESSION_CLOSED');
    }
    const totals = managedLedgerTotals(session!);
    const delta = body.direction === 'in' ? body.amountMinor : -body.amountMinor;
    const newNetMinor = totals.netMinor + delta;
    const expectedMinor = totals.openingMinor + newNetMinor;
    if (
      !Number.isSafeInteger(newNetMinor) ||
      !Number.isSafeInteger(expectedMinor) ||
      expectedMinor < 0
    ) throw new Error('CASH_REGISTER_BALANCE_INVALID');

    transaction.create(movementRef, {
      id: movementId,
      operationId,
      storeId: actor.canonicalStoreId,
      sessionId,
      registerId,
      actorUserId: actor.actorId,
      actorRole: actor.role,
      actorName: actor.actorId,
      type: body.type,
      direction: body.direction,
      amountMinor: body.amountMinor,
      amount: body.amountMinor / 100,
      description: body.description,
      category: body.category,
      reason: body.reason,
      source: 'manual',
      paymentId: '',
      deviceId: 'server-managed-register',
      legacyStoreId: actor.legacyStoreId,
      occurredAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.update(sessionRef, {
      movementNetMinor: newNetMinor,
      movementCount: totals.count + 1,
      revision: totals.revision + 1,
      expectedAmount: expectedMinor / 100,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(
      adminDb.doc(`stores/${actor.canonicalStoreId}/auditLogs/audit-cash-movement-${movementId}`),
      {
        id: `audit-cash-movement-${movementId}`,
        storeId: actor.canonicalStoreId,
        actorUserId: actor.actorId,
        actorRole: actor.role,
        action: `cash.movement.${body.type}`,
        entityType: 'cashMovement',
        entityId: movementId,
        reason: body.reason,
        before: null,
        after: { direction: body.direction, amount: body.amountMinor / 100, sessionId, registerId },
        createdAt: FieldValue.serverTimestamp(),
      }
    );
    return { movementId, sessionId, replay: false };
  });
};

/**
 * Closing competes for the same session document as every cash movement;
 * the register pointer is cleared only after a confirmed, single closure.
 * This does not backfill or silently close legacy Dexie sessions.
 */
export const closeCanonicalCashRegisterSession = async (input: {
  legacyStoreId: string;
  authenticatedUserId: string;
  registerId: unknown;
  sessionId: unknown;
  operationId: unknown;
  countedMinor: unknown;
  reason: unknown;
}): Promise<{
  sessionId: string;
  status: 'closed';
  countedMinor: number;
  expectedMinor: number;
  differenceMinor: number;
  replay: boolean;
}> => {
  const actor = await authorizeRegisterActor(input);
  const registerId = clean(input.registerId);
  const sessionId = clean(input.sessionId);
  const operationId = managedOperationId(input.operationId);
  const reason = clean(input.reason);
  if (!validId(registerId) || !validId(sessionId)) throw new Error('CASH_REGISTER_ID_INVALID');
  if (reason.length > 300) throw new Error('CASH_REGISTER_CLOSE_REASON_INVALID');
  const countedMinor = cashOpeningAmountMinor(input.countedMinor);
  const registerRef = adminDb.doc(registerPath(actor.canonicalStoreId, registerId));
  const sessionRef = adminDb.doc(sessionPath(actor.canonicalStoreId, sessionId));

  return adminDb.runTransaction(async transaction => {
    await requireTransactionActor(transaction, actor);
    await requireManagedCashMode(transaction, actor);
    const [registerSnapshot, sessionSnapshot] = await Promise.all([
      transaction.get(registerRef),
      transaction.get(sessionRef),
    ]);
    const register = registerSnapshot.data() as Record<string, unknown> | undefined;
    const session = sessionSnapshot.data() as Record<string, unknown> | undefined;
    requireManagedSession(session, register, actor, registerId, sessionId);
    const status = clean(session?.status);
    if (status === 'closed') {
      if (
        clean(session?.closeOperationId) !== operationId ||
        clean(session?.closedByUserId) !== actor.actorId ||
        session?.countedMinor !== countedMinor ||
        clean(session?.closeReason) !== reason ||
        !Number.isSafeInteger(session?.expectedMinor) ||
        !Number.isSafeInteger(session?.differenceMinor)
      ) throw new Error('CASH_REGISTER_IDEMPOTENCY_CONFLICT');
      return {
        sessionId,
        status: 'closed' as const,
        countedMinor,
        expectedMinor: session!.expectedMinor as number,
        differenceMinor: session!.differenceMinor as number,
        replay: true,
      };
    }
    if (status !== 'open' || clean(register?.activeSessionId) !== sessionId) {
      throw new Error('CASH_REGISTER_SESSION_CLOSED');
    }
    // The cashier who opened the shift is its responsible closer. Manager and
    // owner can close an assigned shift, preserving a real audit actor.
    if (
      actor.role === 'cashier' &&
      clean(session?.openedByUserId) !== actor.actorId
    ) throw new Error('CASH_REGISTER_FORBIDDEN');
    const totals = managedLedgerTotals(session!);
    const differenceMinor = countedMinor - totals.expectedMinor;
    if (!Number.isSafeInteger(differenceMinor)) {
      throw new Error('CASH_REGISTER_BALANCE_INVALID');
    }
    if (differenceMinor !== 0 && !reason) {
      throw new Error('CASH_REGISTER_CLOSE_REASON_REQUIRED');
    }
    const revision = register?.revision;
    if (!Number.isSafeInteger(revision) || (revision as number) < 0) {
      throw new Error('CASH_REGISTER_INTEGRITY_CONFLICT');
    }
    transaction.update(sessionRef, {
      status: 'closed',
      closeOperationId: operationId,
      expectedMinor: totals.expectedMinor,
      countedMinor,
      differenceMinor,
      expectedAmount: totals.expectedMinor / 100,
      countedAmount: countedMinor / 100,
      difference: differenceMinor / 100,
      closedAt: FieldValue.serverTimestamp(),
      closedByUserId: actor.actorId,
      closedByRole: actor.role,
      closedByName: actor.actorId,
      closeReason: reason,
      revision: totals.revision + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(registerRef, {
      activeSessionId: '',
      revision: (revision as number) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(
      adminDb.doc(`stores/${actor.canonicalStoreId}/auditLogs/audit-cash-close-${sessionId}`),
      {
        id: `audit-cash-close-${sessionId}`,
        storeId: actor.canonicalStoreId,
        actorUserId: actor.actorId,
        actorRole: actor.role,
        action: 'cash.session.closed',
        entityType: 'cashSession',
        entityId: sessionId,
        reason,
        before: { status: 'open' },
        after: {
          status: 'closed',
          expectedAmount: totals.expectedMinor / 100,
          countedAmount: countedMinor / 100,
          difference: differenceMinor / 100,
          registerId,
        },
        createdAt: FieldValue.serverTimestamp(),
      }
    );
    return {
      sessionId,
      status: 'closed' as const,
      countedMinor,
      expectedMinor: totals.expectedMinor,
      differenceMinor,
      replay: false,
    };
  });
};
