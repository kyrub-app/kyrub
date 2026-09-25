import { adminDb } from '../firebaseAdmin.js';

export type StoreCashFinanceMovementType =
  | 'sale'
  | 'income'
  | 'expense'
  | 'supply'
  | 'withdrawal'
  | 'adjustment';

export type StoreCashFinanceDirection = 'in' | 'out';
export type StoreCashFinanceSource = 'manual' | 'payment' | 'migration';

export interface StoreCashFinanceMovement {
  id: string;
  sessionId: string;
  type: StoreCashFinanceMovementType;
  direction: StoreCashFinanceDirection;
  amountMinor: number;
  description: string;
  category: string;
  reason: string;
  actorName: string;
  source: StoreCashFinanceSource;
  paymentId: string;
  occurredAt: string;
}

export interface StoreCashFinanceSession {
  id: string;
  status: 'open' | 'closed';
  operatorName: string;
  openingMinor: number;
  expectedMinor: number;
  countedMinor: number;
  differenceMinor: number;
  openedAt: string;
  closedAt: string;
}

export interface StoreCashFinanceSummary {
  currency: 'BRL';
  incomeMinor: number;
  expenseMinor: number;
  supplyMinor: number;
  withdrawalMinor: number;
  saleMinor: number;
  adjustmentInMinor: number;
  adjustmentOutMinor: number;
  operationalNetMinor: number;
  movementNetMinor: number;
  differenceMinor: number;
  movementCount: number;
  sessionCount: number;
  openSessionCount: number;
  closedSessionCount: number;
}

export interface StoreCashFinanceProjection {
  available: boolean;
  reason:
    | ''
    | 'cash_store_not_registered'
    | 'cash_store_ambiguous'
    | 'cash_projection_unavailable';
  canonicalStoreId: string;
  summary: StoreCashFinanceSummary;
  latestSession: StoreCashFinanceSession | null;
  movements: StoreCashFinanceMovement[];
}

const emptySummary = (): StoreCashFinanceSummary => ({
  currency: 'BRL',
  incomeMinor: 0,
  expenseMinor: 0,
  supplyMinor: 0,
  withdrawalMinor: 0,
  saleMinor: 0,
  adjustmentInMinor: 0,
  adjustmentOutMinor: 0,
  operationalNetMinor: 0,
  movementNetMinor: 0,
  differenceMinor: 0,
  movementCount: 0,
  sessionCount: 0,
  openSessionCount: 0,
  closedSessionCount: 0,
});

const unavailableProjection = (
  reason: StoreCashFinanceProjection['reason']
): StoreCashFinanceProjection => ({
  available: false,
  reason,
  canonicalStoreId: '',
  summary: emptySummary(),
  latestSession: null,
  movements: [],
});

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const timestampToIso = (value: unknown): string => {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return value;
  if (
    value
    && typeof value === 'object'
    && 'toDate' in value
    && typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isFinite(date.getTime()) ? date.toISOString() : '';
  }
  return '';
};

const currencyToMinor = (value: unknown, allowNegative = false): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (!allowNegative && value < 0) return null;
  const minor = Math.round(value * 100);
  return Number.isSafeInteger(minor) ? minor : null;
};

const isMovementType = (value: unknown): value is StoreCashFinanceMovementType =>
  value === 'sale'
  || value === 'income'
  || value === 'expense'
  || value === 'supply'
  || value === 'withdrawal'
  || value === 'adjustment';

const isDirection = (value: unknown): value is StoreCashFinanceDirection =>
  value === 'in' || value === 'out';

const isSource = (value: unknown): value is StoreCashFinanceSource =>
  value === 'manual' || value === 'payment' || value === 'migration';

const parseSession = (
  canonicalStoreId: string,
  documentId: string,
  value: unknown
): StoreCashFinanceSession | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const status = source.status;
  const openingMinor = currencyToMinor(source.openingAmount);
  const expectedMinor = currencyToMinor(source.expectedAmount, true);
  const countedMinor = currencyToMinor(source.countedAmount);
  const differenceMinor = currencyToMinor(source.difference, true);
  const openedAt = timestampToIso(source.openedAt);
  const closedAt = timestampToIso(source.closedAt);

  if (
    clean(source.id) !== documentId
    || clean(source.storeId) !== canonicalStoreId
    || (status !== 'open' && status !== 'closed')
    || openingMinor === null
    || expectedMinor === null
    || countedMinor === null
    || differenceMinor === null
    || !openedAt
  ) {
    return null;
  }
  if (status === 'closed' && !closedAt) return null;

  return {
    id: documentId,
    status,
    operatorName: clean(source.operatorName),
    openingMinor,
    expectedMinor,
    countedMinor,
    differenceMinor,
    openedAt,
    closedAt,
  };
};

const parseMovement = (
  canonicalStoreId: string,
  sessionId: string,
  documentId: string,
  value: unknown
): StoreCashFinanceMovement | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const amountMinor = currencyToMinor(source.amount);
  const occurredAt = timestampToIso(source.occurredAt) || timestampToIso(source.createdAt);

  if (
    clean(source.id) !== documentId
    || clean(source.storeId) !== canonicalStoreId
    || clean(source.sessionId) !== sessionId
    || !isMovementType(source.type)
    || !isDirection(source.direction)
    || amountMinor === null
    || amountMinor <= 0
    || !occurredAt
  ) {
    return null;
  }

  return {
    id: documentId,
    sessionId,
    type: source.type,
    direction: source.direction,
    amountMinor,
    description: clean(source.description),
    category: clean(source.category),
    reason: clean(source.reason),
    actorName: clean(source.actorName),
    source: isSource(source.source) ? source.source : 'manual',
    paymentId: clean(source.paymentId),
    occurredAt,
  };
};

const resolveCanonicalCashStoreId = async (input: {
  financeStoreId: string;
  ownerId: string;
}): Promise<{ storeId: string; reason: StoreCashFinanceProjection['reason'] }> => {
  const snapshot = await adminDb
    .collection('stores')
    .where('ownerId', '==', input.ownerId)
    .limit(25)
    .get();

  const matches = snapshot.docs.filter(document => {
    const data = document.data() as Record<string, unknown>;
    return clean(data.id) === document.id
      && clean(data.ownerId) === input.ownerId
      && clean(data.legacyTenantId) === input.financeStoreId;
  });

  if (matches.length === 0) {
    return { storeId: '', reason: 'cash_store_not_registered' };
  }
  if (matches.length > 1) {
    console.warn('[Store finance] Ambiguous canonical cash store.', {
      financeStoreId: input.financeStoreId,
      ownerId: input.ownerId,
      matches: matches.map(match => match.id),
    });
    return { storeId: '', reason: 'cash_store_ambiguous' };
  }
  return { storeId: matches[0].id, reason: '' };
};

const listMovementsForSession = async (
  canonicalStoreId: string,
  sessionId: string
): Promise<StoreCashFinanceMovement[]> => {
  const collection = adminDb
    .collection(`stores/${canonicalStoreId}/cashSessions/${sessionId}/movements`);

  let snapshot;
  try {
    snapshot = await collection.orderBy('occurredAt', 'desc').limit(50).get();
  } catch (error) {
    console.warn('[Store finance] Falling back to unordered cash movement read.', {
      canonicalStoreId,
      sessionId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    snapshot = await collection.limit(50).get();
  }

  return snapshot.docs.flatMap(document => {
    const movement = parseMovement(
      canonicalStoreId,
      sessionId,
      document.id,
      document.data()
    );
    if (movement) return [movement];
    console.warn('[Store finance] Invalid canonical cash movement skipped.', {
      canonicalStoreId,
      sessionId,
      movementId: document.id,
    });
    return [];
  });
};

export const listStoreCashFinanceProjection = async (input: {
  financeStoreId: string;
  ownerId: string;
}): Promise<StoreCashFinanceProjection> => {
  try {
    const resolved = await resolveCanonicalCashStoreId(input);
    if (!resolved.storeId) return unavailableProjection(resolved.reason);

    const canonicalStoreId = resolved.storeId;
    let sessionSnapshot;
    const sessionsCollection = adminDb.collection(`stores/${canonicalStoreId}/cashSessions`);
    try {
      sessionSnapshot = await sessionsCollection.orderBy('openedAt', 'desc').limit(12).get();
    } catch (error) {
      console.warn('[Store finance] Falling back to unordered cash session read.', {
        canonicalStoreId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      sessionSnapshot = await sessionsCollection.limit(12).get();
    }

    const sessions = sessionSnapshot.docs.flatMap(document => {
      const session = parseSession(canonicalStoreId, document.id, document.data());
      if (session) return [session];
      console.warn('[Store finance] Invalid canonical cash session skipped.', {
        canonicalStoreId,
        sessionId: document.id,
      });
      return [];
    }).sort((left, right) => Date.parse(right.openedAt) - Date.parse(left.openedAt));

    const movementGroups = await Promise.all(
      sessions.map(session => listMovementsForSession(canonicalStoreId, session.id))
    );
    const movements = movementGroups
      .flat()
      .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
      .slice(0, 100);

    const sumType = (type: StoreCashFinanceMovementType): number =>
      movements
        .filter(movement => movement.type === type)
        .reduce((total, movement) => total + movement.amountMinor, 0);
    const adjustmentInMinor = movements
      .filter(movement => movement.type === 'adjustment' && movement.direction === 'in')
      .reduce((total, movement) => total + movement.amountMinor, 0);
    const adjustmentOutMinor = movements
      .filter(movement => movement.type === 'adjustment' && movement.direction === 'out')
      .reduce((total, movement) => total + movement.amountMinor, 0);
    const incomeMinor = sumType('income');
    const expenseMinor = sumType('expense');
    const movementNetMinor = movements.reduce(
      (total, movement) => total + (movement.direction === 'in' ? movement.amountMinor : -movement.amountMinor),
      0
    );
    const differenceMinor = sessions
      .filter(session => session.status === 'closed')
      .reduce((total, session) => total + session.differenceMinor, 0);

    return {
      available: true,
      reason: '',
      canonicalStoreId,
      summary: {
        currency: 'BRL',
        incomeMinor,
        expenseMinor,
        supplyMinor: sumType('supply'),
        withdrawalMinor: sumType('withdrawal'),
        saleMinor: sumType('sale'),
        adjustmentInMinor,
        adjustmentOutMinor,
        operationalNetMinor: incomeMinor - expenseMinor,
        movementNetMinor,
        differenceMinor,
        movementCount: movements.length,
        sessionCount: sessions.length,
        openSessionCount: sessions.filter(session => session.status === 'open').length,
        closedSessionCount: sessions.filter(session => session.status === 'closed').length,
      },
      latestSession: sessions[0] ?? null,
      movements,
    };
  } catch (error) {
    console.warn('[Store finance] Canonical cash projection unavailable.', {
      financeStoreId: input.financeStoreId,
      ownerId: input.ownerId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return unavailableProjection('cash_projection_unavailable');
  }
};
