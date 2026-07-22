import {
  collection,
  doc,
  onSnapshot,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  chooseCanonicalReadSource,
  parseCanonicalReadConfig,
  recordCanonicalReadDecision,
  type CanonicalReadDecision,
} from './canonicalReadCutover';
import {
  getLegacyTablePaymentsCollectionPath,
  parseLegacyTablePayment,
  type LegacyTablePaymentRecord,
} from './operationalDualWrite';

export interface PreferredTablePaymentsResult {
  payments: LegacyTablePaymentRecord[];
  decision: CanonicalReadDecision;
  canonicalStoreId: string;
}

const cleanString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const parseCanonicalPayment = (
  snapshot: QueryDocumentSnapshot<DocumentData>,
  legacyStoreId: string
): LegacyTablePaymentRecord | null => {
  const value = snapshot.data() as Record<string, unknown>;
  return parseLegacyTablePayment(
    {
      id: cleanString(value.id) || snapshot.id,
      storeId: legacyStoreId,
      tableCode: cleanString(value.tableCode),
      method: value.method,
      amount: value.amount,
      quantity: value.quantity,
      items: value.items,
      operatorId: cleanString(value.actorUserId) || 'canonical-actor',
      operatorName: cleanString(value.actorName),
      createdAt: cleanString(value.legacyCreatedAt),
    },
    snapshot.id
  );
};

const comparablePayment = (payment: LegacyTablePaymentRecord) => ({
  id: payment.id,
  tableCode: payment.tableCode,
  method: payment.method,
  amount: Number(payment.amount.toFixed(2)),
  quantity: payment.quantity,
  items: payment.items.map(item => ({
    orderId: item.orderId,
    lineId: item.lineId,
    productId: item.productId,
    quantity: item.quantity,
    unitPrice: Number(item.unitPrice.toFixed(2)),
    total: Number(item.total.toFixed(2)),
  })),
});

export const tablePaymentCollectionsEquivalent = (
  legacyPayments: LegacyTablePaymentRecord[],
  canonicalPayments: LegacyTablePaymentRecord[]
): boolean => {
  if (legacyPayments.length !== canonicalPayments.length) return false;
  const normalize = (payments: LegacyTablePaymentRecord[]) =>
    payments
      .map(comparablePayment)
      .sort((left, right) => left.id.localeCompare(right.id));
  return JSON.stringify(normalize(legacyPayments)) ===
    JSON.stringify(normalize(canonicalPayments));
};

export const subscribeToPreferredTablePayments = (
  legacyStoreId: string,
  onResult: (result: PreferredTablePaymentsResult) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  const normalizedStoreId = legacyStoreId.trim();
  if (!normalizedStoreId) {
    onResult({
      payments: [],
      canonicalStoreId: '',
      decision: { source: 'legacy', reason: 'missing_mapping' },
    });
    return () => undefined;
  }

  let legacyPayments: LegacyTablePaymentRecord[] = [];
  let canonicalPayments: LegacyTablePaymentRecord[] = [];
  let legacyState: 'waiting' | 'available' | 'unavailable' = 'waiting';
  let canonicalState: 'waiting' | 'available' | 'unavailable' = 'waiting';
  let canonicalStoreId = '';
  let canonicalEnabled = false;
  let unsubscribeCanonical: Unsubscribe = () => undefined;

  const publish = (): void => {
    const equivalent =
      legacyState === 'unavailable' ||
      (legacyState === 'available' &&
        tablePaymentCollectionsEquivalent(legacyPayments, canonicalPayments));
    const decision = chooseCanonicalReadSource(
      canonicalEnabled,
      canonicalStoreId,
      canonicalState,
      equivalent
    );
    recordCanonicalReadDecision(normalizedStoreId, 'payments', decision);
    onResult({
      payments:
        decision.source === 'canonical' ? canonicalPayments : legacyPayments,
      decision,
      canonicalStoreId,
    });
  };

  const restartCanonical = (): void => {
    unsubscribeCanonical();
    unsubscribeCanonical = () => undefined;
    canonicalPayments = [];
    canonicalState = 'waiting';
    if (!canonicalEnabled || !canonicalStoreId) {
      publish();
      return;
    }
    publish();
    unsubscribeCanonical = onSnapshot(
      collection(db, `stores/${canonicalStoreId}/payments`),
      snapshot => {
        canonicalPayments = snapshot.docs.flatMap(document => {
          const parsed = parseCanonicalPayment(document, normalizedStoreId);
          return parsed ? [parsed] : [];
        });
        canonicalState = 'available';
        publish();
      },
      error => {
        canonicalState = 'unavailable';
        publish();
        onError?.(error);
      }
    );
  };

  const unsubscribeLegacy = onSnapshot(
    collection(db, getLegacyTablePaymentsCollectionPath(normalizedStoreId)),
    snapshot => {
      legacyPayments = snapshot.docs.flatMap(document => {
        const parsed = parseLegacyTablePayment(document.data(), document.id);
        return parsed ? [parsed] : [];
      });
      legacyState = 'available';
      publish();
    },
    error => {
      legacyState = 'unavailable';
      publish();
      onError?.(error);
    }
  );

  const unsubscribeConfig = onSnapshot(
    doc(db, 'tenants', normalizedStoreId),
    snapshot => {
      const previousStoreId = canonicalStoreId;
      const previousEnabled = canonicalEnabled;
      const config = parseCanonicalReadConfig(snapshot.data());
      canonicalStoreId = config.canonicalStoreId;
      canonicalEnabled = config.preferences.payments;
      if (
        canonicalStoreId !== previousStoreId ||
        canonicalEnabled !== previousEnabled
      ) {
        restartCanonical();
      } else {
        publish();
      }
    },
    error => {
      canonicalEnabled = false;
      publish();
      onError?.(error);
    }
  );

  return () => {
    unsubscribeLegacy();
    unsubscribeConfig();
    unsubscribeCanonical();
  };
};
