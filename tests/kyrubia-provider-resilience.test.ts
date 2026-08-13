import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  KYRUBIA_DEFAULT_ECONOMY_MODEL,
  KYRUBIA_DEFAULT_PRIMARY_MODEL,
  alternateGeminiModel,
  selectKyrubiaGeminiModel,
  shouldPreferEconomyModel,
} from '../shared/kyrubiaProviderResilience';

const api = readFileSync('api/kyrubia.ts', 'utf8');

test('provider defaults stay explicit', () => {
  assert.equal(KYRUBIA_DEFAULT_PRIMARY_MODEL, 'gemini-3.6-flash');
  assert.equal(KYRUBIA_DEFAULT_ECONOMY_MODEL, 'gemini-3.5-flash-lite');
});

test('simple multimodal inspection starts on economy model', () => {
  assert.equal(shouldPreferEconomyModel('O que aparece nesta imagem?', true), true);
  assert.deepEqual(
    selectKyrubiaGeminiModel({
      latestUserText: 'O que aparece nesta imagem?',
      hasMultimodalContext: true,
    }),
    {
      preferredModel: 'gemini-3.5-flash-lite',
      fallbackModel: 'gemini-3.6-flash',
      route: 'economy',
    }
  );
});

test('text-only and complex multimodal requests keep primary model', () => {
  assert.equal(shouldPreferEconomyModel('O que aparece nesta imagem?', false), false);
  assert.equal(
    shouldPreferEconomyModel('Compare estes documentos e recomende uma estratégia financeira.', true),
    false
  );
});

test('alternate model never repeats the active model', () => {
  const selection = selectKyrubiaGeminiModel({
    latestUserText: 'Leia este PDF.',
    hasMultimodalContext: true,
  });
  assert.equal(alternateGeminiModel(selection.preferredModel, selection), selection.fallbackModel);
  assert.equal(alternateGeminiModel(selection.fallbackModel, selection), selection.preferredModel);
});

test('API wires economy routing and quota fallback without a retry loop', () => {
  assert.match(api, /GEMINI_ECONOMY_MODEL/);
  assert.match(api, /selectKyrubiaGeminiModel/);
  assert.match(api, /callGeminiWithFallback/);
  assert.match(api, /Gemini quota exhausted/);
  assert.match(api, /Gemini fallback activated/);
  assert.doesNotMatch(api, /for\s*\(;;\)|while\s*\(true\)/);
});
