import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildKyrubiaObjectiveContext,
  resolveKyrubiaObjectiveCommand,
} from '../src/ai/objectiveMemory';
import {
  inheritKyrubiaConversationObjective,
  loadKyrubiaConversationObjective,
  resolveKyrubiaObjectiveRuntime,
} from '../src/ai/objectiveRuntimeService';
import {
  listActiveKyrubiaObjectives,
  loadKyrubiaObjectives,
} from '../src/ai/objectiveStore';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

test('generic wants do not silently become durable objectives', () => {
  assert.equal(resolveKyrubiaObjectiveCommand('Quero uma pizza.'), null);
  assert.equal(
    resolveKyrubiaObjectiveCommand('Preciso trocar o óleo da minha moto.'),
    null
  );
});

test('explicit objective declaration creates and links an active objective deterministically', () => {
  const storage = new MemoryStorage();
  const result = resolveKyrubiaObjectiveRuntime(
    storage,
    'user-1',
    'chat-products',
    'Meu objetivo é deixar meus produtos com imagem.'
  );

  assert.ok(result);
  assert.match(result?.reply ?? '', /Objetivo ativo registrado/i);
  assert.match(result?.reply ?? '', /não autoriza ações/i);
  assert.doesNotMatch(result?.reply ?? '', /”\./);

  const linked = loadKyrubiaConversationObjective(
    storage,
    'user-1',
    'chat-products'
  );
  assert.ok(linked);
  assert.equal(linked?.status, 'active');
  assert.equal(linked?.statement, 'deixar meus produtos com imagem.');
  assert.deepEqual(linked?.scope, { kind: 'own_store', storeId: null });
});

test('objective next step and progress survive reload through user-scoped storage', () => {
  const storage = new MemoryStorage();
  resolveKyrubiaObjectiveRuntime(
    storage,
    'user-1',
    'chat-delivery',
    'Meu objetivo é preparar minha loja para delivery.'
  );

  const next = resolveKyrubiaObjectiveRuntime(
    storage,
    'user-1',
    'chat-delivery',
    'Próximo passo do objetivo: completar as imagens do catálogo.'
  );
  assert.match(next?.reply ?? '', /Próximo passo registrado/i);
  assert.doesNotMatch(next?.reply ?? '', /\.\./);

  const progress = resolveKyrubiaObjectiveRuntime(
    storage,
    'user-1',
    'chat-delivery',
    'Registre no progresso do objetivo: identificamos três produtos sem imagem.'
  );
  assert.match(progress?.reply ?? '', /Progresso registrado/i);
  assert.doesNotMatch(progress?.reply ?? '', /\.\./);

  const reloaded = loadKyrubiaConversationObjective(
    storage,
    'user-1',
    'chat-delivery'
  );
  assert.equal(reloaded?.nextStep, 'completar as imagens do catálogo.');
  assert.equal(reloaded?.progress.length, 1);
  assert.match(reloaded?.progress[0]?.summary ?? '', /três produtos sem imagem/i);

  const status = resolveKyrubiaObjectiveRuntime(
    storage,
    'user-1',
    'chat-delivery',
    'Como estamos com o objetivo?'
  );
  assert.match(status?.reply ?? '', /Objetivo ativo/i);
  assert.match(status?.reply ?? '', /três produtos sem imagem/i);
  assert.match(status?.reply ?? '', /completar as imagens do catálogo/i);
  assert.doesNotMatch(status?.reply ?? '', /”\./);
});

test('resuming a conversation can inherit the same active objective instead of copying it', () => {
  const storage = new MemoryStorage();
  resolveKyrubiaObjectiveRuntime(
    storage,
    'user-1',
    'source-chat',
    'Meu objetivo é organizar a reposição do meu estoque.'
  );

  const source = loadKyrubiaConversationObjective(
    storage,
    'user-1',
    'source-chat'
  );
  const inherited = inheritKyrubiaConversationObjective(
    storage,
    'user-1',
    'source-chat',
    'target-chat'
  );
  const target = loadKyrubiaConversationObjective(
    storage,
    'user-1',
    'target-chat'
  );

  assert.ok(source);
  assert.equal(inherited?.id, source?.id);
  assert.equal(target?.id, source?.id);
});

test('completed objective remains historical but is no longer active or inherited', () => {
  const storage = new MemoryStorage();
  resolveKyrubiaObjectiveRuntime(
    storage,
    'user-1',
    'source-chat',
    'Meu objetivo é revisar meu catálogo.'
  );

  const completed = resolveKyrubiaObjectiveRuntime(
    storage,
    'user-1',
    'source-chat',
    'Marque o objetivo como concluído.'
  );
  assert.match(completed?.reply ?? '', /marcado como concluído/i);
  assert.equal(listActiveKyrubiaObjectives(storage, 'user-1').length, 0);
  assert.equal(
    inheritKyrubiaConversationObjective(
      storage,
      'user-1',
      'source-chat',
      'target-chat'
    ),
    undefined
  );

  const historical = loadKyrubiaConversationObjective(
    storage,
    'user-1',
    'source-chat'
  );
  assert.equal(historical?.status, 'completed');
});

test('objectives have their own lifecycle and are not stored inside conversation history', () => {
  const storage = new MemoryStorage();
  resolveKyrubiaObjectiveRuntime(
    storage,
    'user-1',
    'chat-that-may-be-deleted',
    'Meu objetivo é organizar meu trabalho.'
  );

  const before = loadKyrubiaObjectives(storage, 'user-1');
  assert.equal(before.length, 1);
  assert.equal(before[0]?.sourceConversationId, 'chat-that-may-be-deleted');

  storage.removeItem('kyrub_ai_conversations_v1:user-1');
  const after = loadKyrubiaObjectives(storage, 'user-1');
  assert.equal(after.length, 1);
  assert.equal(after[0]?.id, before[0]?.id);
});

test('objective context is compact and explicitly non-authoritative', () => {
  const storage = new MemoryStorage();
  resolveKyrubiaObjectiveRuntime(
    storage,
    'user-1',
    'chat-context',
    'Meu objetivo é deixar meus produtos com imagem.'
  );
  resolveKyrubiaObjectiveRuntime(
    storage,
    'user-1',
    'chat-context',
    'Registre no progresso do objetivo: três produtos continuam sem imagem.'
  );

  const objective = loadKyrubiaConversationObjective(
    storage,
    'user-1',
    'chat-context'
  );
  const context = buildKyrubiaObjectiveContext(objective);
  assert.ok(context);
  assert.ok((context?.length ?? 0) <= 220);
  assert.match(context ?? '', /não autoriza ações/i);
  assert.match(context ?? '', /nem prova estado atual/i);
});

test('consultant client resolves objective commands before ERP and forwards objective context only as context', async () => {
  const client = await readFile(
    new URL('../src/ai/consultantClient.ts', import.meta.url),
    'utf8'
  );

  const objectiveRuntimeIndex = client.indexOf('const objectiveRuntime =');
  const erpReadIndex = client.indexOf('let erpContext =');
  assert.ok(objectiveRuntimeIndex >= 0);
  assert.ok(erpReadIndex > objectiveRuntimeIndex);
  assert.match(client, /inheritKyrubiaConversationObjective/);
  assert.match(client, /describeKyrubiaConversationObjective/);
  assert.match(
    client,
    /structuredReference,\s*objectiveContext,\s*historicalContext/
  );
  assert.doesNotMatch(client, /objectiveContext:\s*requestForServer/);
});

test('constitution states that active objectives are intent memory, not authorization', async () => {
  const constitution = await readFile(
    new URL('../docs/kyrubia-constitution-v1.md', import.meta.url),
    'utf8'
  );

  assert.match(
    constitution,
    /Objetivos ativos representam intenção estruturada, não autorização/i
  );
  assert.match(constitution, /Objetivo não é tarefa executada, promessa, autorização/i);
  assert.match(constitution, /ciclo de vida próprio/i);
});
