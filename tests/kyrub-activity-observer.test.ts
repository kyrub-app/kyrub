import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { authorityForKyrubActivitySource } from '../shared/kyrubActivityEvents';
import { resolveKyrubiaTrustedReadRuntime } from '../src/ai/trustedReadRuntime';
import {
  clearOfficialKnowledgeRuntimeSnapshot,
  getOfficialKnowledgeRuntimeSnapshot,
  setOfficialKnowledgeRuntimeSnapshot,
} from '../src/knowledge/officialKnowledgeRuntimeCache';
import { findKyrubReceiptVerificationCandidate } from '../src/observability/kyrubAuthoritativeReceiptRehydration';
import {
  clearAuthoritativeActivityRuntimeEvents,
  rememberAuthoritativeActivityRuntimeEvent,
} from '../src/observability/kyrubAuthoritativeActivityRuntime';
import {
  recordKyrubActivityEvent,
  type KyrubActivityStorage,
} from '../src/observability/kyrubActivityLog';
import {
  enteredSemanticScreens,
  forgetSemanticSelection,
  rememberSemanticSelection,
} from '../src/observability/kyrubActivityTransitions';

class MemoryStorage implements KyrubActivityStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

const officialSnapshot = () => ({
  source: 'official_communities' as const,
  generatedAt: '2026-08-10T23:00:00.000Z',
  warnings: [],
  items: [{
    schemaVersion: 1 as const,
    id: 'official-community:manual:debate:publication',
    authority: 'official_product_reference' as const,
    sourceKind: 'official_community' as const,
    sourceEntityType: 'community_debate' as const,
    sourceEntityId: 'publication',
    communityId: 'manual',
    title: 'Como funciona a publicação da Loja Kyrub?',
    content: 'A publicação da Loja Kyrub é separada da ativação. No fluxo atual, a loja precisa possuir um nome para ser publicada.',
    status: 'active' as const,
    version: '2026-08-10T23:00:00.000Z',
    updatedAt: '2026-08-10T23:00:00.000Z',
    tags: [],
  }],
});

test('semantic observer records transitions, not DOM re-renders', () => {
  const source = readFileSync(new URL('../src/observability/KyrubActivityObserverBridge.tsx', import.meta.url), 'utf8');
  assert.match(source, /home:renda/);
  assert.match(source, /erp:reservas/);
  assert.match(source, /store:settings/);
  assert.match(source, /communities:directory/);
  assert.match(source, /source: 'client_observation'/);
  assert.match(source, /enteredSemanticScreens/);
  assert.match(source, /rememberSemanticSelection/);

  const current = new Set(['erp:panel']);
  assert.deepEqual(enteredSemanticScreens(new Set(), current), ['erp:panel']);
  assert.deepEqual(enteredSemanticScreens(current, current), []);

  const memory = new Map<string, string>();
  assert.equal(rememberSemanticSelection(memory, 'erp-tab', 'erp:reservas'), true);
  assert.equal(rememberSemanticSelection(memory, 'erp-tab', 'erp:reservas'), false);
  assert.equal(rememberSemanticSelection(memory, 'erp-tab', 'erp:gerencial'), true);
  forgetSemanticSelection(memory, 'erp-tab');
  assert.equal(rememberSemanticSelection(memory, 'erp-tab', 'erp:reservas'), true);
});

test('observed context and authoritative outcomes keep different authority', () => {
  assert.equal(authorityForKyrubActivitySource('client_observation'), 'context_only');
  assert.equal(authorityForKyrubActivitySource('authoritative_write_ack'), 'confirmed_result');
  assert.equal(authorityForKyrubActivitySource('server_confirmed'), 'confirmed_result');

  const outcomes = readFileSync(new URL('../src/observability/kyrubActivityOutcomes.ts', import.meta.url), 'utf8');
  assert.match(outcomes, /store\.settings\.save/);
  assert.match(outcomes, /interaction\.action_attempted/);
  assert.match(outcomes, /result\.action_succeeded/);
  assert.doesNotMatch(outcomes, /metadata:/);
});

test('store save confirmation is emitted only after full cloud sync', () => {
  const source = readFileSync(new URL('../src/components/modals/StoreConfigModal.tsx', import.meta.url), 'utf8');
  const attempt = source.indexOf('recordStoreSettingsSaveAttempt();');
  const save = source.indexOf('const result = await saveStore(true);');
  const guard = source.indexOf('if (result.cloudSynced)');
  const confirmed = source.indexOf('recordStoreSettingsSaveConfirmed();');
  assert.ok(attempt >= 0 && attempt < save);
  assert.ok(save < guard && guard < confirmed);
});

test('confirmed Kyrubia actions bind activity to the executing uid and record authority only after a valid receipt', () => {
  const source = readFileSync(new URL('../src/actions/kyrubActionService.ts', import.meta.url), 'utf8');
  const attempt = source.indexOf('recordConfirmedKyrubiaActionAttempt(user.uid, proposal, confirmed);');
  const receiptGuard = source.indexOf('if (!validReceipt(body, proposal))');
  const result = source.indexOf('const result = body as unknown as KyrubActionExecutionResult;');
  const confirmed = source.indexOf('recordConfirmedKyrubiaActionResult(user.uid, proposal, result, confirmed);');

  assert.ok(attempt >= 0);
  assert.ok(receiptGuard > attempt);
  assert.ok(result > receiptGuard);
  assert.ok(confirmed > result);
  assert.match(source, /metadata: \{ proposal_id: proposal\.id \}/);
  assert.match(source, /execution_id: executionId/);
  assert.match(source, /proposal_id: proposalId/);
  assert.match(source, /recordUserActivityEvent\(actorUid/);
});

test('trusted read normalizes common q abbreviation without provider fallback', () => {
  const storage = new MemoryStorage();
  recordKyrubActivityEvent(storage, 'user-1', {
    type: 'navigation.screen_viewed', domain: 'app', source: 'client_observation',
    screenId: 'home:renda',
  });

  const result = resolveKyrubiaTrustedReadRuntime(storage, 'user-1', 'O q acabei de fazer?');
  assert.equal(result?.kind, 'recent_activity');
  assert.match(result?.reply ?? '', /Pelo histórico recente que o próprio Kyrub registrou/);
});

test('trusted read says success only when the same action has a session-authoritative acknowledgement', () => {
  clearAuthoritativeActivityRuntimeEvents();
  const storage = new MemoryStorage();
  recordKyrubActivityEvent(storage, 'user-1', {
    type: 'interaction.action_attempted', domain: 'store', source: 'client_observation',
    screenId: 'store:settings', actionId: 'store.settings.save',
  }, new Date('2026-08-10T22:52:21.000Z'));
  const confirmed = recordKyrubActivityEvent(storage, 'user-1', {
    type: 'result.action_succeeded', domain: 'store', source: 'authoritative_write_ack',
    screenId: 'store:settings', actionId: 'store.settings.save',
  }, new Date('2026-08-10T22:52:22.000Z'));
  rememberAuthoritativeActivityRuntimeEvent(confirmed);

  const result = resolveKyrubiaTrustedReadRuntime(storage, 'user-1', 'Deu certo?');
  assert.equal(result?.kind, 'recent_result');
  assert.match(result?.reply ?? '', /confirmação autoritativa/);
  assert.match(result?.reply ?? '', /não estou inferindo sucesso/i);
  clearAuthoritativeActivityRuntimeEvents();
});

test('trusted read recognizes an authoritative Kyrubia product receipt from the same session', () => {
  clearAuthoritativeActivityRuntimeEvents();
  const storage = new MemoryStorage();
  recordKyrubActivityEvent(storage, 'user-1', {
    type: 'interaction.action_attempted', domain: 'kyrubia', source: 'client_observation',
    screenId: 'home:kyrub', actionId: 'create_product', entityType: 'product',
  }, new Date('2026-08-12T21:30:00.000Z'));
  const confirmed = recordKyrubActivityEvent(storage, 'user-1', {
    type: 'result.action_succeeded', domain: 'kyrubia', source: 'authoritative_write_ack',
    screenId: 'home:kyrub', actionId: 'create_product', entityType: 'product', entityId: 'product-pro-6',
  }, new Date('2026-08-12T21:30:01.000Z'));
  rememberAuthoritativeActivityRuntimeEvent(confirmed);

  const result = resolveKyrubiaTrustedReadRuntime(storage, 'user-1', 'Deu certo?');
  assert.equal(result?.kind, 'recent_result');
  assert.match(result?.reply ?? '', /^Sim\./);
  assert.match(result?.reply ?? '', /cadastrar um produto pela Kyrubia/i);
  assert.match(result?.reply ?? '', /confirmação autoritativa/i);
  clearAuthoritativeActivityRuntimeEvents();
});

test('forged or rehydrated local confirmed_result cannot become Kyrubia authority', () => {
  clearAuthoritativeActivityRuntimeEvents();
  const storage = new MemoryStorage();
  recordKyrubActivityEvent(storage, 'user-1', {
    type: 'interaction.action_attempted', domain: 'store', source: 'client_observation',
    screenId: 'store:settings', actionId: 'store.settings.save',
  }, new Date('2026-08-10T22:52:21.000Z'));
  recordKyrubActivityEvent(storage, 'user-1', {
    type: 'result.action_succeeded', domain: 'store', source: 'authoritative_write_ack',
    screenId: 'store:settings', actionId: 'store.settings.save',
  }, new Date('2026-08-10T22:52:22.000Z'));

  const result = resolveKyrubiaTrustedReadRuntime(storage, 'user-1', 'Funcionou?');
  assert.equal(result?.kind, 'recent_result');
  assert.match(result?.reply ?? '', /não tenho uma confirmação autoritativa desta sessão/i);
  assert.doesNotMatch(result?.reply ?? '', /^Sim\./);
});

test('receipt verification candidate is only a pointer and must bind the same proposal and result', () => {
  const attempt = recordKyrubActivityEvent(new MemoryStorage(), 'user-1', {
    type: 'interaction.action_attempted',
    domain: 'kyrubia',
    source: 'client_observation',
    actionId: 'update_product',
    entityType: 'product',
    metadata: { proposal_id: 'proposal-123' },
  }, new Date('2026-08-13T00:10:00.000Z'));
  const result = recordKyrubActivityEvent(new MemoryStorage(), 'user-1', {
    type: 'result.action_succeeded',
    domain: 'kyrubia',
    source: 'authoritative_write_ack',
    actionId: 'update_product',
    entityType: 'product',
    entityId: 'product-pro-test',
    metadata: {
      execution_id: `exec_${'a'.repeat(40)}`,
      proposal_id: 'proposal-123',
    },
  }, new Date('2026-08-13T00:10:01.000Z'));

  const candidate = findKyrubReceiptVerificationCandidate([attempt, result]);
  assert.equal(candidate?.executionId, `exec_${'a'.repeat(40)}`);
  assert.equal(candidate?.proposalId, 'proposal-123');
  assert.equal(candidate?.storedResult.entityId, 'product-pro-test');

  const mismatched = {
    ...result,
    metadata: {
      ...result.metadata,
      proposal_id: 'different-proposal',
    },
  };
  assert.equal(
    findKyrubReceiptVerificationCandidate([attempt, mismatched]),
    null
  );
});

test('server receipt rehydration verifies actor, action, proposal and entity before rebuilding session authority', () => {
  const server = readFileSync(new URL('../server/actions/actionReceiptVerificationService.ts', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../api/action-execute.ts', import.meta.url), 'utf8');
  const rehydration = readFileSync(new URL('../src/observability/kyrubAuthoritativeReceiptRehydration.ts', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../src/actions/kyrubActionReceiptService.ts', import.meta.url), 'utf8');
  const wrapper = readFileSync(new URL('../src/ai/consultantClientWithPlans.ts', import.meta.url), 'utf8');
  const bridge = readFileSync(new URL('../src/observability/KyrubAuthoritativeReceiptBridge.tsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

  assert.match(server, /data\.actorUid !== actor\.uid/);
  assert.match(server, /data\.actionType !== request\.actionType/);
  assert.match(server, /data\.actionId !== request\.proposalId/);
  assert.match(server, /data\.targetId !== request\.entityId/);
  assert.match(server, /kyrub_action_receipts\/\$\{request\.executionId\}/);

  const verifyGate = api.indexOf('if (isKyrubActionReceiptVerificationRequest(request.body))');
  const entitlementReconcile = api.indexOf('await reconcileStoreEntitlementFromAuthorization(authorization);');
  assert.ok(verifyGate >= 0 && verifyGate < entitlementReconcile);
  assert.match(api, /verifyAuthorizedKyrubActionReceipt/);

  assert.match(client, /operation: 'verify_receipt'/);
  assert.match(client, /cache: 'no-store'/);
  assert.match(rehydration, /verifyKyrubActionReceipt/);
  assert.match(rehydration, /source: 'server_confirmed'/);
  assert.match(rehydration, /proposalId !== attemptProposalId/);
  assert.match(wrapper, /isRecentActionResultQuestion/);
  assert.match(wrapper, /await rehydrateKyrubiaAuthoritativeReceipt\(localStorage, user\)/);
  assert.match(bridge, /onAuthStateChanged/);
  assert.match(bridge, /KYRUB_ACTIVITY_UPDATED_EVENT/);
  assert.match(app, /<KyrubAuthoritativeReceiptBridge \/>/);
});

test('official runtime truth is in-memory, expires, and answers only sufficient lexical matches', () => {
  clearOfficialKnowledgeRuntimeSnapshot();
  setOfficialKnowledgeRuntimeSnapshot(officialSnapshot(), new Date('2026-08-10T23:00:00.000Z'));
  assert.equal(getOfficialKnowledgeRuntimeSnapshot(new Date('2026-08-10T23:04:59.000Z')).length, 1);

  const storage = new MemoryStorage();
  setOfficialKnowledgeRuntimeSnapshot(officialSnapshot());
  const strong = resolveKyrubiaTrustedReadRuntime(storage, 'user-1', 'Como funciona a publicação da Loja Kyrub?');
  assert.equal(strong?.kind, 'official_knowledge');
  assert.match(strong?.reply ?? '', /Segundo o Manual KYRUB/);
  assert.match(strong?.reply ?? '', /precisa possuir um nome/);

  const weak = resolveKyrubiaTrustedReadRuntime(storage, 'user-1', 'O que falta pra minha loja aparecer pras pessoas?');
  assert.equal(weak?.kind, 'official_uncertain');
  assert.doesNotMatch(weak?.reply ?? '', /precisa possuir um nome/);

  setOfficialKnowledgeRuntimeSnapshot(officialSnapshot(), new Date('2026-08-10T23:00:00.000Z'));
  assert.equal(getOfficialKnowledgeRuntimeSnapshot(new Date('2026-08-10T23:05:01.000Z')).length, 0);
});

test('trusted read wiring refreshes official truth and clears session authority on auth changes', () => {
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  const bridge = readFileSync(new URL('../src/knowledge/KyrubOfficialKnowledgeRuntimeBridge.tsx', import.meta.url), 'utf8');
  const trusted = readFileSync(new URL('../src/ai/trustedReadRuntime.ts', import.meta.url), 'utf8');
  const browser = readFileSync(new URL('../src/observability/kyrubActivityBrowser.ts', import.meta.url), 'utf8');
  const observer = readFileSync(new URL('../src/observability/KyrubActivityObserverBridge.tsx', import.meta.url), 'utf8');
  const objective = readFileSync(new URL('../src/ai/objectiveRuntimeService.ts', import.meta.url), 'utf8');

  assert.match(main, /KyrubOfficialKnowledgeRuntimeBridge/);
  assert.match(bridge, /readOfficialCommunityKnowledge/);
  assert.match(bridge, /REFRESH_INTERVAL_MS/);
  assert.match(bridge, /setInterval/);
  assert.match(bridge, /clearOfficialKnowledgeRuntimeSnapshot/);
  assert.doesNotMatch(bridge, /localStorage/);
  assert.match(trusted, /readRecentKyrubActivityEvents/);
  assert.match(trusted, /readAuthoritativeActivityRuntimeEvents/);
  assert.match(trusted, /getOfficialKnowledgeRuntimeSnapshot/);
  assert.doesNotMatch(trusted, /@google\/genai|GEMINI_API_KEY|fetch\(/);
  assert.match(browser, /rememberAuthoritativeActivityRuntimeEvent/);
  assert.match(browser, /recordUserActivityEvent/);
  assert.match(observer, /clearAuthoritativeActivityRuntimeEvents/);
  assert.match(objective, /resolveKyrubiaTrustedReadRuntime/);
});
