import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './kyrubia-user-ai-provider-vault.test';
import { decideKyrubiaAiRoute } from '../shared/kyrubiaAiRouting';

const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

const constitution = read('../docs/kyrubia-constitution-v1.md');
const safeExecution = read('../docs/kyrubia-safe-execution-foundation.md');
const actionProtocol = read('../shared/kyrubActions.ts');
const actionEvents = read('../src/ai/actionEvents.ts');
const clientExecutor = read('../src/actions/kyrubActionService.ts');
const policyEngine = read('../server/actions/kyrubiaPolicyEngine.ts');
const serverExecutor = read('../server/actions/actionExecutionService.ts');
const usageMetering = read('../server/kyrubiaUsageMetering.ts');

test('constitution contract: context and memory never become operational authority', () => {
  assert.match(constitution, /Contexto nunca significa autorização\./);
  assert.match(
    constitution,
    /Memória resolve contexto; Kyrub resolve verdade/
  );
  assert.match(
    constitution,
    /Antes de executar uma ação, o Kyrub deve reconsultar o estado oficial aplicável e revalidar autorização, permissões e condições atuais\./
  );
});

test('constitution contract: observed content cannot silently promote itself to command authority', () => {
  assert.match(safeExecution, /Conteúdo observado não é comando/);
  assert.match(
    actionEvents,
    /inputProvenance: proposal\.inputProvenance \?\? 'ai_generated_content'/
  );
  assert.doesNotMatch(
    actionEvents,
    /inputProvenance: proposal\.inputProvenance \?\? 'user_intent'/
  );
  assert.match(policyEngine, /UNTRUSTED_INPUT_REQUIRES_CONFIRMATION/);
  assert.match(policyEngine, /!context\.confirmed/);
});

test('constitution contract: permission does not imply unlimited scale', () => {
  assert.match(safeExecution, /Permissão não implica escala/);
  assert.match(actionProtocol, /maxAffectedEntities/);
  assert.match(policyEngine, /BLAST_RADIUS_EXCEEDED/);
  assert.match(policyEngine, /impact\.entityCount > definition\.maxAffectedEntities/);
  assert.match(serverExecutor, /const metadataFor/);
  assert.match(serverExecutor, /entityCount: 1/);
  assert.match(
    serverExecutor,
    /reversibility: proposal\.type === 'create_product' \? 'limited' : 'easy'/
  );
  assert.doesNotMatch(serverExecutor, /impact: candidate\.impact/);
});

test('constitution contract: authorization stays bound to a specific proposal', () => {
  assert.match(
    safeExecution,
    /Autorização pertence à proposta, não ao modelo/
  );
  assert.match(serverExecutor, /hashKyrubActionProposal/);
  assert.match(serverExecutor, /proposalHash/);
  assert.match(serverExecutor, /policyDecisionId/);
  assert.match(serverExecutor, /idempotencyKey/);
});

test('constitution contract: Kyrubia client cannot perform the official commit', () => {
  assert.doesNotMatch(clientExecutor, /firebase\/firestore/);
  assert.doesNotMatch(clientExecutor, /runTransaction/);
  assert.match(clientExecutor, /\/api\/action-execute/);

  assert.match(serverExecutor, /verifyFirebaseIdToken\(token\)/);
  assert.doesNotMatch(serverExecutor, /adminAuth\.verifyIdToken/);
  assert.match(serverExecutor, /evaluateKyrubActionPolicy/);
  assert.match(serverExecutor, /adminDb\.runTransaction/);
});

test('constitution contract: relevant execution remains explainable and receipted', () => {
  assert.match(
    constitution,
    /Toda ação relevante deve ser explicável e auditável/
  );
  assert.match(safeExecution, /Toda execução deixa um recibo/);
  assert.match(serverExecutor, /kyrub_action_receipts/);
  assert.match(serverExecutor, /authorizationMode/);
  assert.match(serverExecutor, /targetId/);
  assert.match(serverExecutor, /result: 'success'/);
});

test('BYO-AI contract: deterministic work never consumes Kyrubia Credits', () => {
  assert.deepEqual(
    decideKyrubiaAiRoute({
      workload: 'deterministic',
      userProvider: {
        connected: false,
        available: false,
      },
      credits: {
        enabled: true,
        balance: 999,
      },
    }),
    {
      mode: 'deterministic',
      fundingSource: 'none',
      consumeCredits: false,
      reason: 'llm_not_required',
    }
  );
});

test('BYO-AI contract: connected user provider has priority and costs zero Kyrubia Credits', () => {
  assert.deepEqual(
    decideKyrubiaAiRoute({
      workload: 'llm_multimodal',
      userProvider: {
        connected: true,
        available: true,
        provider: 'google-gemini',
      },
      credits: {
        enabled: true,
        balance: 50,
      },
    }),
    {
      mode: 'user_provider',
      fundingSource: 'user_provider',
      consumeCredits: false,
      provider: 'google-gemini',
      reason: 'user_provider_available',
    }
  );
});

test('BYO-AI contract: paid fallback is never silent after a user provider failure', () => {
  assert.deepEqual(
    decideKyrubiaAiRoute({
      workload: 'llm_text',
      userProvider: {
        connected: true,
        available: false,
        provider: 'openai',
      },
      credits: {
        enabled: true,
        balance: 12,
      },
      paidFallbackConsent: 'none',
    }),
    {
      mode: 'consent_required',
      fundingSource: 'none',
      consumeCredits: false,
      reason: 'provider_failed_paid_fallback_requires_consent',
    }
  );
});

test('BYO-AI contract: approved paid fallback may route through Kyrubia Credits', () => {
  assert.deepEqual(
    decideKyrubiaAiRoute({
      workload: 'llm_text',
      userProvider: {
        connected: true,
        available: false,
        provider: 'anthropic',
      },
      credits: {
        enabled: true,
        balance: 12,
      },
      paidFallbackConsent: 'once',
    }),
    {
      mode: 'kyrubia_credits',
      fundingSource: 'kyrubia_credits',
      consumeCredits: true,
      reason: 'paid_fallback_approved',
    }
  );
});

test('BYO-AI contract: credits mode remains available when no provider is connected', () => {
  assert.deepEqual(
    decideKyrubiaAiRoute({
      workload: 'llm_text',
      userProvider: {
        connected: false,
        available: false,
      },
      credits: {
        enabled: true,
        balance: 7,
      },
    }),
    {
      mode: 'kyrubia_credits',
      fundingSource: 'kyrubia_credits',
      consumeCredits: true,
      reason: 'credits_mode',
    }
  );
});

test('BYO-AI contract: no provider and no credits blocks only the generative route', () => {
  assert.deepEqual(
    decideKyrubiaAiRoute({
      workload: 'llm_multimodal',
      userProvider: {
        connected: false,
        available: false,
      },
      credits: {
        enabled: false,
        balance: 0,
      },
    }),
    {
      mode: 'blocked',
      fundingSource: 'none',
      consumeCredits: false,
      reason: 'provider_or_credits_required',
    }
  );
});

test('BYO-AI contract: usage events are ready to record provider and funding authority separately', () => {
  assert.match(usageMetering, /provider\?: KyrubiaAiProviderId/);
  assert.match(usageMetering, /fundingSource\?: KyrubiaAiFundingSource/);
  assert.match(usageMetering, /fundingSource = input\.fundingSource \?\? 'platform_legacy'/);
  assert.match(usageMetering, /schemaVersion: 2/);
});
