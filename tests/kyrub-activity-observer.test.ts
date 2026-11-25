import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { confirmTransportMonthlyPresence, resolveMonthlyPresenceEmulatorConfig, isQualifyingMonthlyPresenceEvent } from '../server/observability/monthlyPresenceTransport';
import { createMonthlyPresenceSession } from '../src/observability/monthlyPresenceSession';
import { confirmMonthlyPresence, monthlyPresencePath, presenceMonth, type MonthlyPresenceStore, type MonthlyPresenceInput } from '../server/observability/monthlyPresence';
import { createActivitySessionQueue } from '../src/observability/activitySessionQueue';
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

test('remote activity queue never sends an event belonging to another account', () => {
  const a = {uid:'a'}, b = {uid:'b'};
  const queue = createActivitySessionQueue<typeof a, {id:string; actorUid:string}>(80);
  assert.equal(queue.enqueue(a, {id:'old', actorUid:'a'}), true);
  assert.equal(queue.enqueue(b, {id:'old', actorUid:'a'}), false);
  assert.equal(queue.size(), 0);
  assert.equal(queue.begin(b, 20), null);
  assert.equal(queue.enqueue(b, {id:'new', actorUid:'b'}), true);
  const batch = queue.begin(b, 20)!;
  assert.deepEqual(batch.events, [{id:'new', actorUid:'b'}]);
  assert.equal(queue.finish(b, batch, true), true);
  assert.equal(queue.size(), 0);
});

test('logout and fresh login invalidate pending requests and stale acknowledgements', () => {
  const a = {uid:'a'}, fresh = {uid:'a'};
  const queue = createActivitySessionQueue<typeof a, {id:string; actorUid:string}>(80);
  queue.enqueue(a, {id:'same', actorUid:'a'});
  const old = queue.begin(a, 20)!;
  queue.synchronize(null);
  assert.equal(old.controller.signal.aborted, true);
  queue.enqueue(fresh, {id:'same', actorUid:'a'});
  const next = queue.begin(fresh, 20)!;
  assert.equal(queue.isCurrent(fresh, old), false);
  assert.equal(queue.finish(fresh, old, true), false);
  assert.equal(queue.isCurrent(fresh, next), true);
  assert.equal(queue.size(), 1);
  queue.finish(fresh, next, true);
  assert.equal(queue.size(), 0);
});

test('remote activity queue retries within one session only and caps pending events', () => {
  const a = {uid:'a'};
  const queue = createActivitySessionQueue<typeof a, {id:string; actorUid:string}>(2);
  for (const id of ['1','2','3']) queue.enqueue(a,{id,actorUid:'a'});
  const batch = queue.begin(a, 1)!;
  assert.equal(batch.events[0].id, '2');
  assert.equal(queue.begin(a, 1), null);
  assert.equal(queue.enqueue(a,{id:'2',actorUid:'a'}), false);
  assert.equal(queue.finish(a,batch,false), true);
  const retry = queue.begin(a,2)!;
  assert.deepEqual(retry.events.map(x=>x.id),['2','3']);
  queue.finish(a,retry,true);
  assert.equal(queue.size(),0);
});

test('activity transport is session guarded before sending and abortable on auth change', () => {
  const remote = readFileSync(new URL('../src/observability/kyrubActivityRemote.ts', import.meta.url), 'utf8');
  const observer = readFileSync(new URL('../src/observability/KyrubActivityObserverBridge.tsx', import.meta.url), 'utf8');
  assert.match(remote, /if \(!queue\.isCurrent\(auth\.currentUser, batch\)\) return;/);
  assert.match(remote, /signal: batch\.controller\.signal/);
  assert.match(observer, /synchronizeActivityRemoteSession\(\)/);
});

test('monthly presence uses Sao Paulo month boundary and a project/month/account scoped opaque key', () => {
  const secret = new Uint8Array(32).fill(42);
  const input: MonthlyPresenceInput = {authenticatedUid:'fixture-a', projectId:'demo-kyrub', qualifiedActivity:true, receivedAt:new Date('2026-12-01T02:59:59Z')};
  assert.equal(presenceMonth(input.receivedAt),'2026-11');
  assert.equal(presenceMonth(new Date('2026-12-01T03:00:00Z')),'2026-12');
  const path = monthlyPresencePath(input,secret);
  assert.equal(path,monthlyPresencePath({...input,receivedAt:new Date('2026-11-15T12:00:00Z')},secret));
  assert.match(path,/^kyrub_finops_mau_months\/2026-11\/markers\/[a-f0-9]{64}$/);
  assert.doesNotMatch(path,/fixture-a/);
  assert.notEqual(path,monthlyPresencePath({...input,authenticatedUid:'fixture-b'},secret));
  assert.notEqual(path,monthlyPresencePath({...input,projectId:'demo-other'},secret));
  assert.notEqual(path,monthlyPresencePath({...input,receivedAt:new Date('2026-12-01T03:00:00Z')},secret));
  assert.throws(()=>monthlyPresencePath(input,new Uint8Array(16)),/MAU_INVALID/);
  assert.throws(()=>presenceMonth(new Date(NaN)),/MAU_INVALID_CLOCK/);
});
test('monthly presence creates once under concurrent devices, retries and lost acknowledgement', async () => {
  const secret = new Uint8Array(32).fill(42);
  const input: MonthlyPresenceInput = {authenticatedUid:'fixture-a',projectId:'demo-kyrub',qualifiedActivity:true,receivedAt:new Date('2026-11-25T12:00:00Z')};
  const records = new Map<string,unknown>();
  const store: MonthlyPresenceStore = {create:async(path, marker)=>{
    if(records.has(path)) throw Object.assign(Error('exists'),{code:6});
    records.set(path,marker);
  }};
  const result = await Promise.all(Array.from({length:20},()=>confirmMonthlyPresence(input,secret,store)));
  assert.equal(result.filter(x=>x.status==='created').length,1);
  assert.equal(result.filter(x=>x.status==='already_counted').length,19);
  assert.equal(records.size,1);
  assert.deepEqual([...records.values()],[{schemaVersion:1,month:'2026-11'}]);
  assert.equal((await confirmMonthlyPresence({...input,qualifiedActivity:false},secret,store)).status,'not_qualified');
  const b = {...input,authenticatedUid:'fixture-b'};
  await assert.rejects(confirmMonthlyPresence(b,secret,{create:async(path,marker)=>{
    await store.create(path,marker);
    throw Object.assign(Error('response lost'),{code:14});
  }}),/response lost/);
  assert.equal((await confirmMonthlyPresence(b,secret,store)).status,'already_counted');
  assert.equal(records.size,2);
  await assert.rejects(confirmMonthlyPresence({...input,authenticatedUid:'fixture-c'},secret,
    {create:async()=>{throw Object.assign(Error('denied'),{code:7});}}),/denied/);
});
test('monthly presence transport remains opt-in and the primitive has no ambient DB', () => {
  const transport = readFileSync(new URL('../server/observability/kyrubActivityTransport.ts',import.meta.url),'utf8');
  const source = readFileSync(new URL('../server/observability/monthlyPresence.ts',import.meta.url),'utf8');
  assert.match(transport,/identity\.uid, payload\?\.monthlyPresenceRequested === true, qualified, receivedAt/);
  assert.match(source,/db\.doc\(path\)\.create\(marker\)/);
  assert.doesNotMatch(source,/adminDb|initializeApp|process\.env/);
});

test('monthly presence transport fails closed unless every isolated emulator gate matches', async () => {
  const env = {KYRUB_FINOPS_MAU_EMULATOR_ENABLED:'true', FIRESTORE_EMULATOR_HOST:'127.0.0.1:8088',
    FIREBASE_PROJECT_ID:'kyrub-security-test', KYRUB_FINOPS_MAU_EMULATOR_KEY:'ab'.repeat(32)};
  assert.ok(resolveMonthlyPresenceEmulatorConfig(env));
  for (const change of [{VERCEL_ENV:'production'},{NODE_ENV:'production'},
      {FIRESTORE_EMULATOR_HOST:'localhost:8088'},{FIREBASE_PROJECT_ID:'kyrub-b8d0e'},
      {KYRUB_FINOPS_MAU_EMULATOR_ENABLED:'false'},{KYRUB_FINOPS_MAU_EMULATOR_KEY:'short'},
      {FIREBASE_SERVICE_ACCOUNT_JSON:'fixture'}]) {
    assert.equal(resolveMonthlyPresenceEmulatorConfig({...env,...change}),null);
  }
  let writes=0;
  const dependencies={env, currentProject:()=> 'kyrub-security-test', store:()=>({create:async()=>{writes++;}})};
  const now=new Date('2026-12-01T02:59:59Z');
  assert.equal(await confirmTransportMonthlyPresence('a',false,true,now,dependencies),undefined);
  assert.deepEqual(await confirmTransportMonthlyPresence('a',true,false,now,dependencies),{status:'not_qualified'});
  assert.deepEqual(await confirmTransportMonthlyPresence('a',true,true,now,{...dependencies,currentProject:()=> 'other'}),{status:'disabled'});
  assert.deepEqual(await confirmTransportMonthlyPresence('a',true,true,now,{...dependencies,env:{}}),{status:'disabled'});
  assert.equal(writes,0);
  assert.deepEqual(await confirmTransportMonthlyPresence('a',true,true,now,dependencies),{status:'confirmed',month:'2026-11'});
  assert.equal(writes,1);
  assert.deepEqual(await confirmTransportMonthlyPresence('a',true,true,now,{...dependencies,store:()=>({create:async()=>{throw Error('offline');}})}),{status:'unavailable'});
});
test('monthly presence qualifies only bounded observed navigation, not technical or generative activity', () => {
  const event={type:'navigation.screen_viewed',domain:'app',source:'client_observation',authority:'context_only',screenId:'home:renda'};
  assert.equal(isQualifyingMonthlyPresenceEvent(event),true);
  assert.equal(isQualifyingMonthlyPresenceEvent({...event,domain:'kyrubia'}),false);
  assert.equal(isQualifyingMonthlyPresenceEvent({...event,type:'result.action_succeeded'}),false);
  assert.equal(isQualifyingMonthlyPresenceEvent({...event,authority:'confirmed_result'}),false);
  assert.equal(isQualifyingMonthlyPresenceEvent({...event,screenId:undefined}),false);
});
test('monthly presence client suppresses duplicate attempts, retries with backoff and ignores stale session ACK', () => {
  const a={}, b={};
  const now=Date.parse('2026-12-01T02:58:00Z');
  const s=createMonthlyPresenceSession<object>();
  assert.equal(s.shouldRequest(a,now),true);
  s.attempted(a,now);
  assert.equal(s.shouldRequest(a,now+1000),false);
  assert.equal(s.shouldRequest(a,now+60000),true);
  s.acknowledge(a,{status:'confirmed',month:'2026-11'});
  assert.equal(s.shouldRequest(a,now+60000),false);
  assert.equal(s.shouldRequest(a,now+120000),true);
  s.synchronize(b);
  s.acknowledge(a,{status:'confirmed',month:'2026-12'});
  assert.equal(s.shouldRequest(b,now+120000),true);
  s.acknowledge(b,{status:'disabled'});
  assert.equal(s.shouldRequest(b,now+180000),false);
  s.synchronize(null);
  assert.equal(s.shouldRequest(b,now+180000),true);
});

test('production HTTP receiver always composes the real verifier and server clock', () => {
  const transport = readFileSync(new URL('../server/observability/kyrubActivityTransport.ts',import.meta.url),'utf8');
  const api = readFileSync(new URL('../api/health.ts',import.meta.url),'utf8');
  assert.match(transport,/receiveAuthorizedKyrubActivityEvents = createAuthorizedKyrubActivityReceiver\(\{[\s\S]*?verify: verifyFirebaseIdToken,[\s\S]*?now: \(\) => new Date\(\),[\s\S]*?confirm: confirmTransportMonthlyPresence/);
  assert.match(api,/activity\.receiveAuthorizedKyrubActivityEvents\(/);
  assert.doesNotMatch(api,/createAuthorizedKyrubActivityReceiver/);
});
