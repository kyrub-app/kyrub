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

test('nontechnical users see Kyrubia Credits before advanced API-key configuration', () => {
  const credits = bridge.indexOf('Usar Créditos Kyrubia');
  const advanced = bridge.indexOf('Usar minha própria IA');
  const keyInput = bridge.indexOf('Chave de API');
  assert.ok(credits >= 0);
  assert.ok(advanced > credits);
  assert.ok(keyInput > advanced);
  assert.match(bridge, /sem chave, sem console de desenvolvedor e sem configuração técnica/i);
  assert.match(bridge, /Em preparação/);
  assert.match(bridge, /Nada será cobrado nesta tela agora/);
});

test('UI explains that consumer subscriptions do not automatically mean API access', () => {
  assert.match(bridge, /assinar ChatGPT, Gemini ou Claude não significa necessariamente ter acesso de API incluído/i);
  assert.match(bridge, /API pode ter cadastro, limites e cobrança próprios/i);
  assert.match(bridge, /Opção avançada/);
});

test('advanced provider cards link to official help and keep credentials protected', () => {
  assert.match(bridge, /ai\.google\.dev\/gemini-api\/docs\/get-started/);
  assert.match(bridge, /help\.openai\.com\/pt-br\/articles\/4936850/);
  assert.match(bridge, /docs\.anthropic\.com\/pt\/docs\/claude-code\/sdk/);
  assert.match(bridge, /target="_blank"/);
  assert.match(bridge, /rel="noreferrer"/);
  assert.match(bridge, /criptografada no cofre/);
});

test('UI states that own-provider inference avoids Kyrubia Credits and paid fallback is not silent', () => {
  assert.match(bridge, /não consome Créditos Kyrubia/);
  assert.match(bridge, /Fallback pago não acontece silenciosamente/);
  assert.match(bridge, /anexos continuam fora do roteamento da IA própria/);
});
