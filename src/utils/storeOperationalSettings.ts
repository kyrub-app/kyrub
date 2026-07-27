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
export type StoreIntegrationPlanStatus = 'not-configured' | 'planned';

export interface StoreIntegrationPlan {
  status: StoreIntegrationPlanStatus;
  environment: 'sandbox' | 'production';
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

export const createEmptyStoreOpeningHours = (): StoreOpeningHours =>
  Object.fromEntries(
    STORE_WEEKDAYS.map(day => [
      day,
      { enabled: false, opensAt: '', closesAt: '' },
    ])
  ) as StoreOpeningHours;

export const createEmptyStoreIntegrationPlans = (): StoreIntegrationPlans =>
  Object.fromEntries(
    STORE_INTEGRATION_IDS.map(integrationId => [
      integrationId,
      { status: 'not-configured', environment: 'sandbox' },
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

const parseIntegrationPlan = (value: unknown): StoreIntegrationPlan => {
  if (!value || typeof value !== 'object') {
    return { status: 'not-configured', environment: 'sandbox' };
  }

  const candidate = value as Record<string, unknown>;
  return {
    status: candidate.status === 'planned' ? 'planned' : 'not-configured',
    environment:
      candidate.environment === 'production' ? 'production' : 'sandbox',
  };
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
  const integrationsCandidate = candidate.integrations && typeof candidate.integrations === 'object'
    ? candidate.integrations as Record<string, unknown>
    : {};

  return {
    openingHours: Object.fromEntries(
      STORE_WEEKDAYS.map(day => [day, parseOpeningDay(openingCandidate[day])])
    ) as StoreOpeningHours,
    integrations: Object.fromEntries(
      STORE_INTEGRATION_IDS.map(integrationId => [
        integrationId,
        parseIntegrationPlan(integrationsCandidate[integrationId]),
      ])
    ) as StoreIntegrationPlans,
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

const getOperationalSettingsCacheKey = (uid: string): string =>
  `kyrub_store_operational_settings_${uid}`;

export const loadCachedStoreOperationalSettings = (
  storage: StorageLike,
  uid: string
): StoreOperationalSettings => {
  const serialized = storage.getItem(getOperationalSettingsCacheKey(uid));
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
    getOperationalSettingsCacheKey(uid),
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
