import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  KYRUB_CATALOG_ANALYSIS_MAX_ITEMS,
  normalizeKyrubCatalogAnalysis,
  summarizeKyrubCatalogAnalysis,
} from '../shared/kyrubCatalogAnalysis';
import {
  isKyrubiaCatalogAnalysisText,
  shouldUseKyrubiaCatalogAnalysis,
} from '../shared/kyrubiaCatalogAnalysisIntent';
import { prepareKyrubAiCatalogAnalysisContext } from '../src/ai/catalogAnalysisContext';
import { saveKyrubiaCatalogAnalysis } from '../src/ai/catalogAnalysisStore';

test('catalog analysis intent is explicit and contextual follow-up requires stored analysis', () => {
  assert.equal(
    isKyrubiaCatalogAnalysisText('Analise este catálogo e organize os produtos.'),
    true
  );
  assert.equal(
    isKyrubiaCatalogAnalysisText('Quais itens aparecem neste cardápio?'),
    true
  );
  assert.equal(
    isKyrubiaCatalogAnalysisText('Descreva esta foto do bolo.'),
    false
  );
  assert.equal(
    shouldUseKyrubiaCatalogAnalysis([
      { role: 'user', content: 'Analise o anexo “catalogo-verao.pdf”.' },
    ]),
    true
  );
  const followup = [
    { role: 'user' as const, content: 'Dessa lista, quais são os três primeiros e quais precisam de revisão?' },
  ];
  assert.equal(shouldUseKyrubiaCatalogAnalysis(followup), false);
  assert.equal(shouldUseKyrubiaCatalogAnalysis(followup, true), true);
});

test('catalog analysis context hydration is scoped to the same UID and conversation', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  } as unknown as Storage;
  const analysis = normalizeKyrubCatalogAnalysis({
    summary: 'Catálogo de teste.',
    segment: 'Mercearia',
    segmentConfidence: 'high',
    categories: ['Bebidas'],
    items: [{
      ref: 'item-1',
      kind: 'product',
      name: 'Suco',
      category: 'Bebidas',
      price: 12.5,
      priceStatus: 'observed',
      stockStatus: 'missing',
      issues: [],
    }],
    conflicts: [],
    duplicates: [],
    warnings: [],
  }, { sourceKind: 'multimodal', attachmentCount: 1 });
  assert.ok(analysis);
  saveKyrubiaCatalogAnalysis(storage, 'uid-a', 'conv-a', analysis);

  const payload = {
    conversationId: 'conv-a',
    topic: 'Catálogo',
    messages: [{ role: 'user' as const, content: 'Dessa lista, quais são os primeiros?' }],
  };
  const hydrated = prepareKyrubAiCatalogAnalysisContext(payload, storage, 'uid-a');
  assert.equal(hydrated.catalogAnalysisContext?.items[0]?.name, 'Suco');
  assert.equal(
    prepareKyrubAiCatalogAnalysisContext(payload, storage, 'uid-b').catalogAnalysisContext,
    undefined
  );
  assert.equal(
    prepareKyrubAiCatalogAnalysisContext(
      { ...payload, conversationId: 'conv-b' },
      storage,
      'uid-a'
    ).catalogAnalysisContext,
    undefined
  );
});

test('catalog normalizer keeps only explicitly observed values and aligns draft readiness', () => {
  const analysis = normalizeKyrubCatalogAnalysis({
    summary: 'Tabela de produtos.',
    segment: 'Mercearia',
    segmentConfidence: 'high',
    categories: ['Bebidas'],
    items: [
      {
        ref: 'item-1',
        kind: 'product',
        name: 'Suco',
        category: 'Bebidas',
        price: 12.5,
        priceStatus: 'observed',
        stock: 8,
        stockStatus: 'observed',
        issues: [],
      },
      {
        ref: 'item-2',
        kind: 'product',
        name: 'Bolo',
        category: 'Doces',
        price: 999,
        priceStatus: 'missing',
        stock: 999,
        stockStatus: 'ambiguous',
        issues: ['Preço não legível'],
      },
    ],
    conflicts: [],
    duplicates: [],
    warnings: [],
  }, { sourceKind: 'multimodal', attachmentCount: 1 });

  assert.ok(analysis);
  assert.equal(analysis.authoritative, false);
  assert.equal(analysis.writesPerformed, false);
  assert.equal(analysis.publicationStatus, 'analysis_only');
  assert.equal(analysis.items[0].price, 12.5);
  assert.equal(analysis.items[0].stock, 8);
  assert.equal(analysis.items[1].price, null);
  assert.equal(analysis.items[1].stock, null);
  assert.equal(analysis.readyForDraftCount, 1);
  assert.equal(analysis.needsReviewCount, 1);
  assert.match(summarizeKyrubCatalogAnalysis(analysis), /Nenhum produto, rascunho ou publicação foi criado/i);
});

test('missing category needs review while service does not require stock for draft readiness', () => {
  const analysis = normalizeKyrubCatalogAnalysis({
    items: [
      {
        ref: 'item-1', kind: 'product', name: 'Produto sem categoria',
        category: '', price: 10, priceStatus: 'observed', stockStatus: 'missing', issues: [],
      },
      {
        ref: 'item-2', kind: 'service', name: 'Corte',
        category: 'Serviços', price: 35, priceStatus: 'observed', stockStatus: 'missing', issues: [],
      },
    ],
  }, { sourceKind: 'text', attachmentCount: 0 });
  assert.ok(analysis);
  assert.equal(analysis.readyForDraftCount, 1);
  assert.equal(analysis.needsReviewCount, 1);
});

test('catalog normalizer enforces the server-facing 60 item hard cap and deterministic warning', () => {
  const items = Array.from({ length: KYRUB_CATALOG_ANALYSIS_MAX_ITEMS + 1 }, (_, index) => ({
    ref: `item-${index + 1}`,
    kind: 'product',
    name: `Produto ${index + 1}`,
    category: 'Teste',
    price: index + 1,
    priceStatus: 'observed',
    stockStatus: 'missing',
    issues: [],
  }));
  const analysis = normalizeKyrubCatalogAnalysis({ items, warnings: [] }, {
    sourceKind: 'text',
    attachmentCount: 0,
  });
  assert.ok(analysis);
  assert.equal(analysis.items.length, KYRUB_CATALOG_ANALYSIS_MAX_ITEMS);
  assert.match(analysis.warnings.at(-1) ?? '', /truncada.*60 itens/i);
});

test('catalog analysis service is forced structured read-only output and metered separately', () => {
  const service = readFileSync(
    new URL('../server/kyrubiaCatalogAnalysisRoute.ts', import.meta.url),
    'utf8'
  );
  assert.match(service, /present_catalog_analysis/);
  assert.match(service, /mode: 'ANY'/);
  assert.match(service, /allowedFunctionNames: \['present_catalog_analysis'\]/);
  assert.match(service, /operation: 'catalog_analysis'/);
  assert.match(service, /MAX_ANALYSIS_ITEMS = 60/);
  assert.match(service, /controller\.abort\(\), 50_000/);
  assert.match(service, /actionsEnabled: false/);
  assert.match(service, /writesEnabled: false/);
  assert.match(service, /normalizeKyrubCatalogAnalysis/);
  assert.match(service, /analysisSystemInstruction\(user, conversation\.topic\)/);
  assert.doesNotMatch(service, /actionExecution|prepare_product_draft|create_product|publicProducts/);
});

test('existing consultor function dispatches analysis and re-normalizes same-conversation structured context', () => {
  const router = readFileSync(new URL('../api/consultor-kyrub.ts', import.meta.url), 'utf8');
  const contract = readFileSync(new URL('../shared/aiConsultant.ts', import.meta.url), 'utf8');
  const context = readFileSync(new URL('../src/ai/catalogAnalysisContext.ts', import.meta.url), 'utf8');
  const continuation = readFileSync(new URL('../src/ai/opportunityContinuation.ts', import.meta.url), 'utf8');
  const multimodal = readFileSync(new URL('../src/ai/multimodalConsultantClient.ts', import.meta.url), 'utf8');
  const workspace = readFileSync(new URL('../src/components/KyrubAiWorkspaceBridge.tsx', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

  assert.match(router, /shouldUseKyrubiaCatalogAnalysis/);
  assert.match(router, /handleKyrubiaCatalogAnalysis/);
  assert.match(router, /normalizeKyrubCatalogAnalysis/);
  assert.match(router, /client_context_untrusted/);
  assert.match(router, /Boolean\(analysisContext\)/);
  assert.match(router, /requestedCatalogCapability/);
  assert.match(router, /safeCatalogHint/);
  assert.match(router, /hasMultimodalAttachment/);
  assert.match(router, /routeToCatalogAnalysis/);
  assert.match(router, /Catalog router decision/);
  assert.match(router, /handleKyrubia/);
  assert.match(router, /export const maxDuration = 60/);
  assert.match(contract, /requestedCapability\?: KyrubAiRequestedCapability/);
  assert.match(contract, /Non-authoritative routing hint/);
  assert.match(contract, /catalogAnalysisContext\?: KyrubCatalogAnalysis/);
  assert.match(context, /loadKyrubiaCatalogAnalysis/);
  assert.match(context, /payload\.conversationId/);
  assert.match(context, /uid/);
  assert.match(continuation, /prepareKyrubAiCatalogAnalysisContext/);
  assert.match(multimodal, /prepareKyrubAiCatalogAnalysisContext/);
  assert.match(multimodal, /shouldUseKyrubiaCatalogAnalysis/);
  assert.match(multimodal, /requestedCapability/);
  assert.match(multimodal, /JSON\.stringify\(requestPayload\)/);
  assert.doesNotMatch(multimodal, /JSON\.stringify\(payload\)/);
  assert.match(workspace, /retryLastRequest/);
  assert.match(workspace, /requestReply\(activeConversation, activeConversation\.messages\)/);
  assert.match(contract, /KYRUB_AI_CONSULTANT_ENDPOINT = '\/api\/consultor-kyrub'/);
  assert.match(contract, /KYRUB_AI_CONSULTANT_COMPAT_ENDPOINT = '\/api\/kyrubia'/);
  assert.match(server, /"\/api\/consultor-kyrub"/);
  assert.doesNotMatch(server, /"\/api\/kyrubia-router"/);
  assert.doesNotMatch(server, /"\/api\/kyrubia-catalog-analysis"/);
});

test('multimodal retry carries only a read-only catalog routing hint and cannot grant mutation authority', () => {
  const contract = readFileSync(new URL('../shared/aiConsultant.ts', import.meta.url), 'utf8');
  const multimodal = readFileSync(new URL('../src/ai/multimodalConsultantClient.ts', import.meta.url), 'utf8');
  const router = readFileSync(new URL('../api/consultor-kyrub.ts', import.meta.url), 'utf8');
  const workspace = readFileSync(new URL('../src/components/KyrubAiWorkspaceBridge.tsx', import.meta.url), 'utf8');

  assert.match(workspace, /retryLastRequest/);
  assert.match(workspace, /requestReply\(activeConversation, activeConversation\.messages\)/);
  assert.match(multimodal, /requestedCapability/);
  assert.match(multimodal, /'catalog_analysis'/);
  assert.match(router, /requestedCapability === 'catalog_analysis'/);
  assert.match(router, /hasMultimodalAttachment\(messages\) \|\| Boolean\(analysisContext\)/);
  assert.match(contract, /never treat it\s*\n\s*\* as confirmation, mutation authority, receipt or proof of a write/);
  assert.doesNotMatch(multimodal, /actionExecution|confirmedAt|receipt|writesPerformed\s*:\s*true/);
});

test('latest catalog analysis context stays local and explicitly non-authoritative', () => {
  const store = readFileSync(
    new URL('../src/ai/catalogAnalysisStore.ts', import.meta.url),
    'utf8'
  );
  const events = readFileSync(new URL('../src/ai/actionEvents.ts', import.meta.url), 'utf8');
  assert.match(store, /kyrub_catalog_analysis_v1/);
  assert.match(store, /normalizeKyrubCatalogAnalysis/);
  assert.match(events, /KYRUB_CATALOG_ANALYSIS_EVENT/);
  assert.match(events, /saveKyrubiaCatalogAnalysis/);
  assert.doesNotMatch(store, /firebase|firestore|actionExecution|receipt/i);
});

test('usage ledger records economy route when a primary call finishes through fallback', () => {
  const metering = readFileSync(
    new URL('../server/kyrubiaUsageMetering.ts', import.meta.url),
    'utf8'
  );
  assert.match(metering, /\| 'catalog_analysis'/);
  assert.match(metering, /input\.fallbackUsed === true && input\.route === 'primary'/);
  assert.match(metering, /route: effectiveRoute/);
  assert.match(metering, /resource: 'ai'/);
  assert.doesNotMatch(metering, /credit|entitlement|plan/i);
});
