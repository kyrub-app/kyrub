import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveKyrubiaTrustedReadRuntime } from '../src/ai/trustedReadRuntime';
import {
  clearAuthoritativeActivityRuntimeEvents,
  rememberAuthoritativeActivityRuntimeEvent,
} from '../src/observability/kyrubAuthoritativeActivityRuntime';
import {
  recordKyrubActivityEvent,
  type KyrubActivityStorage,
} from '../src/observability/kyrubActivityLog';

class MemoryStorage implements KyrubActivityStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

test('exact human follow-up "O q fizemos agora?" stays deterministic and names create_task naturally', () => {
  clearAuthoritativeActivityRuntimeEvents();
  const storage = new MemoryStorage();

  recordKyrubActivityEvent(storage, 'user-1', {
    type: 'interaction.action_attempted',
    domain: 'kyrubia',
    source: 'client_observation',
    screenId: 'home:kyrub',
    actionId: 'create_task',
    entityType: 'task',
    metadata: { proposal_id: 'task-proposal-1' },
  }, new Date('2026-08-13T09:45:00.000Z'));

  recordKyrubActivityEvent(storage, 'user-1', {
    type: 'result.action_succeeded',
    domain: 'kyrubia',
    source: 'authoritative_write_ack',
    screenId: 'home:kyrub',
    actionId: 'create_task',
    entityType: 'task',
    entityId: 'kyrubia-task-task-proposal-1',
    metadata: {
      execution_id: `exec_${'a'.repeat(40)}`,
      proposal_id: 'task-proposal-1',
    },
  }, new Date('2026-08-13T09:45:01.000Z'));

  // Simulate the post-reload runtime proof rebuilt from the server receipt. Its
  // event id is intentionally different from the editable browser event id.
  rememberAuthoritativeActivityRuntimeEvent({
    schemaVersion: 1,
    id: `server-confirmed:exec_${'a'.repeat(40)}`,
    actorUid: 'user-1',
    type: 'result.action_succeeded',
    domain: 'kyrubia',
    source: 'server_confirmed',
    authority: 'confirmed_result',
    occurredAt: '2026-08-13T09:45:02.000Z',
    actionId: 'create_task',
    entityType: 'task',
    entityId: 'kyrubia-task-task-proposal-1',
  });

  const result = resolveKyrubiaTrustedReadRuntime(
    storage,
    'user-1',
    'O q fizemos agora?'
  );

  assert.equal(result?.kind, 'recent_activity');
  assert.match(result?.reply ?? '', /criar uma tarefa pela Kyrubia/i);
  assert.match(result?.reply ?? '', /O Kyrub confirmou nesta sessão/i);
  assert.doesNotMatch(result?.reply ?? '', /executar create_task/i);
  clearAuthoritativeActivityRuntimeEvents();
});

test('collaborative recent-action variants are recognized without generative fallback', () => {
  const storage = new MemoryStorage();
  recordKyrubActivityEvent(storage, 'user-1', {
    type: 'interaction.action_attempted',
    domain: 'kyrubia',
    source: 'client_observation',
    actionId: 'create_task',
  });

  for (const message of [
    'O que fizemos agora?',
    'O que acabamos de fazer?',
    'O que a gente fez agora?',
  ]) {
    assert.equal(
      resolveKyrubiaTrustedReadRuntime(storage, 'user-1', message)?.kind,
      'recent_activity'
    );
  }
});

test('trusted recent-action read remains before the generative provider fallback', () => {
  const wrapper = readFileSync(
    new URL('../src/ai/consultantClientWithPlans.ts', import.meta.url),
    'utf8'
  );
  const trustedRead = wrapper.indexOf('const trustedRead =');
  const trustedReturn = wrapper.indexOf('if (trustedRead)');
  const finalProviderFallback = wrapper.lastIndexOf('return requestLegacyKyrubAiConsultant(');

  assert.ok(trustedRead >= 0);
  assert.ok(trustedReturn > trustedRead);
  assert.ok(finalProviderFallback > trustedReturn);
});
