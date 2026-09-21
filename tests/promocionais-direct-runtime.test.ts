import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const router = readFileSync('src/components/RetailerPanelRuntimeRouter.tsx', 'utf8');
const runtime = readFileSync('src/components/store/PromotionalDirectRuntime.tsx', 'utf8');

test('Promocionais is a native direct management destination', () => {
  assert.match(router, /vouchers:\s*\{[\s\S]*title: 'Promocionais'[\s\S]*status: 'native'/);
  assert.match(router, /moduleId === 'vouchers'/);
  assert.match(router, /LazyPromotionalRuntime/);
});

test('Promocionais exposes all four canonical areas', () => {
  assert.match(runtime, /label: 'Cupons'/);
  assert.match(runtime, /label: 'Pontos'/);
  assert.match(runtime, /label: 'Desafios'/);
  assert.match(runtime, /label: 'Recompensas'/);
  assert.match(runtime, /StorePromotionsManager/);
  assert.match(runtime, /StoreChallengeManager/);
  assert.match(runtime, /StoreRewardManager/);
});
