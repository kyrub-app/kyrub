export const SERVICE_LOCATION_SCHEMA_VERSION = 1 as const;
export const SERVICE_LOCATION_MAX_ID_LENGTH = 160;
export const SERVICE_LOCATION_MAX_LABEL_LENGTH = 80;
export const SERVICE_LOCATION_MAX_LIST = 200;

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

export const parseServiceLocation = (
  value: unknown,
  expectedStoreId: string,
  expectedId: string
): ServiceLocation => {
  if (!value || typeof value !== 'object') {
    throw new Error('SERVICE_LOCATION_RECORD_INVALID');
  }
  const data = value as Partial<ServiceLocation>;
  const label = clean(data.label);
  const createdAt = clean(data.createdAt);
  const updatedAt = clean(data.updatedAt);
  if (
    data.schemaVersion !== SERVICE_LOCATION_SCHEMA_VERSION ||
    data.id !== expectedId ||
    data.storeId !== expectedStoreId ||
    !validPathId(clean(data.id)) ||
    !validPathId(clean(data.storeId)) ||
    !isServiceLocationKind(data.kind) ||
    typeof data.active !== 'boolean' ||
    !label ||
    label.length > SERVICE_LOCATION_MAX_LABEL_LENGTH ||
    !finiteIso(createdAt) ||
    !finiteIso(updatedAt) ||
    Date.parse(updatedAt) < Date.parse(createdAt)
  ) {
    throw new Error('SERVICE_LOCATION_RECORD_INVALID');
  }
  return {
    schemaVersion: SERVICE_LOCATION_SCHEMA_VERSION,
    id: expectedId,
    storeId: expectedStoreId,
    kind: data.kind,
    label,
    active: data.active,
    createdAt,
    updatedAt,
  };
};

export const buildUpdatedServiceLocation = (
  current: ServiceLocation,
  input: {
    kind?: ServiceLocationKind;
    label?: unknown;
    active?: boolean;
    now: string;
  }
): ServiceLocation => {
  const now = clean(input.now);
  const kind = input.kind ?? current.kind;
  const label = input.label === undefined
    ? current.label
    : normalizeServiceLocationLabel(input.label);
  const active = input.active ?? current.active;
  if (
    !isServiceLocationKind(kind) ||
    typeof active !== 'boolean' ||
    !finiteIso(now) ||
    Date.parse(now) < Date.parse(current.createdAt)
  ) {
    throw new Error('SERVICE_LOCATION_UPDATE_INVALID');
  }
  return {
    ...current,
    kind,
    label,
    active,
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

export const inferLegacyServiceLocationKind = (
  value: unknown
): ServiceLocationKind | null => {
  const label = clean(value).toLocaleUpperCase('pt-BR');
  if (/^MESA(?:\s|$)/u.test(label)) return 'table';
  if (/^BALCÃO(?:\s|$)/u.test(label) || /^BALCAO(?:\s|$)/u.test(label)) return 'counter';
  if (/^VAGA(?:\s|$)/u.test(label)) return 'parking_spot';
  if (/^QUARTO(?:\s|$)/u.test(label)) return 'room';
  if (/^(CADEIRA|ASSENTO)(?:\s|$)/u.test(label)) return 'chair';
  if (/^BOX(?:\s|$)/u.test(label)) return 'box';
  if (/^GUICH(?:Ê|E)(?:\s|$)/u.test(label)) return 'service_window';
  return null;
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
