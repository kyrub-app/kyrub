import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workspace = readFileSync(
  'src/components/KyrubAiWorkspaceBridge.tsx',
  'utf8'
);
const providerSettings = readFileSync(
  'src/components/KyrubAiProviderSettingsBridge.tsx',
  'utf8'
);
const externalBridge = readFileSync(
  'src/components/KyrubiaExternalBridgeControls.tsx',
  'utf8'
);
const externalBridgeEvents = readFileSync(
  'src/ai/kyrubiaExternalBridgeEvents.ts',
  'utf8'
);

test('Kyrubia uses the clean conversation shell requested for the primary workspace', () => {
  assert.match(workspace, /aria-label="Abrir conversas"/);
  assert.doesNotMatch(workspace, /aria-label="Mais opções da Kyrubia"/);
  assert.match(workspace, /aria-label="Anexar ou conectar IA"/);
  assert.match(workspace, /aria-label="Enviar mensagem para a Kyrubia"/);
  assert.match(workspace, /Mensagem para a Kyrubia\.\.\./);
});

test('the plus menu reuses attachments, camera and the canonical provider settings', () => {
  assert.match(workspace, /Anexar imagem ou PDF/);
  assert.match(workspace, /Usar câmera/);
  assert.match(workspace, /Conectar minha IA/);
  assert.match(workspace, /KyrubAiAttachmentPicker/);
  assert.match(workspace, /findProviderSettingsTrigger/);
  assert.match(workspace, /kyrub-ai-provider-settings-host/);
  assert.match(providerSettings, /google-gemini/);
  assert.match(providerSettings, /openai/);
  assert.match(providerSettings, /anthropic/);
});

test('ChatGPT bridge is consolidated inside Minha IA without changing the tested bridge semantics', () => {
  assert.match(providerSettings, /Conectar ChatGPT à Kyrubia/);
  assert.match(providerSettings, /Ponte temporária/);
  assert.match(providerSettings, /openKyrubiaExternalBridge/);
  assert.match(providerSettings, /não é a mesma coisa que usar uma chave da OpenAI como motor da Kyrubia/);
  assert.doesNotMatch(externalBridge, /mb-3 flex justify-end/);
  assert.match(externalBridge, /KYRUBIA_EXTERNAL_BRIDGE_OPEN_EVENT/);
  assert.match(externalBridge, /ttlMinutes: 120/);
  assert.match(externalBridge, /label: 'ChatGPT bridge'/);
  assert.match(externalBridge, /Conectar ChatGPT temporariamente/);
  assert.match(externalBridge, /proposal only/);
  assert.match(externalBridgeEvents, /kyrubia-external-bridge-open/);
});

test('conversation history stays available from the hamburger drawer', () => {
  assert.match(workspace, /Conversas da Kyrubia/);
  assert.match(workspace, /Nova conversa/);
  assert.match(workspace, /conversations\.map/);
  assert.match(workspace, /deleteConversation/);
  assert.match(workspace, /setActiveConversationId/);
});

test('Cairúbia opens with personal assistant presentation and retains conversation history', () => {
  const welcome = readFileSync('src/components/KyrubiaWelcomePanel.tsx', 'utf8');
  const guest = readFileSync('src/components/KyrubGuestWorkspace.tsx', 'utf8');
  assert.match(workspace, /<KyrubiaWelcomePanel/);
  assert.match(guest, /<KyrubiaWelcomePanel/);
  assert.match(workspace, /activeConversation\.messages\.length === 0/);
  assert.match(workspace, /setDraft\(prompt\)/);
  assert.match(workspace, /onConnectAi=\{openProviderSettings\}/);
  assert.match(workspace, /findProviderSettingsTrigger/);
  assert.match(welcome, /Olá! Eu sou a Cairúbia/);
  assert.match(welcome, /Organizar o dia e preparar tarefas/);
  assert.match(welcome, /Explicar recursos do Kyrub/);
  assert.match(welcome, /Pesquisa na internet e criação de imagens dependem/);
  assert.match(welcome, /Alguns provedores exigem uma chave de API/);
  assert.match(welcome, /Conectar minha IA/);
  assert.match(welcome, /Sugestões não executam ações automaticamente/);
  assert.doesNotMatch(workspace, /educatorOpen|startEducatorConversation|EllipsisVertical|Kyrubia Educadora/);
  assert.match(workspace, /conversations\.map/);
  assert.match(workspace, /loadKyrubAiConversations/);
  assert.match(workspace, /saveKyrubAiConversations/);
});

test('the clean shell preserves authoritative and multimodal Kyrubia runtime paths', () => {
  assert.match(workspace, /requestKyrubAiConsultant/);
  assert.match(workspace, /requestKyrubAiMultimodalConsultant/);
  assert.match(workspace, /routeKyrubiaStorePromotionFromWorkspace/);
  assert.match(workspace, /KYRUBIA_OPERATIONAL_WORKFLOW_MESSAGE_EVENT/);
  assert.match(workspace, /turnContext: conversation\.lastTurnContext/);
  assert.match(workspace, /lastTurnContext: result\.turnContext/);
  assert.match(workspace, /selectedOfferedIntentId/);
});


