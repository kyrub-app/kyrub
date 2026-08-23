import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  mergeKyrubAiConversationHistories,
  sanitizeKyrubAiCloudConversations,
} from '../src/ai/kyrubiaConversationCloudSync';
import type { KyrubAiLocalConversation } from '../src/ai/conversationStore';

const conversation = (
  id: string,
  updatedAt: string,
  content: string
): KyrubAiLocalConversation => ({
  id,
  title: id,
  topic: id,
  createdAt: updatedAt,
  updatedAt,
  messages: [
    {
      id: `${id}-message`,
      role: 'user',
      content,
      createdAt: updatedAt,
    },
  ],
});

test('cloud history merge keeps the newest version of the same conversation', () => {
  const local = conversation('same', '2026-08-23T01:00:00.000Z', 'local antigo');
  const cloud = conversation('same', '2026-08-23T02:00:00.000Z', 'cloud novo');

  const merged = mergeKyrubAiConversationHistories([local], [cloud]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].messages[0].content, 'cloud novo');
});

test('cloud history merge preserves conversations that exist on only one device', () => {
  const merged = mergeKyrubAiConversationHistories(
    [conversation('phone', '2026-08-23T01:00:00.000Z', 'celular')],
    [conversation('desktop', '2026-08-23T02:00:00.000Z', 'desktop')]
  );

  assert.deepEqual(merged.map(item => item.id), ['desktop', 'phone']);
});

test('cloud sanitizer keeps only private attachment references accepted by conversationStore', () => {
  const input = conversation('attachments', '2026-08-23T01:00:00.000Z', 'nota');
  input.messages[0].attachments = [
    {
      id: 'attachment-1',
      name: 'nota.pdf',
      mimeType: 'application/pdf',
      size: 1234,
      storagePath: 'kyrubia-attachments/user/conversation/nota.pdf',
    },
  ];

  const sanitized = sanitizeKyrubAiCloudConversations([input]);
  assert.equal(sanitized[0].messages[0].attachments?.[0]?.storagePath,
    'kyrubia-attachments/user/conversation/nota.pdf');
});

test('startup gate hydrates before App and falls back to local cache when cloud is unavailable', () => {
  const main = readFileSync('src/main.tsx', 'utf8');
  const gate = readFileSync('src/components/KyrubAiConversationCloudSyncGate.tsx', 'utf8');

  assert.match(main, /<KyrubAiConversationCloudSyncGate>/);
  assert.match(main, /<App \/>/);
  assert.ok(main.indexOf('<KyrubAiConversationCloudSyncGate>') < main.indexOf('<App />'));
  assert.match(gate, /hydrateKyrubAiConversationHistory/);
  assert.match(gate, /loadKyrubAiConversations\(localStorage, user\.uid\)/);
  assert.match(gate, /Cloud history mirror will retry later/);
  assert.match(gate, /Seu histórico é sincronizado com sua conta entre dispositivos/);
});

test('roadmap is versioned with open owner gates and current cloud-history block', () => {
  const roadmap = readFileSync('ROADMAP_PROXIMOS_AJUSTES.md', 'utf8');
  assert.match(roadmap, /Roadmap Canônico/);
  assert.match(roadmap, /Histórico da Kyrubia sincronizado por UID entre dispositivos/);
  assert.match(roadmap, /Teste de chave BYO-AI/);
  assert.match(roadmap, /Primeiro Pix real/);
  assert.match(roadmap, /timer somente em `ready`/);
});
