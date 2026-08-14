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

test('catalog analysis endpoint is forced structured read-only output and metered separately', () => {
  const api = readFileSync(
    new URL('../api/kyrubia-catalog-analysis.ts', import.meta.url),
    'utf8'
  );
  assert.match(api, /present_catalog_analysis/);
  assert.match(api, /mode: 'ANY'/);
  assert.match(api, /allowedFunctionNames: \['present_catalog_analysis'\]/);
  assert.match(api, /operation: 'catalog_analysis'/);
  assert.match(api, /actionsEnabled: false/);
  assert.match(api, /writesEnabled: false/);
  assert.match(api, /writesPerformed: false|normalizeKyrubCatalogAnalysis/);
  assert.doesNotMatch(api, /actionExecution|prepare_product_draft|create_product|publicProducts/);
});

test('catalog router preserves ordinary Kyrubia flow and diverts only explicit analysis', () => {
  const router = readFileSync(new URL('../api/kyrubia-router.ts', import.meta.url), 'utf8');
  const contract = readFileSync(new URL('../shared/aiConsultant.ts', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

  assert.match(router, /shouldUseKyrubiaCatalogAnalysis/);
  assert.match(router, /handleCatalogAnalysis/);
  assert.match(router, /handleKyrubia/);
  assert.match(contract, /KYRUB_AI_CONSULTANT_ENDPOINT = '\/api\/kyrubia-router'/);
  assert.match(server, /"\/api\/kyrubia-router"/);
  assert.match(server, /"\/api\/kyrubia-catalog-analysis"/);
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
