import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeKyrubCatalogAnalysis,
  summarizeKyrubCatalogAnalysis,
} from '../shared/kyrubCatalogAnalysis';

const multimodal = { sourceKind: 'multimodal' as const, attachmentCount: 1 };

test('ambiguous source code is preserved as uncertain evidence and blocks draft readiness', () => {
  const analysis = normalizeKyrubCatalogAnalysis({
    items: [{
      ref: 'item-2',
      kind: 'product',
      name: 'X-SALADA',
      category: 'BURGERS ARTESANAIS',
      price: 35.5,
      priceStatus: 'observed',
      stockStatus: 'missing',
      evidence: [
        'code:005',
        'code_confidence:medium',
        'name:X-SALADA',
        'name_confidence:high',
        'category:BURGERS ARTESANAIS',
        'category_confidence:high',
        'price:35,50',
        'price_confidence:high',
        'confidence:medium',
      ],
      issues: [],
    }],
  }, multimodal);

  assert.ok(analysis);
  const item = analysis.items[0];
  assert.equal(item.ref, 'item-2');
  assert.equal(item.observed.sourceRefText, '005');
  assert.equal(item.observed.sourceRefConfidence, 'medium');
  assert.equal(item.name, 'X-SALADA');
  assert.equal(item.price, 35.5);
  assert.equal(analysis.readyForDraftCount, 0);
  assert.equal(analysis.needsReviewCount, 1);
  assert.match(item.issues.join(' '), /Código\/referência visual ambíguo/i);
  assert.match(summarizeKyrubCatalogAnalysis(analysis), /\[código incerto: 005\] X-SALADA/);
});

test('ambiguous name evidence cannot populate the canonical name', () => {
  const analysis = normalizeKyrubCatalogAnalysis({
    items: [{
      ref: 'item-1',
      kind: 'product',
      name: 'X-SALADA',
      category: 'BURGERS ARTESANAIS',
      price: 35.5,
      priceStatus: 'observed',
      stockStatus: 'missing',
      evidence: [
        'code:015',
        'code_confidence:high',
        'name:X-SALADA',
        'name_confidence:medium',
        'category:BURGERS ARTESANAIS',
        'category_confidence:high',
        'price:35,50',
        'price_confidence:high',
        'confidence:medium',
      ],
      issues: [],
    }],
  }, multimodal);

  assert.ok(analysis);
  const item = analysis.items[0];
  assert.equal(item.observed.nameText, 'X-SALADA');
  assert.equal(item.observed.nameConfidence, 'medium');
  assert.equal(item.name, '');
  assert.equal(analysis.readyForDraftCount, 0);
  assert.match(item.issues.join(' '), /Nome visual ambíguo/i);
  assert.match(summarizeKyrubCatalogAnalysis(analysis), /015 \[nome incerto: X-SALADA\]/);
});

test('ambiguous price evidence cannot remain observed or populate canonical price', () => {
  const analysis = normalizeKyrubCatalogAnalysis({
    items: [{
      ref: 'item-1',
      kind: 'product',
      name: 'X-SALADA',
      category: 'BURGERS ARTESANAIS',
      price: 35.5,
      priceStatus: 'observed',
      stockStatus: 'missing',
      evidence: [
        'code:015',
        'code_confidence:high',
        'name:X-SALADA',
        'name_confidence:high',
        'category:BURGERS ARTESANAIS',
        'category_confidence:high',
        'price:35,50',
        'price_confidence:medium',
        'confidence:medium',
      ],
      issues: [],
    }],
  }, multimodal);

  assert.ok(analysis);
  const item = analysis.items[0];
  assert.equal(item.observed.priceText, '35,50');
  assert.equal(item.observed.priceConfidence, 'medium');
  assert.equal(item.price, null);
  assert.equal(item.priceStatus, 'ambiguous');
  assert.equal(analysis.readyForDraftCount, 0);
  assert.match(item.issues.join(' '), /Preço visual ambíguo/i);
  assert.match(summarizeKyrubCatalogAnalysis(analysis), /\[preço incerto: 35,50\]/);
});

test('visual glare on a code deterministically downgrades contradictory high code confidence', () => {
  const analysis = normalizeKyrubCatalogAnalysis({
    items: [{
      ref: 'item-xsalada',
      kind: 'product',
      name: 'X-SALADA',
      category: 'BURGERS ARTESANAIS',
      price: 35.5,
      priceStatus: 'observed',
      stockStatus: 'missing',
      evidence: [
        'code:003',
        'code_confidence:high',
        'name:X-SALADA',
        'name_confidence:high',
        'category:BURGERS ARTESANAIS',
        'category_confidence:high',
        'price:35,50',
        'price_confidence:high',
        'confidence:high',
      ],
      issues: ['Reflexo vertical sobre a numeração do código.'],
    }],
  }, multimodal);

  assert.ok(analysis);
  const item = analysis.items[0];
  assert.equal(item.observed.sourceRefText, '003');
  assert.equal(item.observed.sourceRefConfidence, 'medium');
  assert.equal(item.observed.nameConfidence, 'high');
  assert.equal(item.observed.priceConfidence, 'high');
  assert.equal(item.name, 'X-SALADA');
  assert.equal(item.price, 35.5);
  assert.equal(analysis.readyForDraftCount, 0);
  assert.equal(analysis.needsReviewCount, 1);
  assert.match(item.issues.join(' '), /Código\/referência visual ambíguo/i);
  assert.match(summarizeKyrubCatalogAnalysis(analysis), /\[código incerto: 003\] X-SALADA/);
});

test('generic item-level visual obstruction conservatively downgrades visible textual fields', () => {
  const analysis = normalizeKyrubCatalogAnalysis({
    items: [{
      ref: 'item-1',
      kind: 'product',
      name: 'X-EGG',
      category: 'BURGERS ARTESANAIS',
      description: 'Descrição visível',
      price: 35.5,
      priceStatus: 'observed',
      stockStatus: 'missing',
      evidence: [
        'code:016',
        'code_confidence:high',
        'name:X-EGG',
        'name_confidence:high',
        'category:BURGERS ARTESANAIS',
        'category_confidence:high',
        'description:Descrição visível',
        'description_confidence:high',
        'price:35,50',
        'price_confidence:high',
        'confidence:high',
      ],
      issues: ['Reflexo de luz sobre este item.'],
    }],
  }, multimodal);

  assert.ok(analysis);
  const item = analysis.items[0];
  assert.equal(item.observed.sourceRefConfidence, 'medium');
  assert.equal(item.observed.nameConfidence, 'medium');
  assert.equal(item.observed.categoryConfidence, 'medium');
  assert.equal(item.observed.descriptionConfidence, 'medium');
  assert.equal(item.observed.priceConfidence, 'medium');
  assert.equal(item.name, '');
  assert.equal(item.price, null);
  assert.equal(item.priceStatus, 'ambiguous');
  assert.equal(analysis.readyForDraftCount, 0);
  assert.equal(analysis.needsReviewCount, 1);
});