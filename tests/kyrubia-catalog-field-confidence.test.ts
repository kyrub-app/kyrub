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
        'code_chars:0=high|0=medium|5=high',
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
  assert.equal(item.observed.sourceRefCharacterProofValid, false);
  assert.equal(item.observed.sourceRefConfidence, 'medium');
  assert.equal(item.name, 'X-SALADA');
  assert.equal(item.price, 35.5);
  assert.equal(analysis.readyForDraftCount, 0);
  assert.equal(analysis.needsReviewCount, 1);
  assert.match(item.issues.join(' '), /prova completa por caractere/i);
  assert.match(summarizeKyrubCatalogAnalysis(analysis), /\[código incerto: 005\] X-SALADA/);
});

test('high visual code without character proof fails closed and requires review', () => {
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
        'code:005',
        'code_confidence:high',
        'name:X-SALADA',
        'name_confidence:high',
        'category:BURGERS ARTESANAIS',
        'category_confidence:high',
        'price:35,50',
        'price_confidence:high',
        'confidence:high',
      ],
      issues: [],
    }],
  }, multimodal);

  assert.ok(analysis);
  const item = analysis.items[0];
  assert.equal(item.observed.sourceRefText, '005');
  assert.deepEqual(item.observed.sourceRefCharacters, []);
  assert.equal(item.observed.sourceRefCharacterProofValid, false);
  assert.equal(item.observed.sourceRefConfidence, 'medium');
  assert.equal(item.name, 'X-SALADA');
  assert.equal(item.price, 35.5);
  assert.equal(analysis.readyForDraftCount, 0);
  assert.equal(analysis.needsReviewCount, 1);
  assert.match(item.issues.join(' '), /prova completa por caractere/i);
  assert.match(summarizeKyrubCatalogAnalysis(analysis), /\[código incerto: 005\] X-SALADA/);
});

test('exact visual identifier is factual only with matching all-high character proof', () => {
  const analysis = normalizeKyrubCatalogAnalysis({
    items: [{
      ref: 'item-xburger',
      kind: 'product',
      name: 'X-BURGER',
      category: 'BURGERS ARTESANAIS',
      price: 29.5,
      priceStatus: 'observed',
      stockStatus: 'missing',
      evidence: [
        'code:002',
        'code_chars:0=high|0=high|2=high',
        'code_confidence:high',
        'name:X-BURGER',
        'name_confidence:high',
        'category:BURGERS ARTESANAIS',
        'category_confidence:high',
        'price:29,50',
        'price_confidence:high',
        'confidence:high',
      ],
      issues: [],
    }],
  }, multimodal);

  assert.ok(analysis);
  const item = analysis.items[0];
  assert.equal(item.observed.sourceRefCharacterProofValid, true);
  assert.equal(item.observed.sourceRefConfidence, 'high');
  assert.equal(analysis.readyForDraftCount, 1);
  assert.equal(analysis.needsReviewCount, 0);
  assert.match(summarizeKyrubCatalogAnalysis(analysis), /• 002 X-BURGER — 29,50/);
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
        'code_chars:0=high|1=high|5=high',
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
        'code_chars:0=high|1=high|5=high',
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
        'code_chars:0=high|0=high|3=high',
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
  assert.equal(item.observed.sourceRefCharacterProofValid, true);
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
        'code_chars:0=high|1=high|6=high',
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