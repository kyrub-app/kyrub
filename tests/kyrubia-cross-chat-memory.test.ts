import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { KyrubAiHistoricalLink } from '../shared/aiConsultant';
import {
  hasImmediateKyrubiaCrossChatDisambiguation,
  rebuildKyrubiaPendingCrossChatChoice,
  resolveKyrubiaPendingCrossChatChoice,
} from '../src/ai/crossConversationChoiceStore';
import {
  loadKyrubAiHistoricalLink,
  saveKyrubAiConversations,
  saveKyrubAiHistoricalLink,
  type KyrubAiLocalConversation,
} from '../src/ai/conversationStore';
import {
  isKyrubiaPureContinuationRequest,
  resolveKyrubiaCrossChatContinuation,
  resolveKyrubiaHistoricalLinkRecall,
} from '../src/ai/crossConversationMemory';

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

const conversation = (
  id: string,
  title: string,
  updatedAt: string,
  userMessages: string[],
  assistantMessages: string[] = []
): KyrubAiLocalConversation => ({
  id,
  title,
  topic: title,
  createdAt: updatedAt,
  updatedAt,
  messages: [
    ...userMessages.map((content, index) => ({
      id: `${id}-u-${index}`,
      role: 'user' as const,
      content,
      createdAt: updatedAt,
    })),
    ...assistantMessages.map((content, index) => ({
      id: `${id}-a-${index}`,
      role: 'assistant' as const,
      content,
      createdAt: updatedAt,
    })),
  ],
});

const histories = () => [
  conversation(
    'chat-stock',
    'Reposição automática de estoque',
    '2026-08-07T20:00:00.000Z',
    [
      'Quero organizar a reposição do estoque mínimo.',
      'Quando chegar no mínimo, quero comparar fornecedores antes de comprar.',
    ],
    ['Definimos cotação antes da compra e confirmação humana para fechar.']
  ),
  conversation(
    'chat-delivery',
    'Operação de delivery',
    '2026-08-07T19:00:00.000Z',
    ['Quero preparar minha loja para começar no delivery.'],
    ['Ainda faltam fotos e horários de atendimento.']
  ),
];

test('ordinary messages do not search other conversations', () => {
  const result = resolveKyrubiaCrossChatContinuation(
    'Quantos produtos tenho cadastrados?',
    histories(),
    'current'
  );
  assert.deepEqual(result, { kind: 'not_requested' });
});

test('explicit continuation resolves a clearly matching prior conversation', () => {
  const result = resolveKyrubiaCrossChatContinuation(
    'Vamos continuar aquela conversa sobre reposição de estoque.',
    histories(),
    'current'
  );

  assert.equal(result.kind, 'resolved');
  if (result.kind !== 'resolved') return;
  assert.equal(result.candidate.conversationId, 'chat-stock');
  assert.match(result.memoryContext, /Reposição automática de estoque/i);
  assert.match(result.memoryContext, /Contexto histórico apenas/i);
  assert.match(result.memoryContext, /não prova estado atual nem autoriza ações/i);
  assert.ok(result.memoryContext.length <= 230);
});

test('pure continuation can be acknowledged by Kyrub runtime without generative AI', () => {
  assert.equal(
    isKyrubiaPureContinuationRequest(
      'Continue aquela conversa sobre produtos sem imagem.'
    ),
    true
  );
  assert.equal(
    isKyrubiaPureContinuationRequest(
      'Continue aquela conversa e crie uma nota com os produtos.'
    ),
    false
  );
});

test('persisted historical link can identify which conversation is being continued without generative AI', () => {
  const link: KyrubAiHistoricalLink = {
    sourceConversationId: 'chat-stock',
    sourceTitle: 'Reposição automática de estoque',
    sourceTopic: 'Reposição automática de estoque',
    sourceUpdatedAt: '2026-08-07T20:00:00.000Z',
    linkedAt: '2026-08-08T09:01:00.000Z',
    memoryContext: 'Contexto histórico apenas.',
  };

  const reply = resolveKyrubiaHistoricalLinkRecall(
    'Qual conversa você retomou?',
    link
  );
  assert.match(reply ?? '', /Reposição automática de estoque/);
  assert.match(reply ?? '', /contexto histórico/i);
  assert.equal(
    resolveKyrubiaHistoricalLinkRecall('Quantos produtos tenho?', link),
    null
  );
});

test('generic continuation with multiple chats is ambiguous instead of guessed', () => {
  const result = resolveKyrubiaCrossChatContinuation(
    'Continue de onde paramos.',
    histories(),
    'current'
  );

  assert.equal(result.kind, 'ambiguous');
  if (result.kind !== 'ambiguous') return;
  assert.equal(result.candidates.length, 2);
  assert.match(result.reply, /mais de uma conversa/i);
  assert.match(result.reply, /Reposição automática de estoque/);
  assert.match(result.reply, /Operação de delivery/);
  assert.match(result.reply, /07\/08\/2026/);
  assert.match(result.reply, /Último contexto:/);
  assert.match(result.reply, /a primeira/i);
  assert.match(result.reply, /a segunda/i);
});

test('duplicate conversation titles include preview and message count for useful disambiguation', () => {
  const duplicateTitle = 'Quais são os três primeiros dessa lista?';
  const result = resolveKyrubiaCrossChatContinuation(
    'Continue de onde paramos.',
    [
      conversation(
        'chat-a',
        duplicateTitle,
        '2026-08-08T02:00:00.000Z',
        [duplicateTitle],
        ['Não tenho uma lista anterior nesta conversa para usar como referência.']
      ),
      conversation(
        'chat-b',
        duplicateTitle,
        '2026-08-07T23:00:00.000Z',
        [duplicateTitle, 'Liste meus produtos.'],
        ['Aqui estão 3 itens do catálogo.']
      ),
    ],
    'current'
  );

  assert.equal(result.kind, 'ambiguous');
  if (result.kind !== 'ambiguous') return;
  assert.match(result.reply, /1\. Quais são os três primeiros dessa lista\?/);
  assert.match(result.reply, /2 mensagens/);
  assert.match(result.reply, /3 mensagens/);
  assert.match(result.reply, /Não tenho uma lista anterior/);
  assert.match(result.reply, /Aqui estão 3 itens do catálogo/);
});

test('ordinal choice can be rebuilt from the immediately preceding ambiguity when auxiliary metadata is missing', () => {
  const now = new Date().toISOString();
  const prior = resolveKyrubiaCrossChatContinuation(
    'Continue de onde paramos.',
    histories(),
    'current'
  );
  assert.equal(prior.kind, 'ambiguous');
  if (prior.kind !== 'ambiguous') return;

  const messages = [
    {
      id: 'u-1',
      role: 'user' as const,
      content: 'Continue de onde paramos.',
      createdAt: now,
    },
    {
      id: 'a-1',
      role: 'assistant' as const,
      content: prior.reply,
      createdAt: now,
    },
    {
      id: 'u-2',
      role: 'user' as const,
      content: 'A primeira',
      createdAt: now,
    },
  ];

  assert.equal(hasImmediateKyrubiaCrossChatDisambiguation(messages), true);
  const rebuilt = rebuildKyrubiaPendingCrossChatChoice(
    messages,
    histories(),
    'current'
  );
  assert.deepEqual(
    rebuilt?.candidateConversationIds,
    ['chat-stock', 'chat-delivery']
  );

  const resolved = resolveKyrubiaPendingCrossChatChoice(
    'A primeira',
    rebuilt,
    histories(),
    'current'
  );
  assert.equal(resolved?.kind, 'resolved');
  if (resolved?.kind !== 'resolved') return;
  assert.equal(resolved.candidate.conversationId, 'chat-stock');
});

test('relative choice is rejected when ambiguity is stale or no longer immediately preceding', () => {
  const staleMessages = [
    {
      role: 'user' as const,
      content: 'Continue de onde paramos.',
      createdAt: '2000-01-01T00:00:00.000Z',
    },
    {
      role: 'assistant' as const,
      content: 'Encontrei mais de uma conversa que pode ser essa:\n1. A\n2. B',
      createdAt: '2000-01-01T00:00:01.000Z',
    },
    {
      role: 'user' as const,
      content: 'A primeira',
      createdAt: new Date().toISOString(),
    },
  ];
  assert.equal(hasImmediateKyrubiaCrossChatDisambiguation(staleMessages), false);
  assert.equal(
    rebuildKyrubiaPendingCrossChatChoice(staleMessages, histories(), 'current'),
    undefined
  );

  const interruptedMessages = [
    {
      role: 'user' as const,
      content: 'Continue de onde paramos.',
      createdAt: new Date().toISOString(),
    },
    {
      role: 'assistant' as const,
      content: 'Encontrei mais de uma conversa que pode ser essa:\n1. A\n2. B',
      createdAt: new Date().toISOString(),
    },
    {
      role: 'user' as const,
      content: 'Vamos falar de outra coisa.',
      createdAt: new Date().toISOString(),
    },
    {
      role: 'assistant' as const,
      content: 'Claro.',
      createdAt: new Date().toISOString(),
    },
    {
      role: 'user' as const,
      content: 'A primeira',
      createdAt: new Date().toISOString(),
    },
  ];
  assert.equal(
    hasImmediateKyrubiaCrossChatDisambiguation(interruptedMessages),
    false
  );
});

test('generic continuation resolves when exactly one prior conversation exists', () => {
  const only = histories().slice(0, 1);
  const result = resolveKyrubiaCrossChatContinuation(
    'Retome de onde paramos.',
    only,
    'current'
  );

  assert.equal(result.kind, 'resolved');
  if (result.kind !== 'resolved') return;
  assert.equal(result.candidate.conversationId, 'chat-stock');
});

test('unknown topic does not invent a source conversation', () => {
  const result = resolveKyrubiaCrossChatContinuation(
    'Continue aquela conversa sobre fotografia astronômica.',
    histories(),
    'current'
  );

  assert.equal(result.kind, 'not_found');
  if (result.kind !== 'not_found') return;
  assert.match(result.reply, /não encontrei/i);
});

test('current chat is never used as its own cross-chat memory source', () => {
  const result = resolveKyrubiaCrossChatContinuation(
    'Continue aquela conversa sobre reposição de estoque.',
    histories(),
    'chat-stock'
  );

  assert.equal(result.kind, 'not_found');
});

test('deleted conversations disappear naturally because only current stored histories are searched', () => {
  const withoutStock = histories().filter(item => item.id !== 'chat-stock');
  const result = resolveKyrubiaCrossChatContinuation(
    'Continue aquela conversa sobre reposição de estoque.',
    withoutStock,
    'current'
  );

  assert.equal(result.kind, 'not_found');
});

test('resolved historical link persists for the current chat and is invalidated if source chat is deleted', () => {
  const storage = new MemoryStorage();
  const uid = 'user-1';
  const source = histories()[0];
  const current = conversation(
    'current',
    'Nova solicitação',
    '2026-08-08T09:00:00.000Z',
    ['Continue aquela conversa sobre reposição de estoque.']
  );
  saveKyrubAiConversations(storage, uid, [current, source]);

  const link: KyrubAiHistoricalLink = {
    sourceConversationId: source.id,
    sourceTitle: source.title,
    sourceTopic: source.topic,
    sourceUpdatedAt: source.updatedAt,
    linkedAt: '2026-08-08T09:01:00.000Z',
    memoryContext:
      'Contexto histórico apenas; não prova estado atual nem autoriza ações.',
  };
  saveKyrubAiHistoricalLink(storage, uid, current.id, link);

  assert.deepEqual(
    loadKyrubAiHistoricalLink(storage, uid, current.id),
    link
  );

  saveKyrubAiConversations(storage, uid, [current]);
  assert.equal(
    loadKyrubAiHistoricalLink(storage, uid, current.id),
    undefined
  );
});

test('client rehydrates scoped historical link but never imports old turnContext', async () => {
  const client = await readFile(
    new URL('../src/ai/consultantClient.ts', import.meta.url),
    'utf8'
  );

  assert.match(client, /resolveKyrubiaCrossChatContinuation/);
  assert.match(client, /loadKyrubAiConversations\(localStorage, currentUser\.uid\)/);
  assert.match(client, /loadKyrubAiHistoricalLink/);
  assert.match(client, /saveKyrubAiHistoricalLink/);
  assert.match(client, /resolveKyrubiaHistoricalLinkRecall/);
  assert.match(client, /existingHistoricalLink\?\.memoryContext/);
  assert.match(client, /isKyrubiaPureContinuationRequest/);
  assert.match(client, /rebuildKyrubiaPendingCrossChatChoice/);
  assert.match(client, /hasImmediateKyrubiaCrossChatDisambiguation/);
  assert.doesNotMatch(client, /turnContext:\s*(crossChat|historical)/);
});