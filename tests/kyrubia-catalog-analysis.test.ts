import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  normalizeKyrubCatalogAnalysis,
  summarizeKyrubCatalogAnalysis,
} from '../shared/kyrubCatalogAnalysis';
import {
  isKyrubiaCatalogAnalysisText,
  shouldUseKyrubiaCatalogAnalysis,
} from '../shared/kyrubiaCatalogAnalysisIntent';

test('catalog analysis intent is explicit and does not hijack ordinary image questions', () => {
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
});

test('catalog normalizer keeps only explicitly observed price and stock values', () => {
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

test('catalog analysis service is forced structured read-only output and metered separately', () => {
  const service = readFileSync(
    new URL('../server/kyrubiaCatalogAnalysisRoute.ts', import.meta.url),
    'utf8'
  );
  assert.match(service, /present_catalog_analysis/);
  assert.match(service, /mode: 'ANY'/);
  assert.match(service, /allowedFunctionNames: \['present_catalog_analysis'\]/);
  assert.match(service, /operation: 'catalog_analysis'/);
  assert.match(service, /actionsEnabled: false/);
  assert.match(service, /writesEnabled: false/);
  assert.match(service, /normalizeKyrubCatalogAnalysis/);
  assert.match(service, /analysisSystemInstruction\(user, conversation\.topic\)/);
  assert.doesNotMatch(service, /actionExecution|prepare_product_draft|create_product|publicProducts/);
});

test('existing consultor function dispatches analysis while canonical Kyrubia remains compatibility fallback', () => {
  const router = readFileSync(new URL('../api/consultor-kyrub.ts', import.meta.url), 'utf8');
  const contract = readFileSync(new URL('../shared/aiConsultant.ts', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

  assert.match(router, /shouldUseKyrubiaCatalogAnalysis/);
  assert.match(router, /handleKyrubiaCatalogAnalysis/);
  assert.match(router, /handleKyrubia/);
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

test('usage ledger accepts catalog_analysis without changing credit semantics', () => {
  const metering = readFileSync(
    new URL('../server/kyrubiaUsageMetering.ts', import.meta.url),
    'utf8'
  );
  assert.match(metering, /\| 'catalog_analysis'/);
  assert.match(metering, /resource: 'ai'/);
  assert.doesNotMatch(metering, /credit|entitlement|plan/i);
});
