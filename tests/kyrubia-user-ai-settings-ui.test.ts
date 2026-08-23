import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const client = readFileSync('src/ai/userAiProviderSettings.ts', 'utf8');
const bridge = readFileSync('src/components/KyrubAiProviderSettingsBridge.tsx', 'utf8');
const actionExecute = readFileSync('api/action-execute.ts', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');

test('BYO-AI settings client authenticates through Firebase and never persists raw API keys', () => {
  assert.match(client, /auth\.currentUser/);
  assert.match(client, /await user\.getIdToken\(\)/);
  assert.match(client, /authorization: `Bearer \$\{token\}`/);
  assert.match(client, /transport=kyrubia-user-ai-provider/);
  assert.doesNotMatch(client, /localStorage|sessionStorage|firebase\/firestore/);
});

test('BYO-AI UI keeps credentials in password state only and clears the draft after save attempt', () => {
  assert.match(bridge, /type="password"/);
  assert.match(bridge, /autoComplete="off"/);
  assert.match(bridge, /setDraftKeys\(current => \(\{ \.\.\.current, \[provider\]: '' \}\)\)/);
  assert.doesNotMatch(bridge, /localStorage|sessionStorage|setDoc|addDoc|firebase\/firestore/);
  assert.doesNotMatch(bridge, /console\.(?:log|warn|error)/);
});

test('BYO-AI preference can only be selected from provider metadata already marked available', () => {
  assert.match(bridge, /const available = metadata\.status === 'available'/);
  assert.match(bridge, /available && !preferred/);
  assert.match(bridge, /setPreferredUserAiProvider\(provider\)/);
});

test('existing action-execute transport exposes preference without adding another Vercel function', () => {
  assert.match(actionExecute, /transport === 'kyrubia-user-ai-provider'/);
  assert.match(actionExecute, /userAiProviderPreferenceService\.js/);
  assert.match(actionExecute, /operation === 'set_preference'/);
  assert.match(actionExecute, /preferredProvider: routing\.preferredProvider/);
});

test('personal AI settings are mounted in authenticated Kyrub rather than the admin control plane', () => {
  assert.match(app, /KyrubAiProviderSettingsBridge/);
  const adminReturn = app.indexOf('if (adminControlPlane) return <AdminControlPlaneRoot />');
  const authenticatedMount = app.indexOf('<KyrubAiProviderSettingsBridge />');
  assert.ok(adminReturn >= 0);
  assert.ok(authenticatedMount >= 0);
  assert.doesNotMatch(bridge, /AdminIntegrationsWorkspace|admin\.kyrub/);
});

test('UI states that own-provider inference avoids Kyrubia Credits and paid fallback is not silent', () => {
  assert.match(bridge, /não consome Créditos Kyrubia/);
  assert.match(bridge, /Fallback pago não acontece silenciosamente/);
  assert.match(bridge, /anexos continuam fora do roteamento BYO-AI/);
});
