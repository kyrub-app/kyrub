import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isMercadoPagoMerchantPixRolloutAllowed,
  mercadoPagoMerchantPixRolloutError,
  mercadoPagoMerchantPixPreparationState,
  type MercadoPagoMerchantPixRolloutEnvironment,
} from '../server/payments/mercadoPagoMerchantPixRolloutPolicy';

const merchantA = 'store-owner-a';
const merchantB = 'store-owner-b';
const controlled: MercadoPagoMerchantPixRolloutEnvironment = {
  VERCEL_ENV: 'production',
  KYRUB_MP_MERCHANT_PIX_ENABLED: 'true',
  KYRUB_MP_MERCHANT_PIX_ROLLOUT_MODE: 'canary',
  KYRUB_MP_MERCHANT_PIX_CANARY_STORE_ID: merchantA,
};

test('default/off/unknown modes never activate a new merchant Pix', () => {
  assert.equal(isMercadoPagoMerchantPixRolloutAllowed(merchantA, {}), false);
  assert.equal(isMercadoPagoMerchantPixRolloutAllowed(merchantA, {
    VERCEL_ENV: 'production',
  }), false);
  assert.equal(isMercadoPagoMerchantPixRolloutAllowed(merchantA, {
    ...controlled, KYRUB_MP_MERCHANT_PIX_ENABLED: 'TRUE',
  }), false);
  assert.equal(isMercadoPagoMerchantPixRolloutAllowed(merchantA, {
    ...controlled, KYRUB_MP_MERCHANT_PIX_ROLLOUT_MODE: 'unknown',
  }), false);
});

test('Vercel preview and development cannot mint, even when rollout is on', () => {
  for (const VERCEL_ENV of ['preview', 'development', '']) {
    const env = { ...controlled, VERCEL_ENV, KYRUB_MP_MERCHANT_PIX_ROLLOUT_MODE: 'connected_stores' };
    assert.equal(mercadoPagoMerchantPixRolloutError(merchantA, env), 'MERCADO_PAGO_STORE_PIX_PRODUCTION_ONLY');
  }
});

test('canary authorizes only the selected canonical store, never a neighbor', () => {
  assert.equal(isMercadoPagoMerchantPixRolloutAllowed(merchantA, controlled), true);
  assert.equal(mercadoPagoMerchantPixRolloutError(merchantB, controlled), 'MERCADO_PAGO_STORE_PIX_ROLLOUT_NOT_ENABLED');
  assert.equal(isMercadoPagoMerchantPixRolloutAllowed(merchantA, {
    ...controlled, KYRUB_MP_MERCHANT_PIX_CANARY_STORE_ID: '',
  }), false);
});

test('connected_stores permits eligible store identities independently, not a global collector', () => {
  const env = { ...controlled, KYRUB_MP_MERCHANT_PIX_ROLLOUT_MODE: 'connected_stores' };
  assert.equal(isMercadoPagoMerchantPixRolloutAllowed(merchantA, env), true);
  assert.equal(isMercadoPagoMerchantPixRolloutAllowed(merchantB, env), true);
  assert.equal(isMercadoPagoMerchantPixRolloutAllowed('', env), false);
  assert.equal(isMercadoPagoMerchantPixRolloutAllowed('abc/def', env), false);
  // Passing this pure gate is not OAuth authorization: merchant-specific
  // identity and collector matching remain mandatory in the provider.
});

test('merchant status remains preparation only, does not imply payment or OAuth validation', () => {
  const makeStatus = (storeId: string, env: MercadoPagoMerchantPixRolloutEnvironment, connected: boolean, oauthOperationsAllowed = true) =>
    mercadoPagoMerchantPixPreparationState({
      storeId, env, platformConfigured: true, connected, oauthOperationsAllowed,
    });
  assert.equal(makeStatus(merchantA, {}, true, false), 'preview_readonly');
  assert.equal(makeStatus(merchantA, { VERCEL_ENV: 'production' }, false), 'store_connection_required');
  assert.equal(makeStatus(merchantA, controlled, false), 'store_connection_required');
  assert.equal(makeStatus(merchantB, controlled, true), 'rollout_pending');
  assert.equal(makeStatus(merchantA, controlled, true), 'live_preflight_required');
  const general = { ...controlled, KYRUB_MP_MERCHANT_PIX_ROLLOUT_MODE: 'connected_stores' };
  assert.equal(makeStatus(merchantA, general, true), 'live_preflight_required');
  assert.equal(makeStatus(merchantB, general, false), 'store_connection_required');
  assert.equal(mercadoPagoMerchantPixPreparationState({
    storeId: merchantA, env: controlled, platformConfigured: false,
    connected: true, oauthOperationsAllowed: true,
  }), 'platform_setup_required');
});
