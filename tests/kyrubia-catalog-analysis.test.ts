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
import {
  buildKyrubiaCatalogImportProposal,
  isKyrubiaCatalogImportText,
} from '../shared/kyrubiaCatalogImportIntent';

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

test('catalog write intent routes analyzed items into unpublished products instead of notes', () => {
  assert.equal(
    isKyrubiaCatalogImportText('Cadastre os produtos dessa imagem na minha loja.'),
    true
  );
  assert.equal(
    isKyrubiaCatalogImportText('Recadastre os itens desse cardápio.'),
    true
  );
  assert.equal(
    isKyrubiaCatalogImportText('Crie uma nota chamada Cardápio com o texto lanches.'),
    false
  );

  const analysis = normalizeKyrubCatalogAnalysis({
    items: [
      {
        ref: 'burger', kind: 'product', name: 'X-Burger', description: 'Hambúrguer',
        category: 'Burgers Artesanais', price: 29.5, priceStatus: 'observed',
        stockStatus: 'missing', issues: [],
      },
      {
        ref: 'salada', kind: 'product', name: 'X-Salada', description: 'Com salada',
        category: 'Burgers Artesanais', price: 35.5, priceStatus: 'observed',
        stockStatus: 'missing', issues: [],
      },
      {
        ref: 'duvidoso', kind: 'product', name: 'Item ilegível', description: '',
        category: 'Burgers Artesanais', priceStatus: 'ambiguous',
        stockStatus: 'missing', issues: ['Preço ilegível'],
      },
    ],
  }, { sourceKind: 'multimodal', attachmentCount: 1 });
  assert.ok(analysis);

  const proposal = buildKyrubiaCatalogImportProposal(analysis, 'conversation-burgers');
  assert.ok(proposal);
  assert.equal(proposal.type, 'import_catalog_draft');
  assert.equal(proposal.requiresConfirmation, true);
  assert.equal(proposal.inputProvenance, 'document_content');
  assert.equal(proposal.items.length, 2);
  assert.deepEqual(
    proposal.items.map(item => item.product.name),
    ['X-Burger', 'X-Salada']
  );

  const router = readFileSync(new URL('../api/consultor-kyrub.ts', import.meta.url), 'utf8');
  const importRoute = router.indexOf('const importResponse = catalogImportResponse');
  const analysisRoute = router.indexOf('shouldUseKyrubiaCatalogAnalysis(messages');
  const genericRoute = router.lastIndexOf('await handleKyrubia(request, response)');
  assert.ok(importRoute >= 0);
  assert.ok(importRoute < analysisRoute);
  assert.ok(importRoute < genericRoute);
  assert.match(router, /actionProposal: proposal/);

  const executor = readFileSync(
    new URL('../server/actions/catalogImportExecutionService.ts', import.meta.url),
    'utf8'
  );
  assert.match(executor, /executeAuthorizedKyrubCatalogDraft/);
  assert.match(executor, /inputProvenance: 'document_content'/);
  assert.match(executor, /confirmed: true/);

  const gateway = readFileSync(new URL('../api/action-execute.ts', import.meta.url), 'utf8');
  assert.ok(
    gateway.indexOf('isKyrubCatalogImportExecutionRequest') <
    gateway.indexOf('await reconcileStoreEntitlementFromAuthorization')
  );

  const bridge = readFileSync(
    new URL('../src/components/KyrubAiNoteActionBridge.tsx', import.meta.url),
    'utf8'
  );
  assert.match(bridge, /Confirmar produtos do cardápio/);
  assert.match(bridge, /proposal\.type === 'import_catalog_draft'/);
  assert.match(bridge, /produtos não publicados/i);
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
  assert.match(service, /actionsEnabled: false/);
  assert.match(service, /writesEnabled: false/);
  assert.match(service, /normalizeKyrubCatalogAnalysis/);
  assert.match(service, /analysisSystemInstruction\(user, conversation\.topic\)/);
  assert.doesNotMatch(service, /actionExecution|prepare_product_draft|create_product|publicProducts/);
});

test('existing consultor function dispatches analysis and re-normalizes same-conversation structured context', () => {
  const router = readFileSync(new URL('../api/consultor-kyrub.ts', import.meta.url), 'utf8');
  const contract = readFileSync(new URL('../shared/aiConsultant.ts', import.meta.url), 'utf8');
  const continuation = readFileSync(new URL('../src/ai/opportunityContinuation.ts', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

  assert.match(router, /shouldUseKyrubiaCatalogAnalysis/);
  assert.match(router, /handleKyrubiaCatalogAnalysis/);
  assert.match(router, /normalizeKyrubCatalogAnalysis/);
  assert.match(router, /client_context_untrusted/);
  assert.match(router, /Boolean\(analysisContext\)/);
  assert.match(router, /handleKyrubia/);
  assert.match(contract, /catalogAnalysisContext\?: KyrubCatalogAnalysis/);
  assert.match(continuation, /loadKyrubiaCatalogAnalysis/);
  assert.match(continuation, /payload\.conversationId/);
  assert.match(continuation, /catalogAnalysisContext/);
  assert.match(contract, /KYRUB_AI_CONSULTANT_ENDPOINT = '\/api\/consultor-kyrub'/);
  assert.match(contract, /KYRUB_AI_CONSULTANT_COMPAT_ENDPOINT = '\/api\/kyrubia'/);
  assert.match(server, /"\/api\/consultor-kyrub"/);
  assert.doesNotMatch(server, /"\/api\/kyrubia-router"/);
  assert.doesNotMatch(server, /"\/api\/kyrubia-catalog-analysis"/);
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
