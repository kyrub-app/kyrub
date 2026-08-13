import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { KyrubAiPrepareProductDraftProposal } from '../shared/kyrubActions';
import {
  KYRUB_ACTION_REGISTRY,
} from '../shared/kyrubActions';
import {
  resolveKyrubiaDeterministicProductDraft,
} from '../shared/kyrubiaDeterministicProductDraft';
import { evaluateKyrubActionPolicy } from '../server/actions/kyrubiaPolicyEngine';

const proposal = (
  inputProvenance: KyrubAiPrepareProductDraftProposal['inputProvenance'] = 'user_intent'
): KyrubAiPrepareProductDraftProposal => ({
  id: 'catalog-draft-test',
  type: 'prepare_product_draft',
  product: {
    name: 'Café Pilão 500g',
    price: 19.9,
    stock: 12,
    category: 'Mercearia',
  },
  source: { kind: 'conversation', conversationId: 'conversation-1' },
  fieldProvenance: {
    name: 'user_intent',
    price: 'user_intent',
    stock: 'user_intent',
    category: 'user_intent',
  },
  issues: [],
  requiresConfirmation: false,
  origin: 'kyrubia',
  risk: 'low',
  inputProvenance,
  impact: { entityCount: 1, reversibility: 'easy' },
});

test('explicit product draft parses only labelled user values and does not publish anything', () => {
  const resolved = resolveKyrubiaDeterministicProductDraft(
    'Prepare um rascunho do produto "Café Pilão 500g", preço R$ 19,90, estoque 12, categoria "Mercearia".'
  );
  assert.ok(resolved);
  assert.deepEqual(resolved.product, {
    name: 'Café Pilão 500g',
    price: 19.9,
    stock: 12,
    category: 'Mercearia',
  });
  assert.equal(resolved.fieldProvenance.name, 'user_intent');
  assert.equal(resolved.fieldProvenance.price, 'user_intent');
  assert.equal(resolved.issues.length, 0);
});

test('draft parser flags missing publish fields instead of guessing them', () => {
  const resolved = resolveKyrubiaDeterministicProductDraft(
    'Crie um rascunho do produto "Produto sem dados".'
  );
  assert.ok(resolved);
  assert.deepEqual(resolved.product, { name: 'Produto sem dados' });
  assert.deepEqual(
    resolved.issues.map(issue => issue.field),
    ['price', 'category']
  );
  assert.equal(
    resolveKyrubiaDeterministicProductDraft(
      'Crie um produto "Produto real" por R$ 10,00.'
    ),
    null
  );
});

test('prepare_product_draft is low risk, preauthorized only for direct user intent', () => {
  assert.deepEqual(KYRUB_ACTION_REGISTRY.prepare_product_draft, {
    type: 'prepare_product_draft',
    mode: 'write',
    risk: 'low',
    requiresConfirmation: false,
    permission: 'products.drafts.write',
    maxAffectedEntities: 1,
  });

  const allowed = evaluateKyrubActionPolicy(proposal('user_intent'), {
    actorUid: 'user-1',
    permissions: ['products.drafts.write'],
    confirmed: false,
    decisionId: 'decision-allow',
  });
  assert.equal(allowed.outcome, 'allow');

  for (const provenance of [
    'document_content',
    'tool_output',
    'ai_generated_content',
  ] as const) {
    const blocked = evaluateKyrubActionPolicy(proposal(provenance), {
      actorUid: 'user-1',
      permissions: ['products.drafts.write'],
      confirmed: false,
      decisionId: `decision-${provenance}`,
    });
    assert.equal(blocked.outcome, 'require_confirmation');
    assert.ok(blocked.reasons.includes('UNTRUSTED_INPUT_REQUIRES_CONFIRMATION'));
  }
});

test('catalog drafts live in a private staging namespace and produce authoritative receipts', () => {
  const server = readFileSync(
    new URL('../server/actions/catalogDraftExecutionService.ts', import.meta.url),
    'utf8'
  );
  assert.match(server, /kyrub_catalog_drafts\/\$\{actor\.uid\}\/drafts\/\$\{draftId\}/);
  assert.match(server, /kyrub_action_receipts\/\$\{envelope\.executionId\}/);
  assert.match(server, /targetType: 'product_draft'/);
  assert.match(server, /users\/\$\{uid\}\/stores\/\$\{uid\}/);
  assert.match(server, /permissions: \['products\.drafts\.write'\]/);
  assert.doesNotMatch(server, /publicProducts/);
  assert.doesNotMatch(server, /productLimit/);
  assert.doesNotMatch(server, /maxProducts/);
});

test('draft preparation and listing bypass plan reconciliation but not auth or policy', () => {
  const api = readFileSync(new URL('../api/action-execute.ts', import.meta.url), 'utf8');
  const draftList = api.indexOf('if (isKyrubCatalogDraftListRequest(request.body))');
  const draftWrite = api.indexOf('if (isKyrubCatalogDraftExecutionRequest(request.body))');
  const reconcile = api.indexOf('await reconcileStoreEntitlementFromAuthorization(authorization);');
  assert.ok(draftList >= 0 && draftList < reconcile);
  assert.ok(draftWrite >= 0 && draftWrite < reconcile);

  const server = readFileSync(
    new URL('../server/actions/catalogDraftExecutionService.ts', import.meta.url),
    'utf8'
  );
  assert.match(server, /verifyFirebaseIdToken/);
  assert.match(server, /evaluateKyrubActionPolicy/);
  assert.match(server, /operation === 'list_catalog_drafts'/);
  assert.match(server, /kyrub_catalog_drafts\/\$\{actor\.uid\}\/drafts/);
});

test('operational runtime resolves draft staging before any live product workflow', () => {
  const runtime = readFileSync(
    new URL('../src/ai/operationalWorkflowRuntime.ts', import.meta.url),
    'utf8'
  );
  const draftRuntime = runtime.indexOf('await resolveKyrubiaCatalogDraftRuntime(');
  const localWorkflow = runtime.indexOf("if (typeof localStorage === 'undefined') return null;");
  const productParser = runtime.indexOf('const productDraft = parseInitialProductDraft(input.message);');
  assert.ok(draftRuntime >= 0);
  assert.ok(draftRuntime < localWorkflow);
  assert.ok(draftRuntime < productParser);
  assert.match(runtime, /'prepare_product_draft'/);
});

test('browser draft runtime executes through the safe action service and lists without Gemini', () => {
  const runtime = readFileSync(new URL('../src/ai/catalogDraftRuntime.ts', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../src/actions/kyrubCatalogDraftService.ts', import.meta.url), 'utf8');
  const actionService = readFileSync(new URL('../src/actions/kyrubActionService.ts', import.meta.url), 'utf8');

  assert.match(runtime, /resolveKyrubiaDeterministicProductDraft/);
  assert.match(runtime, /executePreauthorizedProductDraftAction/);
  assert.match(runtime, /listKyrubCatalogDrafts/);
  assert.match(runtime, /nenhum produto foi publicado/i);
  assert.doesNotMatch(runtime, /consultant|gemini|generateContent/i);

  assert.match(client, /operation: 'list_catalog_drafts'/);
  assert.match(client, /authorization: `Bearer \$\{token\}`/);
  assert.match(actionService, /executePreauthorizedProductDraftAction/);
  assert.match(actionService, /const result = await executeKyrubAction\(user, proposal, false\);/);
  assert.match(actionService, /recordConfirmedKyrubiaActionResult\(user\.uid, proposal, result, true\);/);
});

test('recent authoritative recap uses a human product-draft label', () => {
  const trusted = readFileSync(new URL('../src/ai/trustedReadRuntime.ts', import.meta.url), 'utf8');
  assert.match(
    trusted,
    /prepare_product_draft: 'preparar um rascunho de produto pela Kyrubia'/
  );
});
