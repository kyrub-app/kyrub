import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  getCustomerOrdersCollectionPath,
  parseCustomerOrder,
  type CustomerOrder,
} from './customerOrders';
import {
  getStoreDocumentPath,
  getStoreOrderDocumentPath,
  getStorePaymentsCollectionPath,
  type OrderActorRole,
  type StoreRole,
} from './storeSecurity';
import {
  parseCanonicalStore,
  type CanonicalStoreRecord,
} from './storeDirectory';

export type OperationalMirrorKind = 'order' | 'payment';

export interface LegacyTablePaymentRecord {
  id: string;
  legacyStoreId: string;
  tableCode: string;
  method: 'cash' | 'pix' | 'card' | 'other';
  amount: number;
  quantity: number;
  items: Array<{
    orderId: string;
    lineId: string;
    productId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
  operatorId: string;
  operatorName: string;
  createdAt: string;
}

export interface CanonicalOrderMirrorData
  extends Omit<CustomerOrder, 'storeId' | 'createdAt' | 'updatedAt'> {
  storeId: string;
  createdByUserId: string;
  createdByRole: OrderActorRole;
  legacyStoreId: string;
  legacyCreatedAt: string;
  legacyUpdatedAt: string;
  migratedFromPath: string;
  migration: {
    mode: 'dual_write';
    migratedByUserId: string;
    migratedByRole: StoreRole;
  };
}

export interface CanonicalPaymentMirrorData {
  id: string;
  storeId: string;
  legacyStoreId: string;
  tableCode: string;
  method: LegacyTablePaymentRecord['method'];
  amount: number;
  quantity: number;
  items: LegacyTablePaymentRecord['items'];
  actorUserId: string;
  actorRole: StoreRole;
  actorName: string;
  legacyCreatedAt: string;
  migratedFromPath: string;
  migration: {
    mode: 'dual_write';
    migratedByUserId: string;
    migratedByRole: StoreRole;
  };
}

export interface OperationalDualWriteCallbacks {
  onReady?: (store: CanonicalStoreRecord) => void;
  onMirrored?: (kind: OperationalMirrorKind, id: string) => void;
  onError?: (error: Error) => void;
  onUnavailable?: () => void;
}

const cleanString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const isPaymentMethod = (
  value: unknown
): value is LegacyTablePaymentRecord['method'] =>
  value === 'cash' || value === 'pix' || value === 'card' || value === 'other';

const parsePaymentItem = (
  value: unknown
): LegacyTablePaymentRecord['items'][number] | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const orderId = cleanString(candidate.orderId);
  const lineId = cleanString(candidate.lineId);
  const productId = cleanString(candidate.productId);
  const name = cleanString(candidate.name);
  const quantity = finiteNumber(candidate.quantity);
  const unitPrice = finiteNumber(candidate.unitPrice);
  const total = finiteNumber(candidate.total);

  if (
    !orderId ||
    !lineId ||
    !productId ||
    !name ||
    quantity === null ||
    !Number.isInteger(quantity) ||
    quantity <= 0 ||
    unitPrice === null ||
    unitPrice < 0 ||
    total === null ||
    total < 0
  ) {
    return null;
  }

  return {
    orderId,
    lineId,
    productId,
    name,
    quantity,
    unitPrice,
    total,
  };
};

export const getLegacyTablePaymentsCollectionPath = (
  legacyStoreId: string
): string => `artifacts/${legacyStoreId.trim()}/public/data/tablePayments`;

export const parseLegacyTablePayment = (
  value: unknown,
  documentId = ''
): LegacyTablePaymentRecord | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const id = cleanString(candidate.id) || documentId.trim();
  const legacyStoreId = cleanString(candidate.storeId);
  const tableCode = cleanString(candidate.tableCode);
  const amount = finiteNumber(candidate.amount);
  const quantity = finiteNumber(candidate.quantity);
  const operatorId = cleanString(candidate.operatorId);
  const operatorName = cleanString(candidate.operatorName);
  const createdAt = cleanString(candidate.createdAt);

  if (
    !id ||
    !legacyStoreId ||
    !tableCode ||
    !isPaymentMethod(candidate.method) ||
    amount === null ||
    amount < 0 ||
    quantity === null ||
    !Number.isInteger(quantity) ||
    quantity <= 0 ||
    !operatorId ||
    !Array.isArray(candidate.items)
  ) {
    return null;
  }

  const items = candidate.items.flatMap(item => {
    const parsed = parsePaymentItem(item);
    return parsed ? [parsed] : [];
  });

  if (items.length !== candidate.items.length || items.length === 0) return null;

  return {
    id,
    legacyStoreId,
    tableCode,
    method: candidate.method,
    amount,
    quantity,
    items,
    operatorId,
    operatorName,
    createdAt,
  };
};

export const selectCanonicalStoreForLegacyTenant = (
  stores: CanonicalStoreRecord[],
  ownerId: string,
  legacyStoreId: string
): CanonicalStoreRecord | null => {
  const matches = stores.filter(
    store =>
      store.ownerId === ownerId.trim() &&
      store.legacyTenantId === legacyStoreId.trim()
  );

  if (matches.length > 1) {
    throw new Error(
      'Mais de uma loja canônica aponta para a mesma loja antiga. Revise o cadastro antes de migrar.'
    );
  }

  return matches[0] ?? null;
};

export const resolveCanonicalStoreForLegacyTenant = async (
  user: Pick<User, 'uid'>,
  legacyStoreId: string
): Promise<CanonicalStoreRecord | null> => {
  const ownerStoresQuery = query(
    collection(db, 'stores'),
    where('ownerId', '==', user.uid)
  );
  const snapshot = await getDocs(ownerStoresQuery);
  const stores = snapshot.docs.flatMap(storeSnapshot => {
    const parsed = parseCanonicalStore(storeSnapshot.data());
    return parsed ? [parsed] : [];
  });

  return selectCanonicalStoreForLegacyTenant(stores, user.uid, legacyStoreId);
};

export const activateOperationalDualWrite = async (
  user: Pick<User, 'uid'>,
  store: CanonicalStoreRecord
): Promise<CanonicalStoreRecord> => {
  if (store.ownerId !== user.uid) {
    throw new Error('Somente o proprietário pode ativar a migração operacional.');
  }
  if (store.migrationStatus === 'canonical') return store;
  if (store.migrationStatus === 'dual_write') return store;

  await updateDoc(doc(db, getStoreDocumentPath(store.id)), {
    migrationStatus: 'dual_write',
    updatedAt: serverTimestamp(),
  });

  return { ...store, migrationStatus: 'dual_write' };
};

const resolveOrderActor = (
  order: CustomerOrder,
  migratedByUserId: string,
  migratedByRole: StoreRole
): { createdByUserId: string; createdByRole: OrderActorRole } => {
  if (order.source === 'customer') {
    return {
      createdByUserId: order.buyerId,
      createdByRole: 'customer',
    };
  }

  return {
    createdByUserId: order.operatorId || migratedByUserId,
    createdByRole: migratedByRole,
  };
};

export const buildCanonicalOrderMirrorData = (
  order: CustomerOrder,
  canonicalStoreId: string,
  migratedByUserId: string,
  migratedByRole: StoreRole = 'owner'
): CanonicalOrderMirrorData => {
  const storeId = canonicalStoreId.trim();
  if (!storeId) throw new Error('A loja canônica não foi identificada.');
  if (storeId === order.storeId) {
    throw new Error('O espelhamento exige um storeId independente do caminho legado.');
  }

  const { createdAt, updatedAt, storeId: legacyStoreId, ...orderData } = order;

  return {
    ...orderData,
    storeId,
    ...resolveOrderActor(order, migratedByUserId, migratedByRole),
    legacyStoreId,
    legacyCreatedAt: createdAt,
    legacyUpdatedAt: updatedAt,
    migratedFromPath: `${getCustomerOrdersCollectionPath(legacyStoreId)}/${order.id}`,
    migration: {
      mode: 'dual_write',
      migratedByUserId,
      migratedByRole,
    },
  };
};

export const buildCanonicalPaymentMirrorData = (
  payment: LegacyTablePaymentRecord,
  canonicalStoreId: string,
  migratedByUserId: string,
  migratedByRole: StoreRole = 'owner'
): CanonicalPaymentMirrorData => {
  const storeId = canonicalStoreId.trim();
  if (!storeId) throw new Error('A loja canônica não foi identificada.');
  if (storeId === payment.legacyStoreId) {
    throw new Error('O espelhamento exige um storeId independente do caminho legado.');
  }

  return {
    id: payment.id,
    storeId,
    legacyStoreId: payment.legacyStoreId,
    tableCode: payment.tableCode,
    method: payment.method,
    amount: payment.amount,
    quantity: payment.quantity,
    items: payment.items,
    actorUserId: payment.operatorId || migratedByUserId,
    actorRole: migratedByRole,
    actorName: payment.operatorName,
    legacyCreatedAt: payment.createdAt,
    migratedFromPath: `${getLegacyTablePaymentsCollectionPath(payment.legacyStoreId)}/${payment.id}`,
    migration: {
      mode: 'dual_write',
      migratedByUserId,
      migratedByRole,
    },
  };
};

const assertMigrationContext = (
  user: Pick<User, 'uid'>,
  canonicalStore: CanonicalStoreRecord,
  legacyStoreId: string
): void => {
  if (canonicalStore.ownerId !== user.uid) {
    throw new Error('A loja canônica não pertence ao usuário autenticado.');
  }
  if (canonicalStore.legacyTenantId !== legacyStoreId) {
    throw new Error('A loja antiga não corresponde ao cadastro canônico selecionado.');
  }
  if (canonicalStore.id === legacyStoreId) {
    throw new Error('O storeId canônico precisa ser independente do UID legado.');
  }
};

export const mirrorLegacyOrderToCanonical = async (
  user: Pick<User, 'uid'>,
  canonicalStore: CanonicalStoreRecord,
  order: CustomerOrder
): Promise<'created' | 'updated'> => {
  assertMigrationContext(user, canonicalStore, order.storeId);
  const reference = doc(db, getStoreOrderDocumentPath(canonicalStore.id, order.id));
  const snapshot = await getDoc(reference);

  if (!snapshot.exists()) {
    const data = buildCanonicalOrderMirrorData(
      order,
      canonicalStore.id,
      user.uid,
      'owner'
    );
    await setDoc(reference, {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return 'created';
  }

  await updateDoc(reference, {
    items: order.items,
    status: order.status,
    paymentStatus: order.paymentStatus,
    tableCode: order.tableCode,
    customerNote: order.customerNote,
    legacyUpdatedAt: order.updatedAt,
    updatedAt: serverTimestamp(),
  });
  return 'updated';
};

export const mirrorLegacyPaymentToCanonical = async (
  user: Pick<User, 'uid'>,
  canonicalStore: CanonicalStoreRecord,
  payment: LegacyTablePaymentRecord
): Promise<'created' | 'unchanged'> => {
  assertMigrationContext(user, canonicalStore, payment.legacyStoreId);
  const reference = doc(
    db,
    `${getStorePaymentsCollectionPath(canonicalStore.id)}/${payment.id}`
  );
  const snapshot = await getDoc(reference);
  if (snapshot.exists()) return 'unchanged';

  const data = buildCanonicalPaymentMirrorData(
    payment,
    canonicalStore.id,
    user.uid,
    'owner'
  );
  await setDoc(reference, {
    ...data,
    createdAt: serverTimestamp(),
  });
  return 'created';
};

const enqueueSnapshotDocuments = <T>(
  snapshots: QueryDocumentSnapshot<DocumentData>[],
  parse: (snapshot: QueryDocumentSnapshot<DocumentData>) => T | null,
  mirror: (record: T) => Promise<void>,
  onError?: (error: Error) => void
): void => {
  void snapshots.reduce<Promise<void>>(async (previous, snapshot) => {
    await previous;
    const record = parse(snapshot);
    if (!record) return;
    try {
      await mirror(record);
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error('Falha no espelhamento operacional.'));
    }
  }, Promise.resolve());
};

export const subscribeToOperationalDualWrite = async (
  user: Pick<User, 'uid'>,
  legacyStoreId: string,
  callbacks: OperationalDualWriteCallbacks = {}
): Promise<Unsubscribe> => {
  const canonicalStore = await resolveCanonicalStoreForLegacyTenant(
    user,
    legacyStoreId
  );

  if (!canonicalStore) {
    callbacks.onUnavailable?.();
    return () => undefined;
  }

  const activeStore = await activateOperationalDualWrite(user, canonicalStore);
  callbacks.onReady?.(activeStore);

  const unsubscribeOrders = onSnapshot(
    collection(db, getCustomerOrdersCollectionPath(legacyStoreId)),
    snapshot => {
      enqueueSnapshotDocuments(
        snapshot.docs,
        orderSnapshot => parseCustomerOrder(orderSnapshot.data()),
        async order => {
          await mirrorLegacyOrderToCanonical(user, activeStore, order);
          callbacks.onMirrored?.('order', order.id);
        },
        callbacks.onError
      );
    },
    error => callbacks.onError?.(error)
  );

  const unsubscribePayments = onSnapshot(
    collection(db, getLegacyTablePaymentsCollectionPath(legacyStoreId)),
    snapshot => {
      enqueueSnapshotDocuments(
        snapshot.docs,
        paymentSnapshot =>
          parseLegacyTablePayment(paymentSnapshot.data(), paymentSnapshot.id),
        async payment => {
          await mirrorLegacyPaymentToCanonical(user, activeStore, payment);
          callbacks.onMirrored?.('payment', payment.id);
        },
        callbacks.onError
      );
    },
    error => callbacks.onError?.(error)
  );

  return () => {
    unsubscribeOrders();
    unsubscribePayments();
  };
};
