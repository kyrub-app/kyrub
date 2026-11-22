import { auth } from './firebase';
import type { StaffChecklistTask, StaffTaskAssignee } from '../../shared/staffTasks';

const base = '/api/staff/tasks';
const request = async <T>(path: string, body?: object): Promise<T> => {
  const user = auth.currentUser;
  if (!user) throw Error('Entre novamente para acessar as tarefas da equipe.');
  const authorization = 'Bearer ' + await user.getIdToken();
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      authorization, accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? {body: JSON.stringify(body)} : {}),
    cache: 'no-store',
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as {error?: string};
    throw Error(payload.error || 'Não foi possível concluir esta operação.');
  }
  return response.json() as Promise<T>;
};
const scope = (storeId: string) => '?storeId=' + encodeURIComponent(storeId);

export const listStaffChecklistTasks = async (storeId: string) =>
  (await request<{ tasks: StaffChecklistTask[] }>(scope(storeId))).tasks;

export const listStaffTaskAssignees = async (storeId: string) =>
  (await request<{ assignees: StaffTaskAssignee[] }>('/assignees' + scope(storeId))).assignees;

export const createStaffChecklistTask = async (input: {
  storeId: string; requestId: string; title: string; details: string;
  assignedTo: string; dueDate: string; steps: string[];
}) => (await request<{ task: StaffChecklistTask }>('', input)).task;

export const setStaffChecklistStep = async (input: {
  storeId: string; requestId: string; taskId: string;
  stepId: string; completed: boolean; expectedVersion: number;
}) => (await request<{ task: StaffChecklistTask }>('/step', input)).task;
