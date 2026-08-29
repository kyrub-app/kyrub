import { adminDb } from '../firebaseAdmin.js';
import {
  LOCAL_ATTENDANCE_MAX_LIST,
  buildOpenLocalAttendance,
  localAttendancePath,
  parseLocalAttendanceSession,
  type LocalAttendanceSession,
} from '../../shared/localAttendance.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const collectionPath = (storeId: string): string =>
  `stores/${storeId}/localAttendance`;

export const listLocalAttendanceSessions = async (input: {
  storeId: string;
  limit?: number;
}): Promise<LocalAttendanceSession[]> => {
  const storeId = clean(input.storeId);
  if (!storeId) throw new Error('LOCAL_ATTENDANCE_STORE_REQUIRED');
  const limit = Math.max(1, Math.min(LOCAL_ATTENDANCE_MAX_LIST, input.limit ?? 100));
  const snapshot = await adminDb
    .collection(collectionPath(storeId))
    .orderBy('updatedAt', 'desc')
    .limit(limit)
    .get();
  return snapshot.docs.map(document =>
    parseLocalAttendanceSession(document.data(), storeId, document.id)
  );
};

export const openLocalAttendanceSession = async (input: {
  storeId: string;
  actorUserId: string;
  customerLabel: unknown;
  space: unknown;
  itemCount: unknown;
  now?: Date;
}): Promise<LocalAttendanceSession> => {
  const storeId = clean(input.storeId);
  const actorUserId = clean(input.actorUserId);
  if (!storeId) throw new Error('LOCAL_ATTENDANCE_STORE_REQUIRED');
  if (!actorUserId) throw new Error('LOCAL_ATTENDANCE_ACTOR_REQUIRED');
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('LOCAL_ATTENDANCE_TIME_INVALID');

  const reference = adminDb.collection(collectionPath(storeId)).doc();
  const session = buildOpenLocalAttendance({
    id: reference.id,
    storeId,
    customerLabel: input.customerLabel,
    space: input.space,
    itemCount: input.itemCount,
    actorUserId,
    openedAt: now.toISOString(),
  });
  await reference.set(session);
  return session;
};

export const closeLocalAttendanceSession = async (input: {
  storeId: string;
  attendanceId: string;
  actorUserId: string;
  now?: Date;
}): Promise<LocalAttendanceSession> => {
  const storeId = clean(input.storeId);
  const attendanceId = clean(input.attendanceId);
  const actorUserId = clean(input.actorUserId);
  if (!storeId) throw new Error('LOCAL_ATTENDANCE_STORE_REQUIRED');
  if (!attendanceId) throw new Error('LOCAL_ATTENDANCE_ID_REQUIRED');
  if (!actorUserId) throw new Error('LOCAL_ATTENDANCE_ACTOR_REQUIRED');
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('LOCAL_ATTENDANCE_TIME_INVALID');
  const reference = adminDb.doc(localAttendancePath(storeId, attendanceId));

  return adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new Error('LOCAL_ATTENDANCE_NOT_FOUND');
    const current = parseLocalAttendanceSession(
      snapshot.data(),
      storeId,
      attendanceId
    );
    if (current.status === 'closed') return current;
    const closedAt = now.toISOString();
    const next: LocalAttendanceSession = {
      ...current,
      status: 'closed',
      updatedAt: closedAt,
      closedAt,
      closedByUserId: actorUserId,
    };
    transaction.set(reference, next);
    return next;
  });
};
