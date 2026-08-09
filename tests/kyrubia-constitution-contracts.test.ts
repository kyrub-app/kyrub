import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

const constitution = read('../docs/kyrubia-constitution-v1.md');
const safeExecution = read('../docs/kyrubia-safe-execution-foundation.md');
const actionProtocol = read('../shared/kyrubActions.ts');
const actionEvents = read('../src/ai/actionEvents.ts');
const clientExecutor = read('../src/actions/noteActionService.ts');
const policyEngine = read('../server/actions/kyrubiaPolicyEngine.ts');
const serverExecutor = read('../server/actions/actionExecutionService.ts');

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
  assert.match(
    serverExecutor,
    /impact: \{\s*entityCount: 1,\s*reversibility: 'easy',\s*\}/
  );
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
  assert.match(clientExecutor, /\/api\/actions\/execute/);

  assert.match(serverExecutor, /adminAuth\.verifyIdToken\(token, true\)/);
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
