import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  KYRUB_ACTION_REGISTRY,
  KYRUB_ACTION_TYPES,
  KYRUB_PLANNED_ERP_ACTION_TYPES,
  type KyrubAiCreateTaskProposal,
} from '../shared/kyrubActions';
import { resolveKyrubiaDeterministicTask } from '../shared/kyrubiaDeterministicTask';
import { evaluateKyrubActionPolicy } from '../server/actions/kyrubiaPolicyEngine';

const source = (relativePath: string): string =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('explicit task request produces a deterministic task without inventing a reminder time', () => {
  const result = resolveKyrubiaDeterministicTask(
    'Crie uma tarefa para revisar o estoque amanhã.',
    new Date(2026, 7, 12, 23, 7)
  );

  assert.ok(result);
  assert.equal(result.taskDraft.title, 'revisar o estoque amanhã');
  assert.equal(result.taskDraft.content, 'revisar o estoque amanhã');
  assert.equal(result.taskDraft.reminderDateTime, null);
  assert.match(result.reply, /Revise e confirme/);
});

test('explicit tomorrow time becomes an exact local reminder and is removed only from the display title', () => {
  const result = resolveKyrubiaDeterministicTask(
    'Crie uma tarefa para revisar o estoque amanhã às 9h.',
    new Date(2026, 7, 12, 23, 7)
  );

  assert.ok(result);
  assert.equal(result.taskDraft.title, 'revisar o estoque');
  assert.equal(result.taskDraft.content, 'revisar o estoque amanhã às 9h');
  assert.equal(result.taskDraft.reminderDateTime, '2026-08-13T09:00');
});

test('explicit minutes are preserved and invalid or creative requests are not guessed', () => {
  const result = resolveKyrubiaDeterministicTask(
    'Adicione uma tarefa para ligar para o fornecedor hoje às 18h30',
    new Date(2026, 7, 12, 10, 0)
  );
  assert.ok(result);
  assert.equal(result.taskDraft.title, 'ligar para o fornecedor');
  assert.equal(result.taskDraft.reminderDateTime, '2026-08-12T18:30');

  assert.equal(
    resolveKyrubiaDeterministicTask(
      'Crie uma tarefa com base no que conversamos para melhorar minhas vendas.'
    ),
    null
  );
  assert.equal(
    resolveKyrubiaDeterministicTask('Como eu crio uma tarefa no Kyrub?'),
    null
  );
});

test('create_task is active low-risk write and is no longer merely planned', () => {
  assert.equal(KYRUB_ACTION_TYPES.CREATE_TASK, 'create_task');
  assert.equal('CREATE_TASK' in KYRUB_PLANNED_ERP_ACTION_TYPES, false);
  assert.deepEqual(KYRUB_ACTION_REGISTRY.create_task, {
    type: 'create_task',
    mode: 'write',
    risk: 'low',
    requiresConfirmation: true,
    permission: 'tasks.write',
    maxAffectedEntities: 1,
  });
});

test('policy refuses task creation before confirmation and allows the same user-intent proposal after confirmation', () => {
  const proposal: KyrubAiCreateTaskProposal = {
    id: 'task-proposal-1',
    type: 'create_task',
    title: 'Revisar estoque',
    content: 'Revisar estoque amanhã',
    reminderDateTime: null,
    requiresConfirmation: true,
    origin: 'kyrubia',
    risk: 'low',
    inputProvenance: 'user_intent',
    impact: { entityCount: 1, reversibility: 'easy' },
  };

  const beforeConfirmation = evaluateKyrubActionPolicy(proposal, {
    actorUid: 'owner-1',
    permissions: ['tasks.write'],
    confirmed: false,
    decisionId: 'decision-before',
  });
  assert.equal(beforeConfirmation.outcome, 'require_confirmation');
  assert.ok(beforeConfirmation.reasons.includes('CONFIRMATION_REQUIRED'));

  const afterConfirmation = evaluateKyrubActionPolicy(proposal, {
    actorUid: 'owner-1',
    permissions: ['tasks.write'],
    confirmed: true,
    decisionId: 'decision-after',
  });
  assert.equal(afterConfirmation.outcome, 'allow');
  assert.deepEqual(afterConfirmation.reasons, []);
});

test('consultant clients resolve explicit tasks before ERP, plan hydration, auth token and provider fetch', () => {
  const client = source('../src/ai/consultantClient.ts');
  const resolver = client.indexOf('resolveKyrubiaDeterministicTask(');
  const erpRead = client.indexOf('readKyrubErpContext(currentUser)');
  const token = client.indexOf('currentUser.getIdToken()');
  const network = client.indexOf('fetch(endpoint');

  assert.ok(resolver >= 0);
  assert.ok(resolver < erpRead);
  assert.ok(resolver < token);
  assert.ok(resolver < network);
  assert.match(client, /type: 'create_task'/);
  assert.match(client, /inputProvenance: 'user_intent'/);
  assert.match(client, /kyrub-task-runtime-v1/);

  const planClient = source('../src/ai/consultantClientWithPlans.ts');
  const planResolver = planClient.indexOf('resolveKyrubiaDeterministicTask(');
  const planHydration = planClient.indexOf('hydrateActivePlanCatalog(signal)');
  const planKnowledge = planClient.indexOf('resolveKyrubiaActivePlanKnowledge(latestContent)');
  assert.ok(planResolver >= 0);
  assert.ok(planResolver < planHydration);
  assert.ok(planResolver < planKnowledge);
  assert.match(planClient, /'create_task'/);
});

test('proposal gate and dedicated bridge preserve review before execution', () => {
  const events = source('../src/ai/actionEvents.ts');
  const bridge = source('../src/components/KyrubAiTaskActionBridge.tsx');
  const app = source('../src/App.tsx');

  assert.match(events, /case 'create_task'/);
  assert.match(events, /value\.requiresConfirmation === true/);
  assert.match(bridge, /detail\.proposal\.type !== 'create_task'/);
  assert.match(bridge, /executeKyrubAction\(user, pending\.proposal, true\)/);
  assert.match(bridge, /Nada será salvo antes da confirmação/);
  assert.match(bridge, /Cancelar/);
  assert.match(bridge, /Confirmar/);
  assert.match(app, /<KyrubAiTaskActionBridge \/>/);
});

test('task executor uses the existing action gateway, owner-scoped productivity path and authoritative receipt', () => {
  const facade = source('../server/actions/actionExecutionFacade.ts');
  const executor = source('../server/actions/taskCreationExecutionService.ts');
  const api = source('../api/action-execute.ts');

  assert.match(facade, /isKyrubTaskCreationExecutionRequest/);
  assert.match(facade, /executeAuthorizedKyrubTaskCreation/);
  assert.match(api, /actionExecutionFacade/);
  assert.match(executor, /users\/\$\{actor\.uid\}\/tasks\/\$\{taskId\}/);
  assert.match(executor, /permissions: \['tasks\.write'\]/);
  assert.match(executor, /confirmed/);
  assert.match(executor, /targetType: 'task'/);
  assert.match(executor, /kyrub_action_receipts/);
  assert.match(executor, /sharedWith: \[\]/);
  assert.doesNotMatch(executor, /collection\('stores'\)/);
});

test('task success is labeled as task and carries receipt pointers for post-reload authoritative recall', () => {
  const actionService = source('../src/actions/kyrubActionService.ts');
  const rehydration = source('../src/observability/kyrubAuthoritativeReceiptRehydration.ts');

  assert.match(actionService, /proposal\.type === 'create_task'\) return 'task'/);
  assert.match(actionService, /execution_id: executionId/);
  assert.match(actionService, /proposal_id: proposalId/);
  assert.match(rehydration, /verifyKyrubActionReceipt/);
  assert.match(rehydration, /verified\.entityType/);
});
