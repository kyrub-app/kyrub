import assert from 'node:assert/strict';
import test from 'node:test';
import type { KyrubAiConsultantRequest } from '../shared/aiConsultant';
import {
  isKyrubAiOpportunityContinuation,
  prepareKyrubAiOpportunityContinuation,
} from '../src/ai/opportunityContinuation';

const recipeConversation = (): KyrubAiConsultantRequest => ({
  conversationId: 'recipe-conversation',
  topic: 'Receita de bolo',
  messages: [
    {
      role: 'user',
      content:
        'Crie uma receita de bolo e adicione às minhas notas com um checklist.',
    },
    {
      role: 'assistant',
      content:
        'Preparei a nota “Bolo de chocolate”. Esse conteúdo também pode revelar caminhos práticos, de desenvolvimento ou de renda. Você gostaria que a Kyrubia explorasse essas possibilidades, do caminho mais simples ao mais estrutural?',
    },
    { role: 'user', content: 'Sim, por favor.' },
  ],
});

test('affirmative answer continues the opportunity exploration instead of repeating the note', () => {
  const payload = recipeConversation();

  assert.equal(isKyrubAiOpportunityContinuation(payload), true);
  const prepared = prepareKyrubAiOpportunityContinuation(payload);

  assert.notEqual(prepared, payload);
  assert.equal(prepared.messages.length, 2);
  assert.equal(prepared.messages[0].role, 'assistant');
  assert.match(prepared.messages[0].content, /caminhos práticos/i);
  assert.equal(prepared.messages[1].role, 'user');
  assert.match(prepared.messages[1].content, /explorar as possibilidades/i);
  assert.match(prepared.messages[1].content, /não crie novamente a nota/i);
  assert.match(String(prepared.screenContext), /não prepare, recrie nem proponha nota/i);
  assert.doesNotMatch(prepared.messages[1].content, /adicione às minhas notas/i);
});

test('an explicit new note request remains available to create_note', () => {
  const payload = recipeConversation();
  payload.messages[payload.messages.length - 1] = {
    role: 'user',
    content: 'Sim, e salve essas novas ideias em outra nota.',
  };

  assert.equal(isKyrubAiOpportunityContinuation(payload), false);
  assert.equal(prepareKyrubAiOpportunityContinuation(payload), payload);
});

test('a simple yes to an unrelated question is not rewritten', () => {
  const payload: KyrubAiConsultantRequest = {
    conversationId: 'camera-conversation',
    topic: 'Câmera profissional',
    messages: [
      {
        role: 'assistant',
        content: 'Você pretende usar a câmera para projeto pessoal ou profissional?',
      },
      { role: 'user', content: 'Sim.' },
    ],
  };

  assert.equal(isKyrubAiOpportunityContinuation(payload), false);
  assert.equal(prepareKyrubAiOpportunityContinuation(payload), payload);
});
