import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const loop = readFileSync('server/ai/kyrubiaUserProviderToolLoop.ts', 'utf8');
const runtime = readFileSync('server/ai/kyrubiaUserProviderRuntime.ts', 'utf8');

test('BYO-AI loop consumes the shared Kyrubia tool authority instead of duplicating ERP semantics', () => {
  assert.match(loop, /executeKyrubiaSharedReadTool/);
  assert.match(loop, /isKyrubiaErpReadTool/);
  assert.match(loop, /KYRUBIA_ALL_TOOLS/);
  assert.match(loop, /KYRUBIA_MUTATION_TOOL/);
  assert.doesNotMatch(loop, /createKyrubiaProductQuery|executeKyrubiaProductQuery/);
});

test('ERP tool results are returned to the same user provider as normalized tool_result turns', () => {
  assert.match(loop, /type: 'tool_result'/);
  assert.match(loop, /turnsWithReadResult/);
  assert.match(loop, /turns,/);
  assert.match(runtime, /input\.turns \?\? messagesToKyrubiaProviderTurns/);
});

test('create_note remains proposal-only and never executes persistence in the provider loop', () => {
  assert.match(loop, /kyrubiaCreateNoteProposalFromCall/);
  assert.match(loop, /actionProposal/);
  assert.doesNotMatch(loop, /setDoc|addDoc|updateDoc|deleteDoc|firebase\/firestore/);
});

test('unknown provider tools fail closed rather than executing or falling back silently', () => {
  assert.match(loop, /AI_PROVIDER_UNSUPPORTED_TOOL/);
  assert.match(loop, /ferramenta que o Kyrub não permite executar/);
  assert.doesNotMatch(loop, /GEMINI_API_KEY|kyrubia_credits|platform_legacy/);
});

test('the tool loop allows at most one ERP read follow-up before returning a response', () => {
  const calls = loop.match(/runKyrubiaUserProviderText\(/g) ?? [];
  assert.equal(calls.length, 2);
  assert.match(loop, /calls: 1/);
  assert.match(loop, /calls: 2/);
});
