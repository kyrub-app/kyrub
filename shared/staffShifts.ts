import type { StoreRole } from '../src/utils/storeSecurity';

export const STAFF_SHIFT_MAX_RESULTS = 100;
export const STAFF_SHIFT_MAX_SECTOR = 80;
export const STAFF_SHIFT_MAX_NOTES = 1000;
export const STAFF_SHIFT_MAX_DAY_ENTRIES = 30;

export type StaffShiftKind = 'shift' | 'day_off';
export type StaffShiftStatus = 'published' | 'cancelled';
export type StaffShift = {
  id: string;
  canonicalStoreId: string;
  legacyStoreId: string;
  kind: StaffShiftKind;
  assignedTo: string;
  assignedRole: StoreRole;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  endsNextDay: boolean;
  sector: string;
  notes: string;
  status: StaffShiftStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string;
  cancelledBy: string;
  cancelReason: string;
  version: number;
};

export type StaffShiftDaySlot = {
  shiftId: string;
  startMinute: number;
  endMinute: number;
};

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
export const safeStaffShiftId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{12,96}$/.test(value);
export const safeStaffShiftUserId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{3,128}$/.test(value);
export const validStaffShiftDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
export const validStaffShiftTime = (value: unknown): value is string =>
  typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
export const nextStaffScheduleDate = (date: string): string =>
  new Date(Date.parse(date + 'T00:00:00.000Z') + 86400000).toISOString().slice(0, 10);

export const validateStaffShiftCreation = (input: {
  requestId: unknown; kind: unknown; assignedTo: unknown;
  scheduledDate: unknown; startTime: unknown; endTime: unknown;
  endsNextDay: unknown; sector: unknown; notes: unknown;
}) => {
  const id = clean(input.requestId);
  const assignedTo = clean(input.assignedTo);
  const scheduledDate = clean(input.scheduledDate);
  const startTime = clean(input.startTime);
  const endTime = clean(input.endTime);
  const sector = clean(input.sector);
  const notes = clean(input.notes);
  const kind = input.kind;
  const endsNextDay = input.endsNextDay;
  if (!safeStaffShiftId(id) || !safeStaffShiftUserId(assignedTo) ||
      !validStaffShiftDate(scheduledDate) ||
      (kind !== 'shift' && kind !== 'day_off') ||
      typeof endsNextDay !== 'boolean' ||
      sector.length > STAFF_SHIFT_MAX_SECTOR ||
      notes.length > STAFF_SHIFT_MAX_NOTES) throw Error('STAFF_SHIFT_INVALID');
  if (kind === 'day_off') {
    if (startTime || endTime || endsNextDay || sector) throw Error('STAFF_SHIFT_INVALID');
  } else {
    if (!validStaffShiftTime(startTime) || !validStaffShiftTime(endTime) ||
        !sector || minutes(endTime) + (endsNextDay ? 1440 : 0) - minutes(startTime) <= 0 ||
        minutes(endTime) + (endsNextDay ? 1440 : 0) - minutes(startTime) > 16 * 60) {
      throw Error('STAFF_SHIFT_INVALID');
    }
  }
  return {
    id, kind: kind as StaffShiftKind, assignedTo, scheduledDate,
    startTime, endTime, endsNextDay, sector, notes,
  };
};

/** Civil time in the store, without converting between employee/device time zones.
 * Two slices allow overnight shifts and full-day days off to use the same
 * transactional conflict index. The intervals are half-open [start, end).
 */
export const staffShiftDaySlices = (
  shift: Pick<StaffShift, 'id' | 'kind' | 'scheduledDate' | 'startTime' | 'endTime' | 'endsNextDay'>
): { date: string; slot: StaffShiftDaySlot }[] => {
  if (shift.kind === 'day_off') return [{
    date: shift.scheduledDate,
    slot: { shiftId: shift.id, startMinute: 0, endMinute: 1440 },
  }];
  const start = minutes(shift.startTime);
  const end = minutes(shift.endTime) + (shift.endsNextDay ? 1440 : 0);
  const result = [{
    date: shift.scheduledDate,
    slot: { shiftId: shift.id, startMinute: start, endMinute: Math.min(1440, end) },
  }];
  if (end > 1440) result.push({
    date: nextStaffScheduleDate(shift.scheduledDate),
    slot: { shiftId: shift.id, startMinute: 0, endMinute: end - 1440 },
  });
  return result;
};
export const staffShiftSlotsOverlap = (a: StaffShiftDaySlot, b: StaffShiftDaySlot): boolean =>
  a.startMinute < b.endMinute && b.startMinute < a.endMinute;

export const canReadStaffShift = (
  actor: { uid: string; role: StoreRole }, shift: Pick<StaffShift, 'assignedTo'>
): boolean => actor.role === 'owner' || actor.role === 'manager' ||
  actor.uid === shift.assignedTo;

export const validateStaffShiftCancellation = (input: {
  shiftId: unknown; requestId: unknown; expectedVersion: unknown; reason: unknown;
}) => {
  const shiftId = clean(input.shiftId), requestId = clean(input.requestId),
    reason = clean(input.reason);
  if (!safeStaffShiftId(shiftId) || !safeStaffShiftId(requestId) ||
      typeof input.expectedVersion !== 'number' ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1 || input.expectedVersion > 1000 ||
      reason.length > 500) throw Error('STAFF_SHIFT_INVALID');
  return { shiftId, requestId, expectedVersion: input.expectedVersion, reason };
};
