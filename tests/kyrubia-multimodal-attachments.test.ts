import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { KYRUB_AI_ATTACHMENT_LIMITS } from '../shared/aiConsultant';
import {
  authorityForKyrubAnalyticsSource,
  validateKyrubAnalyticsEventInput,
} from '../shared/kyrubAnalyticsEvents';
import {
  KYRUBIA_DEFAULT_ECONOMY_MODEL,
  KYRUBIA_DEFAULT_PRIMARY_MODEL,
  alternateGeminiModel,
  selectKyrubiaGeminiModel,
  shouldPreferEconomyModel,
} from '../shared/kyrubiaProviderResilience';
import {
  estimateGeminiUsageCost,
  parseGeminiUsageMetadata,
} from '../shared/kyrubiaUsageMetering';

const read = (path: string): string => readFileSync(path, 'utf8');

const workspace = read('src/components/KyrubAiWorkspaceBridge.tsx');
const picker = read('src/components/KyrubAiAttachmentPicker.tsx');
const attachmentClient = read('src/ai/kyrubiaAttachmentService.ts');
const multimodalClient = read('src/ai/multimodalConsultantClient.ts');
const conversationStore = read('src/ai/conversationStore.ts');
const api = read('api/kyrubia.ts');
const serverStorage = read('server/kyrubiaAttachmentStorage.ts');
const usageMetering = read('server/kyrubiaUsageMetering.ts');
const adminDirectory = read('src/utils/adminDirectory.ts');
const storageRules = read('storage.rules');

test('Kyrubia attachment limits stay deliberately bounded', () => {
  assert.equal(KYRUB_AI_ATTACHMENT_LIMITS.maxFilesPerMessage, 4);
  assert.equal(KYRUB_AI_ATTACHMENT_LIMITS.maxImageBytes, 8 * 1024 * 1024);
  assert.equal(KYRUB_AI_ATTACHMENT_LIMITS.maxPdfBytes, 10 * 1024 * 1024);
  assert.equal(KYRUB_AI_ATTACHMENT_LIMITS.maxTotalBytesPerMessage, 16 * 1024 * 1024);
});

test('Kyrubia UI supports gallery, multiple files, PDF, camera and removal before send', () => {
  assert.match(picker, /type="file"/);
  assert.match(picker, /multiple/);
  assert.match(picker, /application\/pdf/);
  assert.match(picker, /image\/jpeg/);
  assert.match(picker, /image\/png/);
  assert.match(picker, /image\/webp/);
  assert.match(picker, /capture="environment"/);
  assert.match(picker, /Remover \$\{file\.name\}/);
  assert.match(workspace, /pendingAttachmentFiles/);
  assert.match(workspace, /Enviando anexos/);
  assert.match(workspace, /KyrubAiAttachmentSummary/);
});

test('attachment bytes stay out of localStorage and uploads have private binding metadata', () => {
  assert.match(attachmentClient, /kyrubia-attachments/);
  assert.match(attachmentClient, /ownerId: user\.uid/);
  assert.match(attachmentClient, /conversationId/);
  assert.match(attachmentClient, /purpose: 'kyrubia-conversation'/);
  assert.doesNotMatch(attachmentClient, /getDownloadURL/);
  assert.doesNotMatch(conversationStore, /readAsDataURL|arrayBuffer\(|base64/i);
  assert.match(conversationStore, /storagePath/);
  assert.match(conversationStore, /sanitizeAttachments/);
});

test('any conversation containing attachments bypasses local deterministic action routing', () => {
  assert.match(workspace, /hasMultimodalHistory/);
  assert.match(workspace, /requestKyrubAiMultimodalConsultant/);
  assert.match(multimodalClient, /KYRUB_AI_CONSULTANT_ENDPOINT/);
  assert.doesNotMatch(multimodalClient, /CONSULTANT_COMPAT|LEGACY_ENDPOINT/);
  assert.match(multimodalClient, /hasAttachments/);
});

test('server binds attachment references to authenticated actor and conversation before reading bytes', () => {
  assert.match(api, /normalizeConversation\(requestBody\(request\.body\), user\.uid\)/);
  assert.match(api, /kyrubia-attachments\/\$\{uid\}\/\$\{conversationId\}\/\$\{id\}/);
  assert.match(serverStorage, /expectedPath\(uid, conversationId, attachment\.id\)/);
  assert.match(serverStorage, /custom\.ownerId !== uid/);
  assert.match(serverStorage, /custom\.conversationId !== conversationId/);
  assert.match(serverStorage, /custom\.attachmentId !== attachment\.id/);
  assert.match(serverStorage, /custom\.purpose !== 'kyrubia-conversation'/);
  assert.match(serverStorage, /actualSize !== attachment\.size/);
});

test('Gemini receives only verified inline media while old media is not retransmitted repeatedly', () => {
  assert.match(serverStorage, /inline_data/);
  assert.match(serverStorage, /mime_type/);
  assert.match(serverStorage, /bytes\.toString\('base64'\)/);
  assert.match(api, /latestAttachmentMessageIndex/);
  assert.match(api, /loadKyrubiaInlineAttachmentParts/);
  assert.match(api, /lote multimodal mais recente é o único retransmitido/);
});

test('multimodal context cannot silently authorize Kyrub writes', () => {
  assert.match(api, /Anexos multimodais/i);
  assert.match(api, /nunca concedem autorização para gravar, publicar, editar ou excluir/i);
  assert.match(api, /conteúdo não confiável/i);
  assert.match(workspace, /Anexos são contexto da conversa/);
});

test('Storage rules keep Kyrubia attachments private and immutable after create', () => {
  assert.match(storageRules, /match \/kyrubia-attachments\/\{userId\}\/\{conversationId\}\/\{attachmentId\}/);
  assert.match(storageRules, /allow read: if isSignedIn\(\)\s*&& request\.auth\.uid == userId/);
  assert.match(storageRules, /allow create: if isSignedIn\(\)/);
  assert.match(storageRules, /request\.resource\.metadata\.ownerId == userId/);
  assert.match(storageRules, /request\.resource\.metadata\.conversationId == conversationId/);
  assert.match(storageRules, /request\.resource\.metadata\.attachmentId == attachmentId/);
  assert.match(storageRules, /allow update: if false/);
  assert.match(storageRules, /allow delete: if isSignedIn\(\)\s*&& request\.auth\.uid == userId/);
});

test('simple multimodal inspection uses the economical Gemini route first', () => {
  assert.equal(KYRUBIA_DEFAULT_PRIMARY_MODEL, 'gemini-3.6-flash');
  assert.equal(KYRUBIA_DEFAULT_ECONOMY_MODEL, 'gemini-3.5-flash-lite');
  assert.equal(shouldPreferEconomyModel('O que aparece nesta imagem?', true), true);
  assert.deepEqual(
    selectKyrubiaGeminiModel({
      latestUserText: 'O que aparece nesta imagem?',
      hasMultimodalContext: true,
    }),
    {
      preferredModel: 'gemini-3.5-flash-lite',
      fallbackModel: 'gemini-3.6-flash',
      route: 'economy',
    }
  );
});

test('text-only and complex multimodal requests preserve the primary route', () => {
  assert.equal(shouldPreferEconomyModel('O que aparece nesta imagem?', false), false);
  assert.equal(
    shouldPreferEconomyModel(
      'Compare estes documentos e recomende uma estratégia financeira.',
      true
    ),
    false
  );
});

test('provider resilience is a single alternate model on quota, never a retry loop', () => {
  const selection = selectKyrubiaGeminiModel({
    latestUserText: 'Leia este PDF.',
    hasMultimodalContext: true,
  });
  assert.equal(
    alternateGeminiModel(selection.preferredModel, selection),
    selection.fallbackModel
  );
  assert.match(api, /GEMINI_ECONOMY_MODEL/);
  assert.match(api, /callGeminiWithFallback/);
  assert.match(api, /Gemini quota exhausted/);
  assert.match(api, /Gemini fallback activated/);
  assert.match(api, /fallbackUsed/);
  assert.doesNotMatch(api, /for\s*\(;;\)|while\s*\(true\)/);
});

test('Gemini usage metadata is normalized without retaining prompt or response content', () => {
  const usage = parseGeminiUsageMetadata({
    usageMetadata: {
      promptTokenCount: 1_000,
      cachedContentTokenCount: 0,
      candidatesTokenCount: 100,
      toolUsePromptTokenCount: 12,
      thoughtsTokenCount: 50,
      totalTokenCount: 1_150,
      promptTokensDetails: [
        { modality: 'TEXT', tokenCount: 700 },
        { modality: 'IMAGE', tokenCount: 300 },
      ],
      candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 100 }],
      serviceTier: 'STANDARD',
    },
  });

  assert.ok(usage);
  assert.equal(usage.promptTokenCount, 1_000);
  assert.equal(usage.candidatesTokenCount, 100);
  assert.equal(usage.thoughtsTokenCount, 50);
  assert.equal(usage.promptTokensDetails[1]?.modality, 'IMAGE');
  assert.equal(usage.promptTokensDetails[1]?.tokenCount, 300);
});

test('current Gemini standard price snapshots produce integer micro-USD estimates', () => {
  const usage = parseGeminiUsageMetadata({
    usageMetadata: {
      promptTokenCount: 1_000,
      candidatesTokenCount: 100,
      thoughtsTokenCount: 50,
      totalTokenCount: 1_150,
      serviceTier: 'STANDARD',
    },
  });
  assert.ok(usage);

  assert.deepEqual(
    estimateGeminiUsageCost('gemini-3.5-flash-lite', usage),
    {
      estimatedCostMicrousd: 675,
      pricingStatus: 'priced',
      pricing: {
        provider: 'google-gemini',
        model: 'gemini-3.5-flash-lite',
        serviceTier: 'standard',
        currency: 'USD',
        unit: 'per_1m_tokens',
        inputUsdPerMillion: 0.3,
        outputUsdPerMillion: 2.5,
        effectiveFrom: '2026-07-21',
        source: 'Google AI for Developers — Latest Gemini models / pricing',
      },
    }
  );
  assert.equal(
    estimateGeminiUsageCost('gemini-3.6-flash', usage).estimatedCostMicrousd,
    2_625
  );
});

test('metering ledger is immutable, server-owned and stores technical usage rather than conversation content', () => {
  assert.match(usageMetering, /kyrub_usage_events/);
  assert.match(usageMetering, /\.create\(\{/);
  assert.match(usageMetering, /FieldValue\.serverTimestamp\(\)/);
  assert.match(usageMetering, /estimatedCostMicrousd/);
  assert.match(usageMetering, /promptTokensDetails/);
  assert.doesNotMatch(usageMetering, /promptText|responseText|conversationContent/);
});

test('Kyrubia runtime meters the first provider call and any ERP follow-up with one request identity', () => {
  assert.match(api, /recordKyrubiaAiUsage/);
  assert.match(api, /recordUsageSafely/);
  assert.match(api, /callIndex:\s*1/);
  assert.match(api, /callIndex:\s*2/);
  assert.match(api, /operation:\s*'erp_read_followup'/);
  assert.match(api, /usageMeteringEnabled:\s*true/);
  assert.match(api, /const requestId = createRequestId\(\)/);
  assert.match(api, /generateReply\(user, conversation, requestId\)/);
});

test('metering failure remains isolated from the Kyrubia response path', () => {
  assert.match(api, /Usage metering write failed/);
  assert.match(api, /await recordKyrubiaAiUsage\(input\)/);
  assert.match(api, /recordUsageSafely/);
});

test('admin usage summary marks bounded reads as partial instead of claiming a lifetime total', () => {
  assert.match(adminDirectory, /AI_USAGE_SUMMARY_LIMIT = 500/);
  assert.match(adminDirectory, /limit\(AI_USAGE_SUMMARY_LIMIT \+ 1\)/);
  assert.match(adminDirectory, /partial = snapshots\.size > AI_USAGE_SUMMARY_LIMIT/);
  assert.match(adminDirectory, /documents = snapshots\.docs\.slice\(0, AI_USAGE_SUMMARY_LIMIT\)/);
});

test('client observations cannot become authoritative Kyrub economics', () => {
  assert.equal(
    authorityForKyrubAnalyticsSource('client_observation'),
    'behavior_only'
  );

  const errors = validateKyrubAnalyticsEventInput({
    name: 'order.completed',
    layer: 'economics',
    domain: 'order',
    source: 'client_observation',
    actorUid: 'uid-1',
    amountMinor: 12_990,
    currency: 'BRL',
  });

  assert.ok(errors.includes('economics_requires_authoritative_source'));
  assert.ok(errors.includes('money_requires_authoritative_economics'));
});
