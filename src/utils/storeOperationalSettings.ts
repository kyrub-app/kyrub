import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from './firebase';

export const STORE_WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export type StoreWeekday = (typeof STORE_WEEKDAYS)[number];

export interface StoreOpeningHoursDay {
  enabled: boolean;
  opensAt: string;
  closesAt: string;
}

export type StoreOpeningHours = Record<StoreWeekday, StoreOpeningHoursDay>;

export const STORE_INTEGRATION_IDS = [
  'open-delivery',
  'sefaz',
  'ifood',
  '99food',
  'mercado-livre',
  'shopee',
] as const;

export type StoreIntegrationId = (typeof STORE_INTEGRATION_IDS)[number];
export type StoreIntegrationEnvironment = 'sandbox' | 'production';
export type StoreIntegrationStatus =
  | 'not-configured'
  | 'draft'
  | 'awaiting-authorization'
  | 'sandbox-ready'
  | 'attention';

export interface StoreIntegrationPlan {
  status: StoreIntegrationStatus;
  environment: StoreIntegrationEnvironment;
  accountLabel: string;
  externalStoreId: string;
  routingTarget: string;
  receiveOrders: boolean;
  syncCatalog: boolean;
  syncInventory: boolean;
  lastTestAt: string;
}

export type StoreIntegrationPlans = Record<
  StoreIntegrationId,
  StoreIntegrationPlan
>;

export interface StoreOperationalSettings {
  openingHours: StoreOpeningHours;
  integrations: StoreIntegrationPlans;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_TEXT_LENGTH = 120;

const normalizeText = (value: unknown): string =>
  typeof value === 'string' ? value.trim().slice(0, MAX_TEXT_LENGTH) : '';

const normalizeDateTime = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) return '';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
};

export const createEmptyStoreOpeningHours = (): StoreOpeningHours =>
  Object.fromEntries(
    STORE_WEEKDAYS.map(day => [
      day,
      { enabled: false, opensAt: '', closesAt: '' },
    ])
  ) as StoreOpeningHours;

export const createEmptyStoreIntegrationPlan = (): StoreIntegrationPlan => ({
  status: 'not-configured',
  environment: 'sandbox',
  accountLabel: '',
  externalStoreId: '',
  routingTarget: '',
  receiveOrders: false,
  syncCatalog: false,
  syncInventory: false,
  lastTestAt: '',
});

export const createEmptyStoreIntegrationPlans = (): StoreIntegrationPlans =>
  Object.fromEntries(
    STORE_INTEGRATION_IDS.map(integrationId => [
      integrationId,
      createEmptyStoreIntegrationPlan(),
    ])
  ) as StoreIntegrationPlans;

export const createEmptyStoreOperationalSettings = (): StoreOperationalSettings => ({
  openingHours: createEmptyStoreOpeningHours(),
  integrations: createEmptyStoreIntegrationPlans(),
});

const parseOpeningDay = (value: unknown): StoreOpeningHoursDay => {
  if (!value || typeof value !== 'object') {
    return { enabled: false, opensAt: '', closesAt: '' };
  }

  const candidate = value as Record<string, unknown>;
  const enabled = candidate.enabled === true;
  const opensAt =
    typeof candidate.opensAt === 'string' && TIME_PATTERN.test(candidate.opensAt)
      ? candidate.opensAt
      : '';
  const closesAt =
    typeof candidate.closesAt === 'string' && TIME_PATTERN.test(candidate.closesAt)
      ? candidate.closesAt
      : '';

  return {
    enabled: enabled && Boolean(opensAt && closesAt),
    opensAt,
    closesAt,
  };
};

const parseIntegrationStatus = (value: unknown): StoreIntegrationStatus => {
  if (value === 'planned') return 'draft';
  if (
    value === 'draft' ||
    value === 'awaiting-authorization' ||
    value === 'sandbox-ready' ||
    value === 'attention'
  ) {
    return value;
  }
  return 'not-configured';
};

export const parseIntegrationPlan = (value: unknown): StoreIntegrationPlan => {
  if (!value || typeof value !== 'object') {
    return createEmptyStoreIntegrationPlan();
  }

  const candidate = value as Record<string, unknown>;
  return {
    status: parseIntegrationStatus(candidate.status),
    environment:
      candidate.environment === 'production' ? 'production' : 'sandbox',
    accountLabel: normalizeText(candidate.accountLabel),
    externalStoreId: normalizeText(candidate.externalStoreId),
    routingTarget: normalizeText(candidate.routingTarget),
    receiveOrders: candidate.receiveOrders === true,
    syncCatalog: candidate.syncCatalog === true,
    syncInventory: candidate.syncInventory === true,
    lastTestAt: normalizeDateTime(candidate.lastTestAt),
  };
};

export const parseStoreIntegrationPlans = (
  value: unknown
): StoreIntegrationPlans => {
  const candidate = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};

  return Object.fromEntries(
    STORE_INTEGRATION_IDS.map(integrationId => [
      integrationId,
      parseIntegrationPlan(candidate[integrationId]),
    ])
  ) as StoreIntegrationPlans;
};

export const parseStoreOperationalSettings = (
  value: unknown
): StoreOperationalSettings => {
  const candidate = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const openingCandidate = candidate.openingHours && typeof candidate.openingHours === 'object'
    ? candidate.openingHours as Record<string, unknown>
    : {};

  return {
    openingHours: Object.fromEntries(
      STORE_WEEKDAYS.map(day => [day, parseOpeningDay(openingCandidate[day])])
    ) as StoreOpeningHours,
    integrations: parseStoreIntegrationPlans(candidate.integrations),
  };
};

export const validateStoreOpeningHours = (
  openingHours: StoreOpeningHours
): void => {
  for (const day of STORE_WEEKDAYS) {
    const schedule = openingHours[day];
    if (!schedule.enabled) continue;
    if (!TIME_PATTERN.test(schedule.opensAt) || !TIME_PATTERN.test(schedule.closesAt)) {
      throw new Error('Preencha os horários de abertura e fechamento dos dias ativos.');
    }
    if (schedule.opensAt === schedule.closesAt) {
      throw new Error('Abertura e fechamento não podem ter o mesmo horário.');
    }
  }
};

export const validateStoreIntegrationSetup = (
  integrationId: StoreIntegrationId,
  plan: StoreIntegrationPlan,
  options: { forOrderTest?: boolean } = {}
): void => {
  if (!plan.accountLabel.trim()) {
    throw new Error('Informe o nome da conta ou unidade no parceiro.');
  }

  if (!plan.externalStoreId.trim()) {
    throw new Error('Informe o identificador da loja no parceiro.');
  }

  if (plan.receiveOrders && !plan.routingTarget.trim()) {
    throw new Error('Informe para qual fila, setor ou equipe os pedidos serão enviados.');
  }

  if (options.forOrderTest && integrationId === 'sefaz') {
    throw new Error('SEFAZ é uma integração fiscal e não recebe pedidos.');
  }

  if (options.forOrderTest && !plan.receiveOrders) {
    throw new Error('Ative o recebimento de pedidos antes de testar o roteamento.');
  }
};

export const getStoreOperationalSettingsCacheKey = (uid: string): string =>
  `kyrub_store_operational_settings_${uid}`;

export const loadCachedStoreOperationalSettings = (
  storage: StorageLike,
  uid: string
): StoreOperationalSettings => {
  const serialized = storage.getItem(getStoreOperationalSettingsCacheKey(uid));
  if (!serialized) return createEmptyStoreOperationalSettings();

  try {
    return parseStoreOperationalSettings(JSON.parse(serialized));
  } catch {
    return createEmptyStoreOperationalSettings();
  }
};

export const saveCachedStoreOperationalSettings = (
  storage: StorageLike,
  uid: string,
  settings: StoreOperationalSettings
): void => {
  storage.setItem(
    getStoreOperationalSettingsCacheKey(uid),
    JSON.stringify(parseStoreOperationalSettings(settings))
  );
};

export const subscribeToStoreOperationalSettings = (
  user: Pick<User, 'uid'>,
  onSettings: (settings: StoreOperationalSettings) => void,
  onError?: (error: Error) => void
): Unsubscribe =>
  onSnapshot(
    doc(db, 'tenants', user.uid),
    { includeMetadataChanges: true },
    snapshot => {
      if (snapshot.metadata.fromCache && !snapshot.exists()) return;
      onSettings(parseStoreOperationalSettings(snapshot.data()?.operationalSettings));
    },
    error => onError?.(error)
  );

export const persistStoreIntegrationPlans = async (
  user: Pick<User, 'uid' | 'email'>,
  integrations: StoreIntegrationPlans
): Promise<void> => {
  const normalized = parseStoreIntegrationPlans(integrations);

  await setDoc(
    doc(db, 'tenants', user.uid),
    {
      id: user.uid,
      ownerId: user.uid,
      email: user.email ?? '',
      role: 'retailer',
      operationalSettings: {
        integrations: normalized,
      },
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};

export const persistStoreOperationalSettings = async (
  user: Pick<User, 'uid' | 'email'>,
  settings: StoreOperationalSettings
): Promise<void> => {
  validateStoreOpeningHours(settings.openingHours);
  const normalized = parseStoreOperationalSettings(settings);

  await setDoc(
    doc(db, 'tenants', user.uid),
    {
      id: user.uid,
      ownerId: user.uid,
      email: user.email ?? '',
      role: 'retailer',
      operationalSettings: normalized,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};