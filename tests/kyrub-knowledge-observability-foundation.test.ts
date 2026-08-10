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
  assert.doesNotMatch(setup, /consultantClient|KyrubAiConsultant|Gemini|@google\/genai/);
});
