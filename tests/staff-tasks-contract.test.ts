import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  canAccessStaffTask, canCompleteStaffTask,
  safeStaffTaskId, validStaffDueDate,
  validateStaffTaskCreation,
} from '../shared/staffTasks';

const base = {
  requestId: 'task_request_12345678',
  title: 'Abertura da loja',
  details: 'Antes de iniciar as vendas',
  assignedTo: 'staff_user_123456',
  dueDate: '2026-12-10',
  steps: ['Conferir sistema', 'Organizar balcão'],
};

test('task validation requires an explicit active assignee, calendar date and bounded checklist', () => {
  assert.deepEqual(validateStaffTaskCreation(base), {
    id: base.requestId, title: base.title, details: base.details,
    assignedTo: base.assignedTo, dueDate: base.dueDate, steps: base.steps,
  });
  assert.equal(validStaffDueDate(''), true);
  assert.equal(validStaffDueDate('2026-02-30'), false);
  assert.equal(validStaffDueDate('2026-02-28'), true);
  assert.equal(safeStaffTaskId('../users/secret'), false);
  for(const bad of [
    {...base, requestId: 'x'},
    {...base, title: ''},
    {...base, title: 'x'.repeat(121)},
    {...base, details: 'x'.repeat(2001)},
    {...base, assignedTo: '../other'},
    {...base, dueDate: '2026-13-01'},
    {...base, steps: []},
    {...base, steps: Array(21).fill('Step')},
    {...base, steps: ['']},
    {...base, steps: ['x'.repeat(201)]},
  ]) assert.throws(() => validateStaffTaskCreation(bad));
});

test('only the assigned user completes steps; managers can read but not impersonate staff', () => {
  const task = {assignedTo:'employee_123456'};
  assert.equal(canAccessStaffTask({uid:'employee_123456',role:'seller'},task),true);
  assert.equal(canCompleteStaffTask({uid:'employee_123456',role:'seller'},task),true);
  assert.equal(canAccessStaffTask({uid:'unrelated',role:'seller'},task),false);
  assert.equal(canCompleteStaffTask({uid:'unrelated',role:'manager'},task),false);
  assert.equal(canAccessStaffTask({uid:'manager',role:'manager'},task),true);
});

test('task mutations use canonical store, transaction rechecks, audit and server notifications', () => {
  const service = readFileSync('server/staff/staffTaskService.ts','utf8');
  const transport = readFileSync('server/staff/staffTaskTransport.ts','utf8');
  const health = readFileSync('api/health.ts','utf8');
  const vercel = readFileSync('vercel.json','utf8');
  const server = readFileSync('server.ts','utf8');
  const menu = readFileSync('src/components/store/StoreStaffCentralWorkspace.tsx','utf8');
  const manager = readFileSync('src/components/store/StoreStaffTasksManager.tsx','utf8');
  const inbox = readFileSync('src/components/store/StoreStaffTasksInbox.tsx','utf8');
  const point = readFileSync('src/components/LegacyRetailerPanel.tsx','utf8');
  const client = readFileSync('src/utils/staffTasks.ts','utf8');
  assert.match(service,/resolveStaffActor/);
  assert.match(service,/recheckActor\(actor, tx\)/);
  assert.match(service,/member\.status !== 'active'/);
  assert.match(service,/canCompleteStaffTask\(actor, task\)/);
  assert.match(service,/tx\.create\(requestRef,/);
  assert.match(service,/collection\('history'\)/);
  assert.match(service,/STAFF_TASK_VERSION_CONFLICT/);
  assert.match(service,/buildUserNotification/);
  assert.match(transport,/private, no-store/);
  assert.match(transport,/listAuthorizedStaffTaskAssignees/);
  assert.match(health,/transport === 'staff-tasks'/);
  assert.match(vercel,/transport=staff-tasks/);
  assert.match(server,/createStaffTaskRouter\(\)/);
  assert.match(menu,/<StoreStaffTasksManager storeId=\{storeId\}/);
  assert.match(manager,/createStaffChecklistTask/);
  assert.match(inbox,/setStaffChecklistStep/);
  assert.match(point,/<StoreStaffTasksInbox storeId=\{activeRetailerId\}/);
  assert.doesNotMatch(client,/setDoc\(|updateDoc\(|addDoc\(/);
});
