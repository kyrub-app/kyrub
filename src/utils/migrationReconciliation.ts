import Dexie, { type Table } from 'dexie';
import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  getCustomerOrdersCollectionPath,
  parseCustomerOrder,
  type CustomerOrder,
} from './customerOrders';
import {
  getLegacyTablePaymentsCollectionPath,
  parseLegacyTablePayment,
  resolveCanonicalStoreForLegacyTenant,
  type LegacyTablePaymentRecord,
} from './operationalDualWrite';
import {
  getCanonicalProductsCollectionPath,
} from './canonicalProductDualWrite';
import { parsePublicProducts, type PublicProduct } from './publicProducts';
import {
  getStoreCashMovementsCollectionPath,
  getStoreCashSessionsCollectionPath,
  getStoreOrdersCollectionPath,
  getStorePaymentsCollectionPath,
} from './storeSecurity';
import {
  parseCashMovement,
  parseCashSession,
  type CanonicalCashMovement,
  type CanonicalCashSession,
  type CashMovementType,
} from './canonicalCash';
import type { CanonicalStoreRecord } from './storeDirectory';

export type ReconciliationSectionKey = 'orders' | 'payments' | 'products' | 'cash';
export type ReconciliationStatus = 'matched' | 'divergent' | 'unavailable';
export type ReconciliationMetricFormat = 'number' | 'money';

export interface ReconciliationMetric {
  label: string;
  legacy: number;
  canonical: number;
  delta: number;
  format: ReconciliationMetricFormat;
  informational?: boolean;
}

export interface ReconciliationIssue {
  entityId: string;
  message: string;
}

export interface MigrationReconciliationSection {
  key: ReconciliationSectionKey;
  title: string;
  status: ReconciliationStatus;
  coverage: string;
  metrics: ReconciliationMetric[];
  issues: ReconciliationIssue[];
}

export interface MigrationReconciliationReport {
  store: CanonicalStoreRecord;
  legacyStoreId: string;
  checkedAt: string;
  readyForCanonicalRead: boolean;
  matchedSections: number;
  divergentSections: number;
  unavailableSections: number;
  sections: MigrationReconciliationSection[];
}

interface ComparableEntity {
  id: string;
  signature: string;
}

interface CanonicalPaymentRecord {
  id: string;
  tableCode: string;
  method: string;
  amount: number;
  quantity: number;
  items: LegacyTablePaymentRecord['items'];
}

interface CanonicalProductRecord {
  id: string;
  name: string;
  description: string;
  price: number;
  image: string;
  stock: number;
  category: string;
  isService: boolean;
  publicationStatus: string;
}

interface LocalCashSessionRecord {
  canonicalId?: string;
  storeId?: string;
  status?: 'open' | 'closed';
  initialCash?: number;
  expectedAmount?: number;
  finalCash?: number;
  difference?: number;
  createSynced?: boolean;
  closeSynced?: boolean;
}

interface LocalCashMovementRecord {
  canonicalId?: string;
  sessionId?: string;
  legacyStoreId?: string;
  movementType?: CashMovementType;
  direction?: 'in' | 'out';
  amount?: number;
  description?: string;
  category?: string;
  reason?: string;
  synced?: boolean;
}

interface LocalCashSnapshot {
  sessions: LocalCashSessionRecord[];
  movements: LocalCashMovementRecord[];
  unmappedSessions: number;
  unmappedMovements: number;
  pending: number;
}

class ReconciliationCashDB extends Dexie {
  sessions!: Table<LocalCashSessionRecord, number>;
  movements!: Table<LocalCashMovementRecord, number>;

  constructor() {
    super('DexieERPDB');
    this.version(1).stores({
      sessions: '++id, status, openedAt',
      movements: '++id, type, category, timestamp',
    });
  }
}

const cashDb = new ReconciliationCashDB();

const cleanString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const money = (value: number): number => Number(value.toFixed(2));

const stable = (value: unknown): string => JSON.stringify(value);

const sumMoney = (values: number[]): number =>
  money(values.reduce((total, value) => total + value, 0));

const entityMap = (records: ComparableEntity[]): Map<string, ComparableEntity> =>
  new Map(records.map(record => [record.id, record]));

const compareEntities = (
  legacy: ComparableEntity[],
  canonical: ComparableEntity[],
  options: { allowCanonicalExtras?: boolean } = {}
): ReconciliationIssue[] => {
  const legacyById = entityMap(legacy);
  const canonicalById = entityMap(canonical);
  const issues: ReconciliationIssue[] = [];

  legacyById.forEach((legacyRecord, id) => {
    const canonicalRecord = canonicalById.get(id);
    if (!canonicalRecord) {
      issues.push({ entityId: id, message: 'Existe no legado, mas não foi encontrado no caminho canônico.' });
      return;
    }
    if (legacyRecord.signature !== canonicalRecord.signature) {
      issues.push({ entityId: id, message: 'Os dados do legado e do caminho canônico são diferentes.' });
    }
  });

  if (!options.allowCanonicalExtras) {
    canonicalById.forEach((_canonicalRecord, id) => {
      if (!legacyById.has(id)) {
        issues.push({ entityId: id, message: 'Existe apenas no caminho canônico.' });
      }
    });
  }

  return issues;
};

const metric = (
  label: string,
  legacy: number,
  canonical: number,
  format: ReconciliationMetricFormat = 'number',
  informational = false
): ReconciliationMetric => ({
  label,
  legacy,
  canonical,
  delta: money(canonical - legacy),
  format,
  informational,
});

const section = (
  key: ReconciliationSectionKey,
  title: string,
  coverage: string,
  metrics: ReconciliationMetric[],
  issues: ReconciliationIssue[]
): MigrationReconciliationSection => ({
  key,
  title,
  coverage,
  metrics,
  issues,
  status: issues.length === 0 ? 'matched' : 'divergent',
});

const unavailableSection = (
  key: ReconciliationSectionKey,
  title: string,
  error: unknown
): MigrationReconciliationSection => ({
  key,
  title,
  coverage: 'A conferência desta área não pôde ser concluída.',
  metrics: [],
  issues: [{
    entityId: '',
    message: error instanceof Error ? error.message : 'Falha desconhecida durante a conferência.',
  }],
  status: 'unavailable',
});

const orderSignature = (order: CustomerOrder): string =>
  stable({
    buyerId: order.buyerId,
    fulfillmentType: order.fulfillmentType,
    tableCode: order.tableCode,
    subtotal: money(order.subtotal),
    total: money(order.total),
    status: order.status,
    paymentStatus: order.paymentStatus,
    source: order.source,
    items: order.items.map(item => ({
      lineId: item.lineId,
      productId: item.productId,
      price: money(item.price),
      quantity: item.quantity,
      paidQuantity: item.paidQuantity,
      transferredQuantity: item.transferredQuantity,
      note: item.note,
    })),
  });

export const reconcileOrders = (
  legacyOrders: CustomerOrder[],
  canonicalOrders: CustomerOrder[]
): MigrationReconciliationSection => {
  const issues = compareEntities(
    legacyOrders.map(order => ({ id: order.id, signature: orderSignature(order) })),
    canonicalOrders.map(order => ({ id: order.id, signature: orderSignature(order) }))
  );

  return section(
    'orders',
    'Pedidos',
    'Compara IDs, valores, status, pagamento e itens de cada pedido.',
    [
      metric('Registros', legacyOrders.length, canonicalOrders.length),
      metric(
        'Valor total',
        sumMoney(legacyOrders.map(order => order.total)),
        sumMoney(canonicalOrders.map(order => order.total)),
        'money'
      ),
    ],
    issues
  );
};

const paymentSignature = (
  payment: Pick<LegacyTablePaymentRecord, 'tableCode' | 'method' | 'amount' | 'quantity' | 'items'>
): string =>
  stable({
    tableCode: payment.tableCode,
    method: payment.method,
    amount: money(payment.amount),
    quantity: payment.quantity,
    items: payment.items.map(item => ({
      orderId: item.orderId,
      lineId: item.lineId,
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: money(item.unitPrice),
      total: money(item.total),
    })),
  });

export const reconcilePayments = (
  legacyPayments: LegacyTablePaymentRecord[],
  canonicalPayments: CanonicalPaymentRecord[]
): MigrationReconciliationSection => {
  const issues = compareEntities(
    legacyPayments.map(payment => ({ id: payment.id, signature: paymentSignature(payment) })),
    canonicalPayments.map(payment => ({ id: payment.id, signature: paymentSignature(payment) }))
  );

  return section(
    'payments',
    'Pagamentos',
    'Compara IDs, métodos, mesas, itens e valores recebidos.',
    [
      metric('Registros', legacyPayments.length, canonicalPayments.length),
      metric(
        'Valor recebido',
        sumMoney(legacyPayments.map(payment => payment.amount)),
        sumMoney(canonicalPayments.map(payment => payment.amount)),
        'money'
      ),
    ],
    issues
  );
};

const legacyProductSignature = (product: PublicProduct): string =>
  stable({
    name: product.name,
    description: product.description,
    price: money(product.price),
    image: product.image,
    stock: product.isService ? 0 : product.stock,
    category: product.category,
    isService: product.isService === true,
    publicationStatus: 'published',
  });

const canonicalProductSignature = (product: CanonicalProductRecord): string =>
  stable({
    name: product.name,
    description: product.description,
    price: money(product.price),
    image: product.image,
    stock: product.isService ? 0 : product.stock,
    category: product.category,
    isService: product.isService,
    publicationStatus: product.publicationStatus,
  });

export const reconcileProducts = (
  legacyProducts: PublicProduct[],
  canonicalProducts: CanonicalProductRecord[]
): MigrationReconciliationSection => {
  const activeCanonical = canonicalProducts.filter(
    product => product.publicationStatus !== 'archived'
  );
  const archivedCanonical = canonicalProducts.filter(
    product => product.publicationStatus === 'archived'
  );
  const issues = compareEntities(
    legacyProducts.map(product => ({ id: product.id, signature: legacyProductSignature(product) })),
    activeCanonical.map(product => ({ id: product.id, signature: canonicalProductSignature(product) }))
  );

  return section(
    'products',
    'Produtos e serviços',
    'Compara o catálogo ativo. Itens arquivados são mantidos como histórico.',
    [
      metric('Itens ativos', legacyProducts.length, activeCanonical.length),
      metric('Itens arquivados', 0, archivedCanonical.length, 'number', true),
      metric(
        'Valor de estoque',
        sumMoney(legacyProducts.map(product => product.isService ? 0 : product.price * product.stock)),
        sumMoney(activeCanonical.map(product => product.isService ? 0 : product.price * product.stock)),
        'money'
      ),
    ],
    issues
  );
};

const localSessionSignature = (session: LocalCashSessionRecord): string =>
  stable({
    status: session.status ?? '',
    openingAmount: money(session.initialCash ?? 0),
    expectedAmount: money(session.expectedAmount ?? session.initialCash ?? 0),
    countedAmount: money(session.finalCash ?? 0),
    difference: money(session.difference ?? 0),
  });

const canonicalSessionSignature = (session: CanonicalCashSession): string =>
  stable({
    status: session.status,
    openingAmount: money(session.openingAmount),
    expectedAmount: money(session.expectedAmount),
    countedAmount: money(session.countedAmount),
    difference: money(session.difference),
  });

const localMovementSignature = (movement: LocalCashMovementRecord): string =>
  stable({
    sessionId: movement.sessionId ?? '',
    type: movement.movementType ?? '',
    direction: movement.direction ?? '',
    amount: money(movement.amount ?? 0),
    description: movement.description?.trim() ?? '',
    category: movement.category?.trim() ?? '',
    reason: movement.reason?.trim() ?? '',
  });

const canonicalMovementSignature = (movement: CanonicalCashMovement): string =>
  stable({
    sessionId: movement.sessionId,
    type: movement.type,
    direction: movement.direction,
    amount: money(movement.amount),
    description: movement.description,
    category: movement.category,
    reason: movement.reason,
  });

export const reconcileCash = (
  local: LocalCashSnapshot,
  canonicalSessions: CanonicalCashSession[],
  canonicalMovements: CanonicalCashMovement[]
): MigrationReconciliationSection => {
  const localSessions = local.sessions.flatMap(session =>
    session.canonicalId
      ? [{ id: session.canonicalId, signature: localSessionSignature(session) }]
      : []
  );
  const localMovements = local.movements.flatMap(movement =>
    movement.canonicalId
      ? [{ id: movement.canonicalId, signature: localMovementSignature(movement) }]
      : []
  );
  const issues = [
    ...compareEntities(
      localSessions,
      canonicalSessions.map(session => ({ id: session.id, signature: canonicalSessionSignature(session) })),
      { allowCanonicalExtras: true }
    ),
    ...compareEntities(
      localMovements,
      canonicalMovements.map(movement => ({ id: movement.id, signature: canonicalMovementSignature(movement) })),
      { allowCanonicalExtras: true }
    ),
  ];

  if (local.pending > 0) {
    issues.push({ entityId: '', message: `${local.pending} registro(s) do caixa ainda aguardam sincronização.` });
  }
  if (local.unmappedSessions > 0 || local.unmappedMovements > 0) {
    issues.push({
      entityId: '',
      message: `${local.unmappedSessions} sessão(ões) e ${local.unmappedMovements} movimentação(ões) antigas não possuem ID canônico.`,
    });
  }

  return section(
    'cash',
    'Caixa',
    'Compara o Dexie deste dispositivo com o Firestore. Registros de outros dispositivos são cobertura adicional.',
    [
      metric('Sessões deste dispositivo', localSessions.length, canonicalSessions.length, 'number', true),
      metric('Movimentações deste dispositivo', localMovements.length, canonicalMovements.length, 'number', true),
      metric(
        'Entradas mapeadas',
        sumMoney(local.movements.filter(item => item.canonicalId && item.direction === 'in').map(item => item.amount ?? 0)),
        sumMoney(canonicalMovements.filter(item => item.direction === 'in').map(item => item.amount)),
        'money',
        true
      ),
      metric(
        'Saídas mapeadas',
        sumMoney(local.movements.filter(item => item.canonicalId && item.direction === 'out').map(item => item.amount ?? 0)),
        sumMoney(canonicalMovements.filter(item => item.direction === 'out').map(item => item.amount)),
        'money',
        true
      ),
    ],
    issues
  );
};

const parseCanonicalPayment = (
  snapshot: QueryDocumentSnapshot<DocumentData>
): CanonicalPaymentRecord | null => {
  const value = snapshot.data() as Record<string, unknown>;
  const id = cleanString(value.id) || snapshot.id;
  const amount = finiteNumber(value.amount);
  const quantity = finiteNumber(value.quantity);
  if (!id || amount === null || quantity === null || !Array.isArray(value.items)) return null;

  const legacyShape = parseLegacyTablePayment({
    id,
    storeId: cleanString(value.legacyStoreId),
    tableCode: cleanString(value.tableCode),
    method: value.method,
    amount,
    quantity,
    items: value.items,
    operatorId: cleanString(value.actorUserId) || 'canonical-actor',
    operatorName: cleanString(value.actorName),
    createdAt: cleanString(value.legacyCreatedAt),
  }, id);

  return legacyShape
    ? {
        id,
        tableCode: legacyShape.tableCode,
        method: legacyShape.method,
        amount: legacyShape.amount,
        quantity: legacyShape.quantity,
        items: legacyShape.items,
      }
    : null;
};

const parseCanonicalProduct = (
  snapshot: QueryDocumentSnapshot<DocumentData>
): CanonicalProductRecord | null => {
  const value = snapshot.data() as Record<string, unknown>;
  const id = cleanString(value.id) || snapshot.id;
  const price = finiteNumber(value.price);
  const stock = finiteNumber(value.stock);
  if (!id || price === null || stock === null) return null;
  return {
    id,
    name: cleanString(value.name),
    description: cleanString(value.description),
    price,
    image: cleanString(value.image),
    stock,
    category: cleanString(value.category),
    isService: value.isService === true,
    publicationStatus: cleanString(value.publicationStatus),
  };
};

const loadLocalCashSnapshot = async (
  storeId: string,
  legacyStoreId: string
): Promise<LocalCashSnapshot> => {
  const allSessions = await cashDb.sessions.toArray();
  const allMovements = await cashDb.movements.toArray();
  const sessions = allSessions.filter(session => session.storeId === storeId);
  const movements = allMovements.filter(
    movement => movement.legacyStoreId === legacyStoreId
  );

  return {
    sessions,
    movements,
    unmappedSessions: allSessions.filter(
      session => !session.canonicalId && (!session.storeId || session.storeId === storeId)
    ).length,
    unmappedMovements: allMovements.filter(
      movement => !movement.canonicalId && (!movement.legacyStoreId || movement.legacyStoreId === legacyStoreId)
    ).length,
    pending:
      sessions.filter(session =>
        session.createSynced === false ||
        (session.status === 'closed' && session.closeSynced === false)
      ).length + movements.filter(movement => movement.synced === false).length,
  };
};

const loadOrdersSection = async (
  store: CanonicalStoreRecord,
  legacyStoreId: string
): Promise<MigrationReconciliationSection> => {
  const [legacySnapshot, canonicalSnapshot] = await Promise.all([
    getDocs(collection(db, getCustomerOrdersCollectionPath(legacyStoreId))),
    getDocs(collection(db, getStoreOrdersCollectionPath(store.id))),
  ]);
  const legacyOrders = legacySnapshot.docs.flatMap(document => {
    const parsed = parseCustomerOrder(document.data());
    return parsed ? [parsed] : [];
  });
  const canonicalOrders = canonicalSnapshot.docs.flatMap(document => {
    const parsed = parseCustomerOrder(document.data());
    return parsed ? [parsed] : [];
  });
  return reconcileOrders(legacyOrders, canonicalOrders);
};

const loadPaymentsSection = async (
  store: CanonicalStoreRecord,
  legacyStoreId: string
): Promise<MigrationReconciliationSection> => {
  const [legacySnapshot, canonicalSnapshot] = await Promise.all([
    getDocs(collection(db, getLegacyTablePaymentsCollectionPath(legacyStoreId))),
    getDocs(collection(db, getStorePaymentsCollectionPath(store.id))),
  ]);
  const legacyPayments = legacySnapshot.docs.flatMap(document => {
    const parsed = parseLegacyTablePayment(document.data(), document.id);
    return parsed ? [parsed] : [];
  });
  const canonicalPayments = canonicalSnapshot.docs.flatMap(document => {
    const parsed = parseCanonicalPayment(document);
    return parsed ? [parsed] : [];
  });
  return reconcilePayments(legacyPayments, canonicalPayments);
};

const loadProductsSection = async (
  store: CanonicalStoreRecord,
  legacyStoreId: string
): Promise<MigrationReconciliationSection> => {
  const [tenantSnapshot, canonicalSnapshot] = await Promise.all([
    getDoc(doc(db, 'tenants', legacyStoreId)),
    getDocs(collection(db, getCanonicalProductsCollectionPath(store.id))),
  ]);
  const legacyProducts = parsePublicProducts(tenantSnapshot.data()?.publicProducts);
  const canonicalProducts = canonicalSnapshot.docs.flatMap(document => {
    const parsed = parseCanonicalProduct(document);
    return parsed ? [parsed] : [];
  });
  return reconcileProducts(legacyProducts, canonicalProducts);
};

const loadCashSection = async (
  store: CanonicalStoreRecord,
  legacyStoreId: string
): Promise<MigrationReconciliationSection> => {
  const [local, sessionsSnapshot] = await Promise.all([
    loadLocalCashSnapshot(store.id, legacyStoreId),
    getDocs(collection(db, getStoreCashSessionsCollectionPath(store.id))),
  ]);
  const canonicalSessions = sessionsSnapshot.docs.flatMap(document => {
    const parsed = parseCashSession(document.data());
    return parsed ? [parsed] : [];
  });
  const movementSnapshots = await Promise.all(
    canonicalSessions.map(session =>
      getDocs(collection(db, getStoreCashMovementsCollectionPath(store.id, session.id)))
    )
  );
  const canonicalMovements = movementSnapshots.flatMap(snapshot =>
    snapshot.docs.flatMap(document => {
      const parsed = parseCashMovement(document.data());
      return parsed ? [parsed] : [];
    })
  );
  return reconcileCash(local, canonicalSessions, canonicalMovements);
};

export const runMigrationReconciliation = async (
  user: Pick<User, 'uid'>,
  legacyStoreId: string
): Promise<MigrationReconciliationReport> => {
  const normalizedLegacyStoreId = legacyStoreId.trim();
  if (!normalizedLegacyStoreId || user.uid !== normalizedLegacyStoreId) {
    throw new Error('Somente o proprietário da loja antiga pode executar esta conferência.');
  }

  const store = await resolveCanonicalStoreForLegacyTenant(user, normalizedLegacyStoreId);
  if (!store) throw new Error('Registre a loja canônica antes de executar a conferência.');
  if (store.ownerId !== user.uid) throw new Error('A loja canônica não pertence ao usuário autenticado.');

  const loaders: Array<{
    key: ReconciliationSectionKey;
    title: string;
    run: () => Promise<MigrationReconciliationSection>;
  }> = [
    { key: 'orders', title: 'Pedidos', run: () => loadOrdersSection(store, normalizedLegacyStoreId) },
    { key: 'payments', title: 'Pagamentos', run: () => loadPaymentsSection(store, normalizedLegacyStoreId) },
    { key: 'products', title: 'Produtos e serviços', run: () => loadProductsSection(store, normalizedLegacyStoreId) },
    { key: 'cash', title: 'Caixa', run: () => loadCashSection(store, normalizedLegacyStoreId) },
  ];

  const sections = await Promise.all(
    loaders.map(async loader => {
      try {
        return await loader.run();
      } catch (error) {
        return unavailableSection(loader.key, loader.title, error);
      }
    })
  );
  const matchedSections = sections.filter(item => item.status === 'matched').length;
  const divergentSections = sections.filter(item => item.status === 'divergent').length;
  const unavailableSections = sections.filter(item => item.status === 'unavailable').length;

  return {
    store,
    legacyStoreId: normalizedLegacyStoreId,
    checkedAt: new Date().toISOString(),
    readyForCanonicalRead: matchedSections === sections.length,
    matchedSections,
    divergentSections,
    unavailableSections,
    sections,
  };
};
