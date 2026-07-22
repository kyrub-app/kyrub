import type { User } from 'firebase/auth';
import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type {
  MigrationReconciliationReport,
  ReconciliationSectionKey,
} from './migrationReconciliation';

export type CanonicalReadDomain = Extract<
  ReconciliationSectionKey,
  'products' | 'orders' | 'payments'
>;
export type CanonicalReadSource = 'legacy' | 'canonical';
export type CanonicalReadFallbackReason =
  | 'canonical'
  | 'disabled'
  | 'missing_mapping'
  | 'waiting'
  | 'unavailable'
  | 'divergent';

export interface CanonicalReadPreferences {
  products: boolean;
  orders: boolean;
  payments: boolean;
}

export interface CanonicalReadConfig {
  canonicalStoreId: string;
  preferences: CanonicalReadPreferences;
}

export interface CanonicalReadDecision {
  source: CanonicalReadSource;
  reason: CanonicalReadFallbackReason;
}

export const DEFAULT_CANONICAL_READ_PREFERENCES: CanonicalReadPreferences = {
  products: false,
  orders: false,
  payments: false,
};

const cleanString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const parseCanonicalReadConfig = (
  value: DocumentData | undefined
): CanonicalReadConfig => {
  const rawPreferences =
    value?.canonicalReadPreferences &&
    typeof value.canonicalReadPreferences === 'object'
      ? (value.canonicalReadPreferences as Record<string, unknown>)
      : {};

  return {
    canonicalStoreId: cleanString(value?.canonicalStoreId),
    preferences: {
      products: rawPreferences.products === true,
      orders: rawPreferences.orders === true,
      payments: rawPreferences.payments === true,
    },
  };
};

export const chooseCanonicalReadSource = (
  enabled: boolean,
  canonicalStoreId: string,
  canonicalState: 'waiting' | 'available' | 'unavailable',
  equivalent: boolean
): CanonicalReadDecision => {
  if (!enabled) return { source: 'legacy', reason: 'disabled' };
  if (!canonicalStoreId.trim()) {
    return { source: 'legacy', reason: 'missing_mapping' };
  }
  if (canonicalState === 'waiting') {
    return { source: 'legacy', reason: 'waiting' };
  }
  if (canonicalState === 'unavailable') {
    return { source: 'legacy', reason: 'unavailable' };
  }
  if (!equivalent) return { source: 'legacy', reason: 'divergent' };
  return { source: 'canonical', reason: 'canonical' };
};

export const subscribeToCanonicalReadConfig = (
  legacyStoreId: string,
  onConfig: (config: CanonicalReadConfig) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  const normalizedStoreId = legacyStoreId.trim();
  if (!normalizedStoreId) {
    onConfig({
      canonicalStoreId: '',
      preferences: { ...DEFAULT_CANONICAL_READ_PREFERENCES },
    });
    return () => undefined;
  }

  return onSnapshot(
    doc(db, 'tenants', normalizedStoreId),
    snapshot => onConfig(parseCanonicalReadConfig(snapshot.data())),
    error => {
      onConfig({
        canonicalStoreId: '',
        preferences: { ...DEFAULT_CANONICAL_READ_PREFERENCES },
      });
      onError?.(error);
    }
  );
};

export const getCanonicalReadDecisionStorageKey = (
  legacyStoreId: string,
  domain: CanonicalReadDomain
): string => `kyrub_read_source_${legacyStoreId.trim()}_${domain}`;

export const recordCanonicalReadDecision = (
  legacyStoreId: string,
  domain: CanonicalReadDomain,
  decision: CanonicalReadDecision
): void => {
  const payload = JSON.stringify({
    ...decision,
    checkedAt: new Date().toISOString(),
  });
  try {
    globalThis.localStorage?.setItem(
      getCanonicalReadDecisionStorageKey(legacyStoreId, domain),
      payload
    );
  } catch {
    // The source record is diagnostic only and must never block a read.
  }
};

const getReportSection = (
  report: MigrationReconciliationReport,
  domain: CanonicalReadDomain
) => report.sections.find(section => section.key === domain);

export const canEnableCanonicalReadDomain = (
  report: MigrationReconciliationReport,
  domain: CanonicalReadDomain
): boolean => getReportSection(report, domain)?.status === 'matched';

export const updateCanonicalReadPreference = async (
  user: Pick<User, 'uid'>,
  report: MigrationReconciliationReport,
  domain: CanonicalReadDomain,
  enabled: boolean
): Promise<CanonicalReadConfig> => {
  if (
    !user.uid ||
    user.uid !== report.legacyStoreId ||
    report.store.ownerId !== user.uid
  ) {
    throw new Error('Somente o proprietário pode alterar a fonte de leitura.');
  }
  if (enabled && !canEnableCanonicalReadDomain(report, domain)) {
    throw new Error(
      'Corrija as divergências deste domínio antes de ativar a leitura canônica.'
    );
  }

  const preferences: CanonicalReadPreferences = {
    ...DEFAULT_CANONICAL_READ_PREFERENCES,
    ...report.store.readPreferences,
    [domain]: enabled,
  };

  await setDoc(
    doc(db, 'tenants', report.legacyStoreId),
    {
      ownerId: user.uid,
      canonicalStoreId: report.store.id,
      canonicalReadPreferences: preferences,
      canonicalReadUpdatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return {
    canonicalStoreId: report.store.id,
    preferences,
  };
};
