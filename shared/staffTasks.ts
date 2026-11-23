import type { StoreRole } from '../src/utils/storeSecurity';

export const STAFF_TASK_MAX_TITLE = 120;
export const STAFF_TASK_MAX_DETAILS = 2000;
export const STAFF_TASK_MAX_STEPS = 20;
export const STAFF_TASK_MAX_RESULTS = 100;
export const STAFF_TASK_MAX_TEAM = 120;

export type StaffChecklistStep = {
  id: string;
  label: string;
  completedAt: string;
  completedBy: string;
};
export type StaffChecklistTask = {
  id: string;
  canonicalStoreId: string;
  legacyStoreId: string;
  title: string;
  details: string;
  assignedTo: string;
  assignedRole: StoreRole;
  dueDate: string;
  steps: StaffChecklistStep[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string;
  version: number;
  status: 'open' | 'done';
};
export type StaffTaskAssignee = { userId: string; role: StoreRole; label: string };

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
export const safeStaffTaskId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{12,96}$/.test(value);
export const safeStaffTaskUserId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{3,128}$/.test(value);
export const validStaffDueDate = (value: unknown): value is string => {
  if (value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export const validateStaffTaskCreation = (input: {
  requestId: unknown; title: unknown; details: unknown;
  assignedTo: unknown; dueDate: unknown; steps: unknown;
}) => {
  const id = clean(input.requestId);
  const title = clean(input.title);
  const details = clean(input.details);
  const assignedTo = clean(input.assignedTo);
  const dueDate = clean(input.dueDate);
  if (!safeStaffTaskId(id) || !title || title.length > STAFF_TASK_MAX_TITLE ||
      details.length > STAFF_TASK_MAX_DETAILS ||
      !safeStaffTaskUserId(assignedTo) || !validStaffDueDate(dueDate) ||
      !Array.isArray(input.steps) || input.steps.length < 1 ||
      input.steps.length > STAFF_TASK_MAX_STEPS ||
      input.steps.some(step => typeof step !== 'string' ||
        !step.trim() || step.trim().length > 200)) {
    throw Error('STAFF_TASK_INVALID');
  }
  return { id, title, details, assignedTo, dueDate,
    steps: (input.steps as string[]).map(step => step.trim()) };
};

export const canAccessStaffTask = (
  actor: { uid: string; role: StoreRole },
  task: Pick<StaffChecklistTask, 'assignedTo'>
): boolean => actor.role === 'owner' || actor.role === 'manager' ||
  task.assignedTo === actor.uid;

export const canCompleteStaffTask = (
  actor: { uid: string; role: StoreRole },
  task: Pick<StaffChecklistTask, 'assignedTo'>
): boolean => task.assignedTo === actor.uid;
