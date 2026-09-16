export const SERVICE_LOCATION_SCHEMA_VERSION = 1 as const;
export const SERVICE_LOCATION_MAX_ID_LENGTH = 160;
export const SERVICE_LOCATION_MAX_LABEL_LENGTH = 80;

export type ServiceLocationKind =
  | 'table'
  | 'counter'
  | 'parking_spot'
  | 'room'
  | 'chair'
  | 'box'
  | 'service_window'
  | 'other';

export interface ServiceLocation {
  schemaVersion: typeof SERVICE_LOCATION_SCHEMA_VERSION;
  id: string;
  storeId: string;
  kind: ServiceLocationKind;
  label: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceLocationSnapshot {
  schemaVersion: typeof SERVICE_LOCATION_SCHEMA_VERSION;
  id: string;
  kind: ServiceLocationKind;
  label: string;
}

export interface ResolvedOrderServiceLocation extends ServiceLocationSnapshot {
  source: 'canonical' | 'legacy_table_code';
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finiteIso = (value: string): boolean =>
  Boolean(value) && Number.isFinite(Date.parse(value));

const validPathId = (value: string): boolean =>
  Boolean(value) &&
  value.length <= SERVICE_LOCATION_MAX_ID_LENGTH &&
  !value.includes('/') &&
  !value.includes('..');

export const isServiceLocationKind = (
  value: unknown
): value is ServiceLocationKind =>
  value === 'table' ||
  value === 'counter' ||
  value === 'parking_spot' ||
  value === 'room' ||
  value === 'chair' ||
  value === 'box' ||
  value === 'service_window' ||
  value === 'other';

export const normalizeServiceLocationLabel = (value: unknown): string => {
  const label = clean(value);
  if (!label) throw new Error('SERVICE_LOCATION_LABEL_REQUIRED');
  if (label.length > SERVICE_LOCATION_MAX_LABEL_LENGTH) {
    throw new Error('SERVICE_LOCATION_LABEL_TOO_LONG');
  }
  return label;
};

export const serviceLocationPath = (
  storeIdInput: string,
  locationIdInput: string
): string => {
  const storeId = clean(storeIdInput);
  const locationId = clean(locationIdInput);
  if (!validPathId(storeId) || !validPathId(locationId)) {
    throw new Error('SERVICE_LOCATION_PATH_INVALID');
  }
  return `stores/${storeId}/serviceLocations/${locationId}`;
};

export const buildServiceLocation = (input: {
  id: string;
  storeId: string;
  kind: ServiceLocationKind;
  label: unknown;
  active?: boolean;
  now: string;
}): ServiceLocation => {
  const id = clean(input.id);
  const storeId = clean(input.storeId);
  const now = clean(input.now);
  if (
    !validPathId(id) ||
    !validPathId(storeId) ||
    !isServiceLocationKind(input.kind) ||
    !finiteIso(now)
  ) {
    throw new Error('SERVICE_LOCATION_INVALID');
  }

  return {
    schemaVersion: SERVICE_LOCATION_SCHEMA_VERSION,
    id,
    storeId,
    kind: input.kind,
    label: normalizeServiceLocationLabel(input.label),
    active: input.active !== false,
    createdAt: now,
    updatedAt: now,
  };
};

export const buildServiceLocationSnapshot = (
  location: Pick<ServiceLocation, 'id' | 'kind' | 'label'>
): ServiceLocationSnapshot => {
  const id = clean(location.id);
  if (!validPathId(id) || !isServiceLocationKind(location.kind)) {
    throw new Error('SERVICE_LOCATION_SNAPSHOT_INVALID');
  }
  return {
    schemaVersion: SERVICE_LOCATION_SCHEMA_VERSION,
    id,
    kind: location.kind,
    label: normalizeServiceLocationLabel(location.label),
  };
};

export const parseServiceLocationSnapshot = (
  value: unknown
): ServiceLocationSnapshot | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const id = clean(candidate.id);
  const label = clean(candidate.label);
  if (
    candidate.schemaVersion !== SERVICE_LOCATION_SCHEMA_VERSION ||
    !validPathId(id) ||
    !isServiceLocationKind(candidate.kind) ||
    !label ||
    label.length > SERVICE_LOCATION_MAX_LABEL_LENGTH
  ) {
    return null;
  }
  return {
    schemaVersion: SERVICE_LOCATION_SCHEMA_VERSION,
    id,
    kind: candidate.kind,
    label,
  };
};

export const resolveOrderServiceLocation = (input: {
  serviceLocation?: unknown;
  tableCode?: unknown;
}): ResolvedOrderServiceLocation | null => {
  const canonical = parseServiceLocationSnapshot(input.serviceLocation);
  if (canonical) {
    return {
      ...canonical,
      source: 'canonical',
    };
  }

  const legacyTableCode = clean(input.tableCode);
  if (!legacyTableCode) return null;
  return {
    schemaVersion: SERVICE_LOCATION_SCHEMA_VERSION,
    id: '',
    kind: 'table',
    label: legacyTableCode,
    source: 'legacy_table_code',
  };
};

export const serviceLocationIdentityKey = (
  location: ResolvedOrderServiceLocation
): string => {
  if (location.source === 'canonical') {
    return `${location.kind}:${location.id}`;
  }
  return `legacy_table:${location.label.toLocaleLowerCase('pt-BR')}`;
};
