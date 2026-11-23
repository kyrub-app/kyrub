import { createHash } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import { parseStoreMember, type StoreRole } from '../../src/utils/storeSecurity.js';
import { buildUserNotification, userNotificationPath } from '../../shared/userNotifications.js';
import {
  STAFF_SHIFT_MAX_DAY_ENTRIES, STAFF_SHIFT_MAX_RESULTS,
  canReadStaffShift, safeStaffShiftId,
  staffShiftDaySlices, staffShiftSlotsOverlap,
  validateStaffShiftCancellation, validateStaffShiftCreation,
  type StaffShift, type StaffShiftDaySlot,
} from '../../shared/staffShifts.js';
import { resolveStaffActor } from './staffNoticeService.js';
import { listAuthorizedStaffTaskAssignees } from './staffTaskService.js';

type Actor = Awaited<ReturnType<typeof resolveStaffActor>>;
const clean = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const shiftsFor = (actor: Actor) =>
  adminDb.collection('stores/' + actor.canonicalStoreId + '/staffShifts');
const schedulesFor = (actor: Actor) =>
  adminDb.collection('stores/' + actor.canonicalStoreId + '/staffScheduleDays');
const requireManager = (actor: Actor): void => {
  if (actor.role !== 'owner' && actor.role !== 'manager') throw Error('STAFF_SHIFT_FORBIDDEN');
};

const recheckActor = async (actor: Actor, tx: FirebaseFirestore.Transaction): Promise<void> => {
  const store = await tx.get(adminDb.doc('stores/' + actor.canonicalStoreId));
  if (!store.exists || clean(store.get('ownerId')) !== actor.legacyStoreId) {
    throw Error('STAFF_SHIFT_FORBIDDEN');
  }
  if (actor.role === 'owner') return;
  const snap = await tx.get(adminDb.doc('stores/' + actor.canonicalStoreId + '/members/' + actor.uid));
  const member = parseStoreMember(snap.data());
  if (!member || member.userId !== actor.uid ||
      member.storeId !== actor.canonicalStoreId ||
      member.status !== 'active' || member.role !== actor.role) {
    throw Error('STAFF_SHIFT_FORBIDDEN');
  }
};

const dayReference = (actor: Actor, uid: string, date: string) =>
  schedulesFor(actor).doc(uid + '__' + date);

const readDaySlots = (snap: FirebaseFirestore.DocumentSnapshot): StaffShiftDaySlot[] => {
  if (!snap.exists) return [];
  const data = snap.get('slots');
  if (!Array.isArray(data) || data.length > STAFF_SHIFT_MAX_DAY_ENTRIES ||
      data.some(slot =>
        !slot || !safeStaffShiftId(slot.shiftId) ||
        !Number.isInteger(slot.startMinute) ||
        !Number.isInteger(slot.endMinute) ||
        slot.startMinute < 0 || slot.endMinute > 1440 ||
        slot.startMinute >= slot.endMinute
      )) throw Error('STAFF_SHIFT_INDEX_INVALID');
  return data as StaffShiftDaySlot[];
};

const sendAssignmentNotice = (
  actor: Actor, shift: StaffShift, event: 'staff_shift_published' | 'staff_shift_cancelled',
  now: string
) => {
  const cancelled = event === 'staff_shift_cancelled';
  return buildUserNotification({
    recipientUserId: shift.assignedTo,
    category: 'system',
    eventType: event,
    sourceId: actor.canonicalStoreId + '_' + shift.id,
    actorPrincipalId: actor.uid,
    title: (cancelled ? 'Escala cancelada: ' : 'Nova escala: ') +
      (shift.kind === 'day_off' ? 'Folga' : shift.sector),
    body: 'Consulte seus registros em Painel da Loja → Ponto → Escalas.',
    target: { kind: 'none', storeId: actor.canonicalStoreId },
    createdAt: now,
  });
};

export const listAuthorizedStaffShifts = async (input: {
  authorization: string; legacyStoreId: string;
}): Promise<StaffShift[]> => {
  const actor = await resolveStaffActor(input.authorization, input.legacyStoreId);
  const manager = actor.role === 'owner' || actor.role === 'manager';
  const snap = await (manager
    ? shiftsFor(actor).orderBy('createdAt', 'desc')
    : shiftsFor(actor).where('assignedTo', '==', actor.uid))
    .limit(STAFF_SHIFT_MAX_RESULTS).get();
  return snap.docs
    .map(doc => ({doc, shift: doc.data() as StaffShift}))
    .filter(({doc, shift}) => safeStaffShiftId(shift.id) && shift.id === doc.id &&
      shift.canonicalStoreId === actor.canonicalStoreId &&
      shift.legacyStoreId === actor.legacyStoreId &&
      canReadStaffShift(actor, shift))
    .map(({shift}) => shift)
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) ||
      a.startTime.localeCompare(b.startTime));
};

export const listAuthorizedStaffShiftAssignees = listAuthorizedStaffTaskAssignees;

export const publishAuthorizedStaffShift = async (input: {
  authorization: string; legacyStoreId: string; requestId: unknown;
  kind: unknown; assignedTo: unknown; scheduledDate: unknown;
  startTime: unknown; endTime: unknown; endsNextDay: unknown;
  sector: unknown; notes: unknown;
}): Promise<StaffShift> => {
  const actor = await resolveStaffActor(input.authorization, input.legacyStoreId);
  requireManager(actor);
  const valid = validateStaffShiftCreation(input);
  const hash = createHash('sha256').update(JSON.stringify(valid)).digest('hex');
  const shiftRef = shiftsFor(actor).doc(valid.id);
  const slices = staffShiftDaySlices(valid);
  const now = new Date().toISOString();
  return adminDb.runTransaction(async tx => {
    const previous = await tx.get(shiftRef);
    await recheckActor(actor, tx);
    if (previous.exists) {
      if (previous.get('creationHash') !== hash ||
          previous.get('createdBy') !== actor.uid ||
          previous.get('legacyStoreId') !== actor.legacyStoreId ||
          previous.get('canonicalStoreId') !== actor.canonicalStoreId) {
        throw Error('STAFF_SHIFT_IDEMPOTENCY_CONFLICT');
      }
      const {creationHash: _private, ...shift} = previous.data() as StaffShift & {creationHash:string};
      return shift;
    }
    let assignedRole: StoreRole = 'owner';
    if (valid.assignedTo !== actor.legacyStoreId) {
      const memberDoc = await tx.get(adminDb.doc(
        'stores/' + actor.canonicalStoreId + '/members/' + valid.assignedTo
      ));
      const member = parseStoreMember(memberDoc.data());
      if (!member || member.userId !== valid.assignedTo ||
          member.storeId !== actor.canonicalStoreId ||
          member.status !== 'active') throw Error('STAFF_SHIFT_ASSIGNEE_INVALID');
      assignedRole = member.role;
    }
    // Per-assignee/day index documents form transactional locks. They prevent
    // two concurrent managers from assigning overlapping hours or a shift on a day off.
    const indexed = await Promise.all(slices.map(async slice => ({
      ...slice,
      ref: dayReference(actor, valid.assignedTo, slice.date),
      snap: await tx.get(dayReference(actor, valid.assignedTo, slice.date)),
    })));
    const nextSlots = indexed.map(item => {
      const old = readDaySlots(item.snap);
      if (old.some(slot => staffShiftSlotsOverlap(slot, item.slot))) {
        throw Error('STAFF_SHIFT_OVERLAP');
      }
      if (old.length >= STAFF_SHIFT_MAX_DAY_ENTRIES) throw Error('STAFF_SHIFT_DAY_LIMIT');
      return {ref: item.ref, slots: [...old, item.slot]};
    });
    const shift: StaffShift = {
      ...valid, assignedRole,
      canonicalStoreId: actor.canonicalStoreId, legacyStoreId: actor.legacyStoreId,
      status: 'published', createdBy: actor.uid, createdAt: now, updatedAt: now,
      cancelledAt: '', cancelledBy: '', cancelReason: '', version: 1,
    };
    tx.create(shiftRef, {...shift, creationHash: hash});
    for (const day of nextSlots) tx.set(day.ref, {slots: day.slots, updatedAt: now});
    tx.create(shiftRef.collection('history').doc(valid.id), {
      action: 'published', actorId: actor.uid, version: 1, createdAt: now,
    });
    if (valid.assignedTo !== actor.uid) {
      const notification = sendAssignmentNotice(actor, shift, 'staff_shift_published', now);
      tx.set(adminDb.doc(userNotificationPath(valid.assignedTo, notification.id)), notification);
    }
    return shift;
  });
};

export const cancelAuthorizedStaffShift = async (input: {
  authorization: string; legacyStoreId: string;
  shiftId: unknown; requestId: unknown; expectedVersion: unknown; reason: unknown;
}): Promise<StaffShift> => {
  const actor = await resolveStaffActor(input.authorization, input.legacyStoreId);
  requireManager(actor);
  const valid = validateStaffShiftCancellation(input);
  const shiftRef = shiftsFor(actor).doc(valid.shiftId);
  const hash = createHash('sha256').update(JSON.stringify(valid)).digest('hex');
  const requestRef = shiftRef.collection('mutationRequests').doc(valid.requestId);
  const now = new Date().toISOString();
  return adminDb.runTransaction(async tx => {
    const [snapshot, request] = await Promise.all([tx.get(shiftRef), tx.get(requestRef)]);
    await recheckActor(actor, tx);
    const original = snapshot.data() as StaffShift | undefined;
    if (!original || original.id !== valid.shiftId ||
        original.legacyStoreId !== actor.legacyStoreId ||
        original.canonicalStoreId !== actor.canonicalStoreId) throw Error('STAFF_SHIFT_NOT_FOUND');
    if (request.exists) {
      if (request.get('hash') !== hash || request.get('actorId') !== actor.uid) {
        throw Error('STAFF_SHIFT_IDEMPOTENCY_CONFLICT');
      }
      return original;
    }
    if (original.version !== valid.expectedVersion || original.status !== 'published') {
      throw Error('STAFF_SHIFT_VERSION_CONFLICT');
    }
    const slices = staffShiftDaySlices(original);
    const indexed = await Promise.all(slices.map(async slice => ({
      ...slice,
      ref: dayReference(actor, original.assignedTo, slice.date),
      snap: await tx.get(dayReference(actor, original.assignedTo, slice.date)),
    })));
    const removed = indexed.map(item => {
      const before = readDaySlots(item.snap);
      if (!before.some(slot => slot.shiftId === original.id &&
          slot.startMinute === item.slot.startMinute &&
          slot.endMinute === item.slot.endMinute)) {
        throw Error('STAFF_SHIFT_INDEX_INVALID');
      }
      return {ref:item.ref,slots:before.filter(slot => slot.shiftId !== original.id)};
    });
    const updated: StaffShift = {
      ...original, status: 'cancelled', version: original.version + 1,
      updatedAt: now, cancelledAt: now, cancelledBy: actor.uid, cancelReason: valid.reason,
    };
    tx.update(shiftRef, {
      status: updated.status, version: updated.version, updatedAt: now,
      cancelledAt: now, cancelledBy: actor.uid, cancelReason: valid.reason,
    });
    for (const day of removed) tx.set(day.ref, {slots: day.slots, updatedAt: now});
    tx.create(requestRef, {hash, actorId:actor.uid, requestId:valid.requestId, createdAt:now});
    tx.create(shiftRef.collection('history').doc(valid.requestId), {
      action:'cancelled',actorId:actor.uid,reason:valid.reason,
      version:updated.version,createdAt:now,
    });
    if (original.assignedTo !== actor.uid) {
      const notice=sendAssignmentNotice(actor, updated, 'staff_shift_cancelled', now);
      tx.set(adminDb.doc(userNotificationPath(original.assignedTo,notice.id)),notice);
    }
    return updated;
  });
};
