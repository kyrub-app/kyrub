import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { KyrubAiLocalConversation } from '../src/ai/conversationStore';
import { resolveKyrubiaCrossChatContinuation } from '../src/ai/crossConversationMemory';

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

test('client uses local same-user history only for explicit continuation and does not import old turnContext', async () => {
  const client = await readFile(
    new URL('../src/ai/consultantClient.ts', import.meta.url),
    'utf8'
  );

  assert.match(client, /resolveKyrubiaCrossChatContinuation/);
  assert.match(client, /loadKyrubAiConversations\(localStorage, currentUser\.uid\)/);
  assert.match(client, /crossChatResolution\.kind === 'resolved'/);
  assert.match(client, /crossChatResolution\.memoryContext/);
  assert.match(client, /appendStructuredReferenceContext\([\s\S]*crossChatContext/);
  assert.doesNotMatch(client, /turnContext:\s*crossChat/);
});
