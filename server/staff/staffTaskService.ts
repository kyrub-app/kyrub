import { createHash } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import { parseStoreMember, STORE_ROLE_LABELS, type StoreRole } from '../../src/utils/storeSecurity.js';
import { buildUserNotification, userNotificationPath } from '../../shared/userNotifications.js';
import {
  STAFF_TASK_MAX_RESULTS, STAFF_TASK_MAX_TEAM,
  canAccessStaffTask, canCompleteStaffTask, safeStaffTaskId,
  validateStaffTaskCreation,
  type StaffChecklistTask, type StaffTaskAssignee,
} from '../../shared/staffTasks.js';
import { resolveStaffActor,recheckStaffActor } from './staffNoticeService.js';

type Actor = Awaited<ReturnType<typeof resolveStaffActor>>;
const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const tasksFor = (actor: Actor) =>
  adminDb.collection('stores/' + actor.canonicalStoreId + '/staffTasks');
const managerOnly = (actor: Actor): void => {
  if (actor.role !== 'owner' && actor.role !== 'manager') throw Error('STAFF_TASK_FORBIDDEN');
};
const recheckActor = async (
  actor: Actor, tx: FirebaseFirestore.Transaction
): Promise<void> => {
  await recheckStaffActor(actor,tx,'STAFF_TASK_FORBIDDEN');
  const store = await tx.get(adminDb.doc('stores/' + actor.canonicalStoreId));
  if (!store.exists || clean(store.get('ownerId')) !== actor.legacyStoreId) {
    throw Error('STAFF_TASK_FORBIDDEN');
  }
  if (actor.role === 'owner') return;
  const snap = await tx.get(adminDb.doc(
    'stores/' + actor.canonicalStoreId + '/members/' + actor.uid
  ));
  const member = parseStoreMember(snap.data());
  if (!member || member.userId !== actor.uid ||
      member.storeId !== actor.canonicalStoreId || member.status !== 'active' ||
      member.role !== actor.role) throw Error('STAFF_TASK_FORBIDDEN');
};

export const listAuthorizedStaffTaskAssignees = async (input: {
  authorization: string; legacyStoreId: string;
}): Promise<StaffTaskAssignee[]> => {
  const actor = await resolveStaffActor(input.authorization, input.legacyStoreId);
  managerOnly(actor);
  const snap = await adminDb.collection('stores/' + actor.canonicalStoreId + '/members')
    .where('status', '==', 'active').limit(STAFF_TASK_MAX_TEAM + 1).get();
  if (snap.size > STAFF_TASK_MAX_TEAM) throw Error('STAFF_TASK_TEAM_LIMIT');
  const members = snap.docs.flatMap(doc => {
    const member = parseStoreMember(doc.data());
    if (!member || member.userId !== doc.id ||
        member.storeId !== actor.canonicalStoreId || member.status !== 'active'||member.role==='owner') return [];
    return [{
      userId: doc.id, role: member.role,
      label: STORE_ROLE_LABELS[member.role] + ' · ' + doc.id.slice(0, 8),
    }];
  });
  return [{ userId: actor.legacyStoreId, role: 'owner' as const, label: 'Proprietário' }, ...members];
};

export const listAuthorizedStaffTasks = async (input: {
  authorization: string; legacyStoreId: string;
}): Promise<StaffChecklistTask[]> => {
  const actor = await resolveStaffActor(input.authorization, input.legacyStoreId);
  // For individual staff, query by assignee before the result limit.
  // Otherwise another employee's tasks could hide their assigned checklist.
  const manager = actor.role === 'owner' || actor.role === 'manager';
  const snap = await (manager
    ? tasksFor(actor).orderBy('createdAt', 'desc')
    : tasksFor(actor).where('assignedTo', '==', actor.uid))
    .limit(STAFF_TASK_MAX_RESULTS).get();
  return snap.docs.map(doc => ({ doc, task: doc.data() as StaffChecklistTask }))
    .filter(({ doc, task }) =>
      safeStaffTaskId(task.id) && task.id === doc.id &&
      task.canonicalStoreId === actor.canonicalStoreId &&
      task.legacyStoreId === actor.legacyStoreId &&
      canAccessStaffTask(actor, task)
    ).map(({task}) => task)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

export const createAuthorizedStaffTask = async (input: {
  authorization: string; legacyStoreId: string;
  requestId: unknown; title: unknown; details: unknown;
  assignedTo: unknown; dueDate: unknown; steps: unknown;
}): Promise<StaffChecklistTask> => {
  const actor = await resolveStaffActor(input.authorization, input.legacyStoreId);
  managerOnly(actor);
  const data = validateStaffTaskCreation(input);
  const doc = tasksFor(actor).doc(data.id);
  const hash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  const now = new Date().toISOString();
  return adminDb.runTransaction(async tx => {
    const existing = await tx.get(doc);
    await recheckActor(actor, tx);
    if (existing.exists) {
      const original = existing.data() as StaffChecklistTask;
      if (existing.get('creationHash') !== hash ||
          original.createdBy !== actor.uid ||
          original.canonicalStoreId !== actor.canonicalStoreId) {
        throw Error('STAFF_TASK_IDEMPOTENCY_CONFLICT');
      }
      // Keep internal deduplication metadata out of the API response.
      const { creationHash: _internal, ...task } = existing.data() as
        StaffChecklistTask & { creationHash: string };
      return task;
    }
    let role: StoreRole;
    if (data.assignedTo === actor.legacyStoreId) role = 'owner';
    else {
      const membership = await tx.get(adminDb.doc(
        'stores/' + actor.canonicalStoreId + '/members/' + data.assignedTo
      ));
      const member = parseStoreMember(membership.data());
      if (!member || member.userId !== data.assignedTo ||
          member.storeId !== actor.canonicalStoreId ||
          member.status !== 'active'||member.role==='owner') throw Error('STAFF_TASK_ASSIGNEE_INVALID');
      role = member.role;
    }
    const task: StaffChecklistTask = {
      id: data.id, canonicalStoreId: actor.canonicalStoreId,
      legacyStoreId: actor.legacyStoreId, title: data.title,
      details: data.details, assignedTo: data.assignedTo, assignedRole: role,
      dueDate: data.dueDate,
      steps: data.steps.map((label, index) => ({
        id: String(index + 1), label, completedAt: '', completedBy: '',
      })),
      createdBy: actor.uid, createdAt: now, updatedAt: now,
      completedAt: '', status: 'open', version: 1,
    };
    tx.create(doc, { ...task, creationHash: hash });
    if (data.assignedTo !== actor.uid) {
      const notification = buildUserNotification({
        recipientUserId: data.assignedTo,
        category: 'system', eventType: 'staff_task_assigned',
        sourceId: actor.canonicalStoreId + '_' + data.id,
        actorPrincipalId: actor.uid,
        title: 'Nova tarefa da equipe: ' + data.title,
        body: 'Abra o Painel da Loja → Ponto → Tarefas para conferir seu checklist.',
        target: { kind: 'none', storeId: actor.canonicalStoreId },
        createdAt: now,
      });
      tx.set(adminDb.doc(userNotificationPath(data.assignedTo, notification.id)), notification);
    }
    return task;
  });
};

export const setAuthorizedStaffTaskStep = async (input: {
  authorization: string; legacyStoreId: string;
  taskId: unknown; stepId: unknown; completed: unknown;
  expectedVersion: unknown; requestId: unknown;
}): Promise<StaffChecklistTask> => {
  const actor = await resolveStaffActor(input.authorization, input.legacyStoreId);
  const taskId = clean(input.taskId);
  const stepId = clean(input.stepId);
  const requestId = clean(input.requestId);
  if (!safeStaffTaskId(taskId) || !safeStaffTaskId(requestId) ||
      !/^([1-9]|1[0-9]|20)$/.test(stepId) ||
      typeof input.completed !== 'boolean' ||
      typeof input.expectedVersion !== 'number' ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1) throw Error('STAFF_TASK_INVALID');
  const ref = tasksFor(actor).doc(taskId);
  const requestRef = ref.collection('stepRequests').doc(requestId);
  const hash = createHash('sha256').update(
    JSON.stringify({taskId, stepId, completed: input.completed})
  ).digest('hex');
  return adminDb.runTransaction(async tx => {
    const [doc, previous] = await Promise.all([tx.get(ref), tx.get(requestRef)]);
    await recheckActor(actor, tx);
    const task = doc.data() as StaffChecklistTask | undefined;
    if (!task || task.canonicalStoreId !== actor.canonicalStoreId ||
        task.legacyStoreId !== actor.legacyStoreId ||
        !canCompleteStaffTask(actor, task)) throw Error('STAFF_TASK_NOT_FOUND');
    if (previous.exists) {
      if (previous.get('hash') !== hash ||
          previous.get('userId') !== actor.uid) throw Error('STAFF_TASK_IDEMPOTENCY_CONFLICT');
      return task;
    }
    const index = task.steps.findIndex(s => s.id === stepId);
    if (index < 0) throw Error('STAFF_TASK_INVALID');
    const alreadyCompleted = Boolean(task.steps[index].completedAt);
    if (alreadyCompleted === input.completed) return task;
    if (task.version !== input.expectedVersion) throw Error('STAFF_TASK_VERSION_CONFLICT');
    const now = new Date().toISOString();
    const steps = task.steps.map((step, i) => i === index ? {
      ...step,
      completedAt: input.completed ? now : '',
      completedBy: input.completed ? actor.uid : '',
    } : step);
    const allDone = steps.every(step => Boolean(step.completedAt));
    const next: StaffChecklistTask = {
      ...task, steps, version: task.version + 1, updatedAt: now,
      status: allDone ? 'done' : 'open', completedAt: allDone ? now : '',
    };
    tx.update(ref, { steps, version: next.version, updatedAt: now,
      status: next.status, completedAt: next.completedAt });
    tx.create(requestRef, {
      hash, userId: actor.uid, requestId, taskId, stepId,
      completed: input.completed, createdAt: now,
    });
    tx.create(ref.collection('history').doc(requestId), {
      userId: actor.uid, taskId, stepId, completed: input.completed,
      version: next.version, createdAt: now,
    });
    return next;
  });
};
