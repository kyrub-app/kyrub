import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('activity observer records semantic screen identifiers without raw user content', () => {
  const source = readFileSync(
    new URL('../src/observability/KyrubActivityObserverBridge.tsx', import.meta.url),
    'utf8'
  );

  assert.match(source, /home:perfil/);
  assert.match(source, /home:renda/);
  assert.match(source, /home:kyrub/);
  assert.match(source, /erp:clientes/);
  assert.match(source, /erp:reservas/);
  assert.match(source, /store:settings/);
  assert.match(source, /communities:directory/);
  assert.match(source, /source: 'client_observation'/);
  assert.match(source, /recordCurrentUserActivityEvent/);
  assert.doesNotMatch(source, /metadata:\s*\{[^}]*(content|message|email|phone|address)/s);
});

test('browser activity adapter scopes the local timeline to the authenticated uid', () => {
  const source = readFileSync(
    new URL('../src/observability/kyrubActivityBrowser.ts', import.meta.url),
    'utf8'
  );

  assert.match(source, /auth\.currentUser\?\.uid/);
  assert.match(source, /window\.localStorage/);
  assert.match(source, /KYRUB_ACTIVITY_UPDATED_EVENT/);
  assert.match(source, /recordKyrubActivityEvent/);
  assert.match(source, /readRecentKyrubActivityEvents/);
});

test('activity diagnostic keeps observed context distinct from confirmed results', () => {
  const source = readFileSync(
    new URL('../src/observability/KyrubActivityLogSetupBridge.tsx', import.meta.url),
    'utf8'
  );

  assert.match(source, /activityLogSetup/);
  assert.match(source, /context_only/);
  assert.match(source, /confirmed_result/);
  assert.match(source, /não armazenam o texto de conversas/);
  assert.match(source, /Limpar local/);
  assert.doesNotMatch(source, /consultantClient|KyrubAiConsultant|@google\/genai/);
});

test('activity observer and diagnostic are mounted independently from Kyrubia', () => {
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(main, /KyrubActivityObserverBridge/);
  assert.match(main, /KyrubActivityLogSetupBridge/);
});
