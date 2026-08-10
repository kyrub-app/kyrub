import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { KyrubKnowledgeItem } from '../shared/kyrubKnowledge';
import { searchKyrubKnowledge } from '../shared/kyrubKnowledgeSearch';
import {
  readRecentKyrubActivityEvents,
  recordKyrubActivityEvent,
  type KyrubActivityStorage,
} from '../src/observability/kyrubActivityLog';

class MemoryStorage implements KyrubActivityStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const knowledgeItem = (
  id: string,
  title: string,
  content: string,
  updatedAt = '2026-08-10T12:00:00.000Z'
): KyrubKnowledgeItem => ({
  schemaVersion: 1,
  id,
  authority: 'official_product_reference',
  sourceKind: 'official_community',
  sourceEntityType: 'community_debate',
  sourceEntityId: id,
  communityId: 'community-official',
  title,
  content,
  status: 'active',
  version: updatedAt,
  updatedAt,
  tags: [],
});

const manualKnowledge = (): KyrubKnowledgeItem[] => [
  knowledgeItem(
    'about',
    'O que é o Kyrub?',
    'O Kyrub reúne organização, relações, comunidades, Loja Kyrub, produtos, serviços e a Kyrubia em um ecossistema conectado.',
    '2026-08-10T12:00:00.000Z'
  ),
  knowledgeItem(
    'lifecycle',
    'Qual a diferença entre ativar, publicar e abrir uma Loja Kyrub?',
    'Ativar cria a estrutura. Publicar torna a Loja Kyrub disponível para descoberta pública. Abrir ou fechar representa o estado operacional.',
    '2026-08-10T13:00:00.000Z'
  ),
  knowledgeItem(
    'pro',
    'O que o plano Pro libera?',
    'O Pro prevê até 100 produtos ou serviços ativos e 300 Créditos Kyrubia Inteligência por mês. O Free possui 5 produtos ou serviços ativos.',
    '2026-08-10T14:00:00.000Z'
  ),
  knowledgeItem(
    'publication',
    'Como funciona a publicação da Loja Kyrub?',
    'A publicação da Loja Kyrub exige nome e é separada da ativação e do estado open ou closed. O publicationStatus usa published ou paused.',
    '2026-08-10T15:00:00.000Z'
  ),
];

test('official knowledge search is deterministic and prefers title matches', () => {
  const results = searchKyrubKnowledge(
    [
      knowledgeItem('plans', 'O que o plano Pro libera?', 'O Pro amplia a capacidade do catálogo.'),
      knowledgeItem('store', 'Como publicar a Loja Kyrub?', 'Abra as configurações da loja para publicar.'),
    ],
    'como publicar minha loja'
  );

  assert.equal(results[0]?.item.id, 'store');
  assert.ok((results[0]?.score ?? 0) > 0);
  assert.ok((results[0]?.coverage ?? 0) > 0);
});

test('official knowledge search keeps plan content below publication references for publication questions', () => {
  const results = searchKyrubKnowledge(
    manualKnowledge(),
    'quero publicar a minha loja'
  );

  assert.ok(results.length >= 2);
  assert.notEqual(results[0]?.item.id, 'pro');
  assert.ok(['publication', 'lifecycle'].includes(results[0]?.item.id ?? ''));
  assert.ok((results.findIndex(result => result.item.id === 'pro')) > 0);
});

test('official knowledge search ranks lifecycle distinction when the query names activation, publication and opening', () => {
  const results = searchKyrubKnowledge(
    manualKnowledge(),
    'qual a diferença entre ativar publicar e abrir a loja'
  );

  assert.equal(results[0]?.item.id, 'lifecycle');
  assert.equal(results[0]?.confidence, 'high');
  assert.ok(results[0]?.titleMatchedTokens.includes('ativar'));
});

test('official knowledge search ranks Pro for explicit plan questions', () => {
  const results = searchKyrubKnowledge(
    manualKnowledge(),
    'o plano Pro libera quantos produtos'
  );

  assert.equal(results[0]?.item.id, 'pro');
  assert.ok(['high', 'medium'].includes(results[0]?.confidence ?? ''));
});

test('official knowledge search exposes low lexical confidence instead of inventing certainty', () => {
  const results = searchKyrubKnowledge(
    manualKnowledge(),
    'o que falta pra minha loja aparecer pras pessoas'
  );

  assert.ok(results.length > 0);
  assert.equal(results[0]?.confidence, 'low');
  assert.ok((results[0]?.coverage ?? 1) < 0.5);
});

test('activity log distinguishes observed context from server-confirmed results', () => {
  const storage = new MemoryStorage();
  const observed = recordKyrubActivityEvent(storage, 'user-1', {
    type: 'interaction.action_attempted',
    domain: 'store',
    source: 'client_observation',
    actionId: 'publish_store',
  });
  const confirmed = recordKyrubActivityEvent(storage, 'user-1', {
    type: 'result.action_succeeded',
    domain: 'store',
    source: 'server_confirmed',
    actionId: 'publish_store',
  });

  assert.equal(observed.authority, 'context_only');
  assert.equal(confirmed.authority, 'confirmed_result');
  assert.equal(readRecentKyrubActivityEvents(storage, 'user-1').length, 2);
});

test('activity log drops raw conversational and personal metadata keys', () => {
  const storage = new MemoryStorage();
  const event = recordKyrubActivityEvent(storage, 'user-1', {
    type: 'navigation.screen_viewed',
    domain: 'community',
    source: 'client_observation',
    screenId: 'community-detail',
    metadata: {
      tab: 'debates',
      content: 'texto privado que não deve ser armazenado',
      email: 'alguem@example.com',
      prompt: 'mensagem para a IA',
    },
  });

  assert.deepEqual(event.metadata, { tab: 'debates' });
});

test('official community reader requires configured trust anchors and ignores comments as knowledge', () => {
  const source = readFileSync(
    new URL('../src/knowledge/officialCommunityKnowledge.ts', import.meta.url),
    'utf8'
  );

  assert.match(source, /VITE_KYRUB_OFFICIAL_PROFILE_UID/);
  assert.match(source, /VITE_KYRUB_OFFICIAL_COMMUNITY_IDS/);
  assert.match(source, /community\.ownerId/);
  assert.match(source, /data\.authorId/);
  assert.match(source, /data\.status !== 'open'/);
  assert.doesNotMatch(source, /community_debate_comments/);
});

test('official knowledge anchors have versioned public defaults while environment remains authoritative', () => {
  const source = readFileSync(
    new URL('../src/knowledge/officialCommunityKnowledge.ts', import.meta.url),
    'utf8'
  );
  const anchors = readFileSync(
    new URL('../src/knowledge/officialKnowledgeAnchors.ts', import.meta.url),
    'utf8'
  );

  assert.match(source, /source: 'environment'/);
  assert.match(source, /source: 'versioned_defaults'/);
  assert.ok(source.indexOf('envProfileUid') < source.indexOf('defaultProfileUid'));
  assert.match(anchors, /8DK3cZ42hPVp8NCjzZEPpduV5rF2/);
  assert.match(anchors, /fIemZnVFXZsagd6EA6sN/);
});

test('official knowledge setup is explicit, owner-scoped and probes the same trusted reader', () => {
  const source = readFileSync(
    new URL('../src/components/OfficialKnowledgeSetupBridge.tsx', import.meta.url),
    'utf8'
  );
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

  assert.match(source, /officialKnowledgeSetup/);
  assert.match(source, /communities\.filter\(community => community\.isOwner\)/);
  assert.match(source, /readOfficialCommunityKnowledge\(config\)/);
  assert.match(source, /VITE_KYRUB_OFFICIAL_PROFILE_UID/);
  assert.match(source, /VITE_KYRUB_OFFICIAL_COMMUNITY_IDS/);
  assert.match(source, /navigator\.clipboard\.writeText/);
  assert.match(source, /Conhecimento elegível/);
  assert.match(source, /Teste determinístico de busca/);
  assert.match(source, /Zero Gemini/);
  assert.match(source, /searchKyrubKnowledge/);
  assert.match(source, /score/);
  assert.match(source, /cobertura/);
  assert.match(main, /OfficialKnowledgeSetupBridge/);
});

test('knowledge and activity foundations are not wired into Kyrubia yet', () => {
  const knowledge = readFileSync(
    new URL('../src/knowledge/officialCommunityKnowledge.ts', import.meta.url),
    'utf8'
  );
  const activity = readFileSync(
    new URL('../src/observability/kyrubActivityLog.ts', import.meta.url),
    'utf8'
  );
  const setup = readFileSync(
    new URL('../src/components/OfficialKnowledgeSetupBridge.tsx', import.meta.url),
    'utf8'
  );

  assert.doesNotMatch(knowledge, /consultantClient|KyrubAiConsultant|Gemini|@google\/genai/);
  assert.doesNotMatch(activity, /consultantClient|KyrubAiConsultant|Gemini|@google\/genai/);
  assert.doesNotMatch(setup, /consultantClient|KyrubAiConsultant|@google\/genai/);
});
