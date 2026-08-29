import { buildStoreInstitutionalPrincipalId } from './storeInstitutionalIdentity.js';

export const LOCAL_ATTENDANCE_SCHEMA_VERSION = 1 as const;
export const LOCAL_ATTENDANCE_MAX_CUSTOMER_LABEL_LENGTH = 120;
export const LOCAL_ATTENDANCE_MAX_SPACE_LENGTH = 80;
export const LOCAL_ATTENDANCE_MAX_ITEM_COUNT = 999;
export const LOCAL_ATTENDANCE_MAX_LIST = 100;

export type LocalAttendanceStatus = 'open' | 'closed';

export interface LocalAttendanceSession {
  schemaVersion: typeof LOCAL_ATTENDANCE_SCHEMA_VERSION;
  id: string;
  storeId: string;
  storePrincipalId: string;
  customerLabel: string;
  space: string;
  itemCount: number;
  status: LocalAttendanceStatus;
  openedAt: string;
  updatedAt: string;
  closedAt: string;
  openedByUserId: string;
  closedByUserId: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const validPathId = (value: string): boolean =>
  Boolean(value) && value.length <= 160 && !value.includes('/');

const finiteIso = (value: string): boolean =>
  Boolean(value) && Number.isFinite(Date.parse(value));

export const normalizeLocalAttendanceCustomerLabel = (value: unknown): string => {
  const label = clean(value);
  if (!label) throw new Error('LOCAL_ATTENDANCE_CUSTOMER_REQUIRED');
  if (label.length > LOCAL_ATTENDANCE_MAX_CUSTOMER_LABEL_LENGTH) {
    throw new Error('LOCAL_ATTENDANCE_CUSTOMER_TOO_LONG');
  }
  return label;
};

export const normalizeLocalAttendanceSpace = (value: unknown): string => {
  const space = clean(value).toLocaleUpperCase('pt-BR');
  if (!space) throw new Error('LOCAL_ATTENDANCE_SPACE_REQUIRED');
  if (space.length > LOCAL_ATTENDANCE_MAX_SPACE_LENGTH) {
    throw new Error('LOCAL_ATTENDANCE_SPACE_TOO_LONG');
  }
  return space;
};

export const normalizeLocalAttendanceItemCount = (value: unknown): number => {
  const count = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(count) || count < 1 || count > LOCAL_ATTENDANCE_MAX_ITEM_COUNT) {
    throw new Error('LOCAL_ATTENDANCE_ITEM_COUNT_INVALID');
  }
  return count;
};

export const localAttendancePath = (
  storeIdInput: string,
  attendanceIdInput: string
): string => {
  const storeId = clean(storeIdInput);
  const attendanceId = clean(attendanceIdInput);
  if (!validPathId(storeId) || !validPathId(attendanceId)) {
    throw new Error('LOCAL_ATTENDANCE_PATH_INVALID');
  }
  return `stores/${storeId}/localAttendance/${attendanceId}`;
};

export const buildOpenLocalAttendance = (input: {
  id: string;
  storeId: string;
  customerLabel: unknown;
  space: unknown;
  itemCount: unknown;
  actorUserId: string;
  openedAt: string;
}): LocalAttendanceSession => {
  const id = clean(input.id);
  const storeId = clean(input.storeId);
  const actorUserId = clean(input.actorUserId);
  const openedAt = clean(input.openedAt);
  if (
    !validPathId(id) ||
    !validPathId(storeId) ||
    !validPathId(actorUserId) ||
    !finiteIso(openedAt)
  ) {
    throw new Error('LOCAL_ATTENDANCE_INVALID');
  }

  return {
    schemaVersion: LOCAL_ATTENDANCE_SCHEMA_VERSION,
    id,
    storeId,
    storePrincipalId: buildStoreInstitutionalPrincipalId(storeId),
    customerLabel: normalizeLocalAttendanceCustomerLabel(input.customerLabel),
    space: normalizeLocalAttendanceSpace(input.space),
    itemCount: normalizeLocalAttendanceItemCount(input.itemCount),
    status: 'open',
    openedAt,
    updatedAt: openedAt,
    closedAt: '',
    openedByUserId: actorUserId,
    closedByUserId: '',
  };
};

export const parseLocalAttendanceSession = (
  value: unknown,
  expectedStoreId: string,
  expectedId: string
): LocalAttendanceSession => {
  const data = value as Partial<LocalAttendanceSession>;
  if (
    data.schemaVersion !== LOCAL_ATTENDANCE_SCHEMA_VERSION ||
    data.id !== expectedId ||
    data.storeId !== expectedStoreId ||
    data.storePrincipalId !== buildStoreInstitutionalPrincipalId(expectedStoreId) ||
    (data.status !== 'open' && data.status !== 'closed') ||
    !finiteIso(clean(data.openedAt)) ||
    !finiteIso(clean(data.updatedAt)) ||
    (data.status === 'closed' && !finiteIso(clean(data.closedAt))) ||
    (data.status === 'open' && clean(data.closedAt) !== '') ||
    !validPathId(clean(data.openedByUserId)) ||
    (data.status === 'closed' && !validPathId(clean(data.closedByUserId))) ||
    (data.status === 'open' && clean(data.closedByUserId) !== '')
  ) {
    throw new Error('LOCAL_ATTENDANCE_RECORD_INVALID');
  }
  normalizeLocalAttendanceCustomerLabel(data.customerLabel);
  normalizeLocalAttendanceSpace(data.space);
  normalizeLocalAttendanceItemCount(data.itemCount);
  return data as LocalAttendanceSession;
};
