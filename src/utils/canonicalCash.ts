import Dexie, { type Table } from 'dexie';
import type { User } from 'firebase/auth';
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  parseCanonicalStore,
  parseStoreMemberDirectoryRecord,
  type CanonicalStoreRecord,
} from './storeDirectory';
import {
  getStoreAuditLogsCollectionPath,
  getStoreCashMovementsCollectionPath,
  getStoreCashSessionDocumentPath,
  getStoreCashSessionsCollectionPath,
  getStoreDocumentPath,
  type StoreRole,
} from './storeSecurity';

export type CashSessionStatus = 'open' | 'closed';
export type CashDirection = 'in' | 'out';
export type CashMovementType =
  | 'sale'
  | 'income'
  | 'expense'
  | 'supply'
  | 'withdrawal'
  | 'adjustment';

export interface CashStoreContext {
  store: CanonicalStoreRecord;
  role: Extract<StoreRole, 'owner' | 'manager' | 'cashier'>;
  userId: string;
  operatorName: string;
  legacyStoreId: string;
}

export interface CanonicalCashSession {
  id: string;
  storeId: string;
  status: CashSessionStatus;
  operatorUserId: string;
  operatorRole: StoreRole;
  operatorName: string;
  openingAmount: number;
  expectedAmount: number;
  countedAmount: number;
  difference: number;
  openedAt: string;
  closedAt: string;
  closedByUserId: string;
  closedByRole: string;
  closedByName: string;
  closeReason: string;
  deviceId: string;
  legacyStoreId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CanonicalCashMovement {
  id: string;
  storeId: string;
  sessionId: string;
  type: CashMovementType;
  direction: CashDirection;
  amount: number;
  description: string;
  category: string;
  reason: string;
  actorUserId: string;
  actorRole: StoreRole;
  actorName: string;
  source: 'manual' | 'payment' | 'migration';
  paymentId: string;
  deviceId: string;
  legacyStoreId: string;
  occurredAt: string;
  createdAt: string;
}

interface LocalCashSession {
  id?: number;
  canonicalId: string;
  storeId: string;
  status: CashSessionStatus;
  openedAt: string;
  closedAt?: string;
  initialCash: number;
  finalCash?: number;
  expectedAmount: number;
  difference: number;
  operatorUserId: string;
  operatorRole: StoreRole;
  operatorName: string;
  closedByUserId: string;
  closedByRole: string;
  closedByName: string;
  closeReason: string;
  deviceId: string;
  legacyStoreId: string;
  createSynced: boolean;
  closeSynced: boolean;
}

interface LocalCashMovement {
  id?: number;
  canonicalId: string;
  sessionId: string;
  type: 'entrada' | 'saida';
  movementType: CashMovementType;
  direction: CashDirection;
  description: string;
  amount: number;
  category: string;
  reason: string;
  timestamp: string;
  actorUserId: string;
  actorRole: StoreRole;
  actorName: string;
  source: 'manual' | 'payment' | 'migration';
  paymentId: string;
  deviceId: string;
  legacyStoreId: string;
  synced: boolean;
}

class CashDexieDB extends Dexie {
  sessions!: Table<LocalCashSession, number>;
  movements!: Table<LocalCashMovement, number>;

  constructor() {
    super('DexieERPDB');
    this.version(1).stores({
      sessions: '++id, status, openedAt',
      movements: '++id, type, category, timestamp',
    });
  }
}

const cashDb = new CashDexieDB();

const cleanString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const timestampToIso = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as Timestamp).toDate().toISOString();
  }
  return '';
};

const cashRoleAllowed = (
  role: StoreRole
): role is Extract<StoreRole, 'owner' | 'manager' | 'cashier'> =>
  role === 'owner' || role === 'manager' || role === 'cashier';

const getDeviceId = (): string => {
  const key = 'kyrub_cash_device_id';
  const existing = globalThis.localStorage?.getItem(key) ?? '';
  if (existing) return existing;
  const generated = `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  globalThis.localStorage?.setItem(key, generated);
  return generated;
};

const createRecordId = (prefix: string, userId: string): string =>
  `${prefix}-${Date.now().toString(36)}-${userId.slice(0, 8)}-${Math.random().toString(36).slice(2, 8)}`;

export const getCashDirection = (
  type: CashMovementType,
  adjustmentDirection: CashDirection = 'in'
): CashDirection => {
  if (type === 'expense' || type === 'withdrawal') return 'out';
  if (type === 'adjustment') return adjustmentDirection;
  return 'in';
};

export const movementRequiresReason = (type: CashMovementType): boolean =>
  type === 'expense' || type === 'withdrawal' || type === 'adjustment';

export const calculateExpectedCash = (
  openingAmount: number,
  movements: Array<Pick<CanonicalCashMovement, 'direction' | 'amount'>>
): number => {
  const total = movements.reduce(
    (value, movement) =>
      value + (movement.direction === 'in' ? movement.amount : -movement.amount),
    openingAmount
  );
  return Number(total.toFixed(2));
};

export const calculateCashDifference = (
  countedAmount: number,
  expectedAmount: number
): number => Number((countedAmount - expectedAmount).toFixed(2));

export const resolveCashStoreContext = async (
  user: Pick<User, 'uid' | 'displayName' | 'email'>,
  legacyStoreId: string
): Promise<CashStoreContext | null> => {
  const normalizedLegacyStoreId = legacyStoreId.trim();
  if (!normalizedLegacyStoreId) return null;

  const ownedSnapshot = await getDocs(
    query(collection(db, 'stores'), where('ownerId', '==', user.uid))
  );
  const contexts: CashStoreContext[] = ownedSnapshot.docs.flatMap(snapshot => {
    const store = parseCanonicalStore(snapshot.data());
    if (!store || store.legacyTenantId !== normalizedLegacyStoreId) return [];
    return [{
      store,
      role: 'owner' as const,
      userId: user.uid,
      operatorName: user.displayName?.trim() || user.email?.trim() || 'Proprietário',
      legacyStoreId: normalizedLegacyStoreId,
    }];
  });

  const membershipSnapshot = await getDocs(
    query(collectionGroup(db, 'members'), where('userId', '==', user.uid))
  );

  for (const membershipDocument of membershipSnapshot.docs) {
    const membership = parseStoreMemberDirectoryRecord(membershipDocument.data());
    if (
      !membership ||
      membership.status !== 'active' ||
      !cashRoleAllowed(membership.role)
    ) {
      continue;
    }

    const storeSnapshot = await getDoc(doc(db, getStoreDocumentPath(membership.storeId)));
    const store = parseCanonicalStore(storeSnapshot.data());
    if (!store || store.legacyTenantId !== normalizedLegacyStoreId) continue;
    if (contexts.some(context => context.store.id === store.id)) continue;

    contexts.push({
      store,
      role: membership.role,
      userId: user.uid,
      operatorName:
        membership.displayName.trim() || user.displayName?.trim() || user.email?.trim() || 'Operador',
      legacyStoreId: normalizedLegacyStoreId,
    });
  }

  if (contexts.length > 1) {
    throw new Error(
      'Mais de uma loja canônica corresponde a este caixa. Selecione a loja ativa antes de continuar.'
    );
  }

  return contexts[0] ?? null;
};

export const parseCashSession = (value: unknown): CanonicalCashSession | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const openingAmount = finiteNumber(candidate.openingAmount);
  const expectedAmount = finiteNumber(candidate.expectedAmount);
  const countedAmount = finiteNumber(candidate.countedAmount);
  const difference = finiteNumber(candidate.difference);
  const status = candidate.status;
  if (
    !cleanString(candidate.id) ||
    !cleanString(candidate.storeId) ||
    (status !== 'open' && status !== 'closed') ||
    openingAmount === null ||
    expectedAmount === null ||
    countedAmount === null ||
    difference === null
  ) {
    return null;
  }

  return {
    id: cleanString(candidate.id),
    storeId: cleanString(candidate.storeId),
    status,
    operatorUserId: cleanString(candidate.operatorUserId),
    operatorRole: cleanString(candidate.operatorRole) as StoreRole,
    operatorName: cleanString(candidate.operatorName),
    openingAmount,
    expectedAmount,
    countedAmount,
    difference,
    openedAt: timestampToIso(candidate.openedAt),
    closedAt: timestampToIso(candidate.closedAt),
    closedByUserId: cleanString(candidate.closedByUserId),
    closedByRole: cleanString(candidate.closedByRole),
    closedByName: cleanString(candidate.closedByName),
    closeReason: cleanString(candidate.closeReason),
    deviceId: cleanString(candidate.deviceId),
    legacyStoreId: cleanString(candidate.legacyStoreId),
    createdAt: timestampToIso(candidate.createdAt),
    updatedAt: timestampToIso(candidate.updatedAt),
  };
};

export const parseCashMovement = (value: unknown): CanonicalCashMovement | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const amount = finiteNumber(candidate.amount);
  const type = candidate.type;
  const direction = candidate.direction;
  if (
    !cleanString(candidate.id) ||
    !cleanString(candidate.storeId) ||
    !cleanString(candidate.sessionId) ||
    !['sale', 'income', 'expense', 'supply', 'withdrawal', 'adjustment'].includes(String(type)) ||
    (direction !== 'in' && direction !== 'out') ||
    amount === null ||
    amount <= 0
  ) {
    return null;
  }

  return {
    id: cleanString(candidate.id),
    storeId: cleanString(candidate.storeId),
    sessionId: cleanString(candidate.sessionId),
    type: type as CashMovementType,
    direction,
    amount,
    description: cleanString(candidate.description),
    category: cleanString(candidate.category),
    reason: cleanString(candidate.reason),
    actorUserId: cleanString(candidate.actorUserId),
    actorRole: cleanString(candidate.actorRole) as StoreRole,
    actorName: cleanString(candidate.actorName),
    source: (cleanString(candidate.source) || 'manual') as CanonicalCashMovement['source'],
    paymentId: cleanString(candidate.paymentId),
    deviceId: cleanString(candidate.deviceId),
    legacyStoreId: cleanString(candidate.legacyStoreId),
    occurredAt: timestampToIso(candidate.occurredAt),
    createdAt: timestampToIso(candidate.createdAt),
  };
};

const auditReference = (storeId: string, auditId: string) =>
  doc(db, `${getStoreAuditLogsCollectionPath(storeId)}/${auditId}`);

const persistSessionOpen = async (
  context: CashStoreContext,
  local: LocalCashSession
): Promise<void> => {
  const reference = doc(db, getStoreCashSessionDocumentPath(context.store.id, local.canonicalId));
  if ((await getDoc(reference)).exists()) return;

  const auditId = `audit-cash-open-${local.canonicalId}`;
  const batch = writeBatch(db);
  batch.set(reference, {
    id: local.canonicalId,
    storeId: context.store.id,
    status: 'open',
    operatorUserId: local.operatorUserId,
    operatorRole: local.operatorRole,
    operatorName: local.operatorName,
    openingAmount: local.initialCash,
    expectedAmount: local.initialCash,
    countedAmount: 0,
    difference: 0,
    openedAt: serverTimestamp(),
    closedAt: '',
    closedByUserId: '',
    closedByRole: '',
    closedByName: '',
    closeReason: '',
    deviceId: local.deviceId,
    legacyStoreId: local.legacyStoreId,
    migration: { mode: 'write_through', source: 'dexie' },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(auditReference(context.store.id, auditId), {
    id: auditId,
    storeId: context.store.id,
    actorUserId: context.userId,
    actorRole: context.role,
    action: 'cash.session.opened',
    entityType: 'cashSession',
    entityId: local.canonicalId,
    reason: '',
    before: null,
    after: { status: 'open', openingAmount: local.initialCash },
    createdAt: serverTimestamp(),
  });
  await batch.commit();
};

const persistMovement = async (
  context: CashStoreContext,
  local: LocalCashMovement
): Promise<void> => {
  const reference = doc(
    db,
    `${getStoreCashMovementsCollectionPath(context.store.id, local.sessionId)}/${local.canonicalId}`
  );
  if ((await getDoc(reference)).exists()) return;

  const auditId = `audit-cash-movement-${local.canonicalId}`;
  const batch = writeBatch(db);
  batch.set(reference, {
    id: local.canonicalId,
    storeId: context.store.id,
    sessionId: local.sessionId,
    type: local.movementType,
    direction: local.direction,
    amount: local.amount,
    description: local.description,
    category: local.category,
    reason: local.reason,
    actorUserId: local.actorUserId,
    actorRole: local.actorRole,
    actorName: local.actorName,
    source: local.source,
    paymentId: local.paymentId,
    deviceId: local.deviceId,
    legacyStoreId: local.legacyStoreId,
    occurredAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  });
  batch.set(auditReference(context.store.id, auditId), {
    id: auditId,
    storeId: context.store.id,
    actorUserId: context.userId,
    actorRole: context.role,
    action: `cash.movement.${local.movementType}`,
    entityType: 'cashMovement',
    entityId: local.canonicalId,
    reason: local.reason,
    before: null,
    after: { direction: local.direction, amount: local.amount, sessionId: local.sessionId },
    createdAt: serverTimestamp(),
  });
  await batch.commit();
};

const persistSessionClose = async (
  context: CashStoreContext,
  local: LocalCashSession
): Promise<void> => {
  const reference = doc(db, getStoreCashSessionDocumentPath(context.store.id, local.canonicalId));
  const snapshot = await getDoc(reference);
  if (!snapshot.exists()) throw new Error('A sessão precisa ser sincronizada antes do fechamento.');
  if (snapshot.data()?.status === 'closed') return;

  const auditId = `audit-cash-close-${local.canonicalId}`;
  const batch = writeBatch(db);
  batch.update(reference, {
    status: 'closed',
    expectedAmount: local.expectedAmount,
    countedAmount: local.finalCash ?? 0,
    difference: local.difference,
    closedAt: serverTimestamp(),
    closedByUserId: local.closedByUserId,
    closedByRole: local.closedByRole,
    closedByName: local.closedByName,
    closeReason: local.closeReason,
    updatedAt: serverTimestamp(),
  });
  batch.set(auditReference(context.store.id, auditId), {
    id: auditId,
    storeId: context.store.id,
    actorUserId: context.userId,
    actorRole: context.role,
    action: 'cash.session.closed',
    entityType: 'cashSession',
    entityId: local.canonicalId,
    reason: local.closeReason,
    before: { status: 'open' },
    after: {
      status: 'closed',
      expectedAmount: local.expectedAmount,
      countedAmount: local.finalCash ?? 0,
      difference: local.difference,
    },
    createdAt: serverTimestamp(),
  });
  await batch.commit();
};

export const openCashSession = async (
  context: CashStoreContext,
  openingAmount: number
): Promise<string> => {
  if (!Number.isFinite(openingAmount) || openingAmount < 0) {
    throw new Error('Informe um valor inicial válido.');
  }

  const existingOpen = await cashDb.sessions
    .filter(session => session.storeId === context.store.id && session.status === 'open')
    .first();
  if (existingOpen) throw new Error('Já existe um caixa aberto nesta loja neste dispositivo.');

  const canonicalId = createRecordId('cash-session', context.userId);
  const local: LocalCashSession = {
    canonicalId,
    storeId: context.store.id,
    status: 'open',
    openedAt: new Date().toISOString(),
    initialCash: Number(openingAmount.toFixed(2)),
    expectedAmount: Number(openingAmount.toFixed(2)),
    difference: 0,
    operatorUserId: context.userId,
    operatorRole: context.role,
    operatorName: context.operatorName,
    closedByUserId: '',
    closedByRole: '',
    closedByName: '',
    closeReason: '',
    deviceId: getDeviceId(),
    legacyStoreId: context.legacyStoreId,
    createSynced: false,
    closeSynced: false,
  };
  const localId = await cashDb.sessions.add(local);

  try {
    await persistSessionOpen(context, local);
    await cashDb.sessions.update(localId, { createSynced: true });
  } catch (error) {
    throw new Error(
      `Caixa aberto no dispositivo, mas pendente no Firestore: ${error instanceof Error ? error.message : 'falha desconhecida'}`
    );
  }

  return canonicalId;
};

export interface AddCashMovementInput {
  sessionId: string;
  type: CashMovementType;
  amount: number;
  description: string;
  category: string;
  reason?: string;
  adjustmentDirection?: CashDirection;
}

export const addCashMovement = async (
  context: CashStoreContext,
  input: AddCashMovementInput
): Promise<string> => {
  const description = input.description.trim();
  const category = input.category.trim();
  const reason = input.reason?.trim() ?? '';
  if (!input.sessionId.trim()) throw new Error('Abra um caixa antes de lançar movimentações.');
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('Informe um valor maior que zero.');
  if (!description) throw new Error('Informe a descrição da movimentação.');
  if (!category) throw new Error('Informe a categoria da movimentação.');
  if (movementRequiresReason(input.type) && !reason) {
    throw new Error('Informe o motivo desta movimentação.');
  }

  const direction = getCashDirection(input.type, input.adjustmentDirection);
  const canonicalId = createRecordId('cash-movement', context.userId);
  const local: LocalCashMovement = {
    canonicalId,
    sessionId: input.sessionId.trim(),
    type: direction === 'in' ? 'entrada' : 'saida',
    movementType: input.type,
    direction,
    description,
    amount: Number(input.amount.toFixed(2)),
    category,
    reason,
    timestamp: new Date().toISOString(),
    actorUserId: context.userId,
    actorRole: context.role,
    actorName: context.operatorName,
    source: 'manual',
    paymentId: '',
    deviceId: getDeviceId(),
    legacyStoreId: context.legacyStoreId,
    synced: false,
  };
  const localId = await cashDb.movements.add(local);

  try {
    await persistMovement(context, local);
    await cashDb.movements.update(localId, { synced: true });
  } catch (error) {
    throw new Error(
      `Movimentação salva no dispositivo, mas pendente no Firestore: ${error instanceof Error ? error.message : 'falha desconhecida'}`
    );
  }

  return canonicalId;
};

export const closeCashSession = async (
  context: CashStoreContext,
  session: CanonicalCashSession,
  movements: CanonicalCashMovement[],
  countedAmount: number,
  closeReason: string
): Promise<void> => {
  if (!Number.isFinite(countedAmount) || countedAmount < 0) {
    throw new Error('Informe o valor contado no caixa.');
  }
  const expectedAmount = calculateExpectedCash(session.openingAmount, movements);
  const difference = calculateCashDifference(countedAmount, expectedAmount);
  const reason = closeReason.trim();
  if (difference !== 0 && !reason) {
    throw new Error('Informe o motivo da diferença encontrada no fechamento.');
  }

  let local = await cashDb.sessions
    .filter(candidate => candidate.canonicalId === session.id)
    .first();
  if (!local) {
    const id = await cashDb.sessions.add({
      canonicalId: session.id,
      storeId: context.store.id,
      status: 'open',
      openedAt: session.openedAt,
      initialCash: session.openingAmount,
      expectedAmount,
      difference,
      operatorUserId: session.operatorUserId,
      operatorRole: session.operatorRole,
      operatorName: session.operatorName,
      closedByUserId: '',
      closedByRole: '',
      closedByName: '',
      closeReason: '',
      deviceId: session.deviceId || getDeviceId(),
      legacyStoreId: context.legacyStoreId,
      createSynced: true,
      closeSynced: false,
    });
    local = await cashDb.sessions.get(id);
  }
  if (!local?.id) throw new Error('Não foi possível preparar o fechamento local.');

  const updates: Partial<LocalCashSession> = {
    status: 'closed',
    closedAt: new Date().toISOString(),
    finalCash: Number(countedAmount.toFixed(2)),
    expectedAmount,
    difference,
    closedByUserId: context.userId,
    closedByRole: context.role,
    closedByName: context.operatorName,
    closeReason: reason,
    closeSynced: false,
  };
  await cashDb.sessions.update(local.id, updates);
  const closedLocal = { ...local, ...updates } as LocalCashSession;

  try {
    await persistSessionClose(context, closedLocal);
    await cashDb.sessions.update(local.id, { closeSynced: true });
  } catch (error) {
    throw new Error(
      `Fechamento salvo no dispositivo, mas pendente no Firestore: ${error instanceof Error ? error.message : 'falha desconhecida'}`
    );
  }
};

export interface CashSyncStats {
  sessionsOpened: number;
  movements: number;
  sessionsClosed: number;
  pending: number;
}

export const syncPendingCashRecords = async (
  context: CashStoreContext
): Promise<CashSyncStats> => {
  const sessions = await cashDb.sessions
    .filter(session => session.storeId === context.store.id && Boolean(session.canonicalId))
    .toArray();
  const movements = await cashDb.movements
    .filter(movement => movement.legacyStoreId === context.legacyStoreId && Boolean(movement.canonicalId))
    .toArray();

  let sessionsOpened = 0;
  let movementsSynced = 0;
  let sessionsClosed = 0;

  for (const session of sessions.filter(candidate => !candidate.createSynced)) {
    await persistSessionOpen(context, session);
    if (session.id) await cashDb.sessions.update(session.id, { createSynced: true });
    sessionsOpened += 1;
  }

  for (const movement of movements.filter(candidate => !candidate.synced)) {
    await persistMovement(context, movement);
    if (movement.id) await cashDb.movements.update(movement.id, { synced: true });
    movementsSynced += 1;
  }

  for (const session of sessions.filter(
    candidate => candidate.status === 'closed' && !candidate.closeSynced
  )) {
    await persistSessionClose(context, { ...session, createSynced: true });
    if (session.id) await cashDb.sessions.update(session.id, { closeSynced: true });
    sessionsClosed += 1;
  }

  const pendingSessions = await cashDb.sessions
    .filter(
      session =>
        session.storeId === context.store.id &&
        (!session.createSynced || (session.status === 'closed' && !session.closeSynced))
    )
    .count();
  const pendingMovements = await cashDb.movements
    .filter(movement => movement.legacyStoreId === context.legacyStoreId && !movement.synced)
    .count();

  return {
    sessionsOpened,
    movements: movementsSynced,
    sessionsClosed,
    pending: pendingSessions + pendingMovements,
  };
};

export const getCashLocalPendingCount = async (
  context: CashStoreContext
): Promise<number> => {
  const sessions = await cashDb.sessions
    .filter(
      session =>
        session.storeId === context.store.id &&
        (!session.createSynced || (session.status === 'closed' && !session.closeSynced))
    )
    .count();
  const movements = await cashDb.movements
    .filter(movement => movement.legacyStoreId === context.legacyStoreId && !movement.synced)
    .count();
  return sessions + movements;
};

export const subscribeToCashSessions = (
  context: CashStoreContext,
  onSessions: (sessions: CanonicalCashSession[]) => void,
  onError?: (error: Error) => void
): Unsubscribe =>
  onSnapshot(
    query(
      collection(db, getStoreCashSessionsCollectionPath(context.store.id)),
      orderBy('createdAt', 'desc')
    ),
    snapshot => {
      onSessions(
        snapshot.docs.flatMap(document => {
          const parsed = parseCashSession(document.data());
          return parsed ? [parsed] : [];
        })
      );
    },
    error => onError?.(error)
  );

export const subscribeToCashMovements = (
  context: CashStoreContext,
  sessionId: string,
  onMovements: (movements: CanonicalCashMovement[]) => void,
  onError?: (error: Error) => void
): Unsubscribe =>
  onSnapshot(
    query(
      collection(db, getStoreCashMovementsCollectionPath(context.store.id, sessionId)),
      orderBy('createdAt', 'desc')
    ),
    snapshot => {
      onMovements(
        snapshot.docs.flatMap(document => {
          const parsed = parseCashMovement(document.data());
          return parsed ? [parsed] : [];
        })
      );
    },
    error => onError?.(error)
  );
