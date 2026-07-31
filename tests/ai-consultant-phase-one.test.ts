import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createKyrubAiConversation,
  createKyrubAiMessage,
  loadKyrubAiConversations,
  saveKyrubAiConversations,
  titleFromFirstRequest,
} from '../src/ai/conversationStore';
import {
  normalizeConsultantRequest,
  runKyrubConsultant,
} from '../server/ai/consultantService';
import type {
  AiConsultantProvider,
  ConsultantGenerationInput,
} from '../server/ai/types';
import { ConsultantHttpError } from '../server/ai/types';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

test('consultant request validation accepts a user-ended conversation', () => {
  const request = normalizeConsultantRequest({
    conversationId: 'conversation-1',
    topic: 'Criar minha loja',
    messages: [
      { role: 'user', content: 'Quero organizar minha loja.' },
      { role: 'assistant', content: 'Qual é o segmento?' },
      { role: 'user', content: 'Uma floricultura.' },
    ],
  });

  assert.equal(request.topic, 'Criar minha loja');
  assert.equal(request.messages.length, 3);
  assert.equal(request.messages.at(-1)?.role, 'user');
});

test('consultant request validation rejects a conversation ending with assistant', () => {
  assert.throws(
    () => normalizeConsultantRequest({
      conversationId: 'conversation-1',
      topic: 'Teste',
      messages: [{ role: 'assistant', content: 'Resposta antiga.' }],
    }),
    (error: unknown) =>
      error instanceof ConsultantHttpError &&
      error.code === 'INVALID_REQUEST'
  );
});

test('phase one provider receives the constitution and cannot advertise actions', async () => {
  let received: ConsultantGenerationInput | null = null;
  const provider: AiConsultantProvider = {
    name: 'gemini',
    async generate(input) {
      received = input;
      return {
        text: 'Vamos organizar as informações necessárias.',
        model: 'gemini-test',
      };
    },
  };

  const result = await runKyrubConsultant(
    {
      conversationId: 'conversation-1',
      topic: 'Cadastrar produtos',
      messages: [{ role: 'user', content: 'Cadastre uma camiseta.' }],
    },
    { uid: 'user-1', name: 'Kyrub', email: 'user@example.com' },
    provider
  );

  assert.match(received?.systemInstruction ?? '', /NÃO pode executar ações/i);
  assert.match(received?.systemInstruction ?? '', /Nunca invente dados/i);
  assert.equal(result.reply, 'Vamos organizar as informações necessárias.');
  assert.equal(result.capabilities.actionsEnabled, false);
  assert.equal(result.capabilities.voiceEnabled, false);
  assert.equal(result.capabilities.persistentCloudHistoryEnabled, false);
});

test('local conversation history is isolated by user and keeps messages', () => {
  const storage = new MemoryStorage();
  const conversation = createKyrubAiConversation('Trabalho e organização');
  conversation.messages.push(
    createKyrubAiMessage('user', 'Organize minhas tarefas.')
  );
  conversation.title = titleFromFirstRequest('Organize minhas tarefas da semana');

  saveKyrubAiConversations(storage, 'user-a', [conversation]);

  assert.equal(loadKyrubAiConversations(storage, 'user-a').length, 1);
  assert.equal(loadKyrubAiConversations(storage, 'user-b').length, 0);
  assert.equal(
    loadKyrubAiConversations(storage, 'user-a')[0]?.messages[0]?.content,
    'Organize minhas tarefas.'
  );
});

test('phase one is wired to Express, Vercel and the Kyrub AI workspace', async () => {
  const [serverSource, vercelSource, workspaceSource, constitutionSource] =
    await Promise.all([
      readFile(new URL('../server.ts', import.meta.url), 'utf8'),
      readFile(new URL('../api/ai/consultant.ts', import.meta.url), 'utf8'),
      readFile(
        new URL('../src/components/KyrubAiWorkspaceBridge.tsx', import.meta.url),
        'utf8'
      ),
      readFile(new URL('../docs/CONSULTOR_KYRUB.md', import.meta.url), 'utf8'),
    ]);

  assert.match(serverSource, /\/api\/ai\/consultant/);
  assert.match(vercelSource, /authenticateConsultantRequest/);
  assert.match(vercelSource, /runKyrubConsultant/);
  assert.match(workspaceSource, /Em que posso ajudar hoje\?/);
  assert.match(workspaceSource, /requestKyrubAiConsultant/);
  assert.match(workspaceSource, /Histórico salvo somente neste dispositivo/);
  assert.match(constitutionSource, /O modo manual nunca será removido/);
});
